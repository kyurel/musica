"""Run `musica-worker backup run` every night with launchd (macOS's built-in scheduler).

If the Mac is asleep at the set time, launchd runs the job when it wakes up.
"""

from __future__ import annotations

import plistlib
import shlex
import subprocess
from pathlib import Path

LABEL = "com.musica.backup"


def plist_path() -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{LABEL}.plist"


def make_plist(worker_dir: Path, env_file: Path, uv: str, hour: int, minute: int, log: Path) -> bytes:
    script = (f"set -a && source {shlex.quote(str(env_file))} && set +a && "
              f"cd {shlex.quote(str(worker_dir))} && exec {shlex.quote(uv)} run musica-worker backup run")
    return plistlib.dumps({
        "Label": LABEL,
        "ProgramArguments": ["/bin/zsh", "-c", script],
        "StartCalendarInterval": {"Hour": hour, "Minute": minute},
        "StandardOutPath": str(log),
        "StandardErrorPath": str(log),
        "ProcessType": "Background",
        "LowPriorityIO": True,
    })


def install(content: bytes) -> Path:
    target = plist_path()
    target.parent.mkdir(parents=True, exist_ok=True)
    uninstall()
    target.write_bytes(content)
    subprocess.run(["launchctl", "load", "-w", str(target)], check=True)
    return target


def uninstall() -> bool:
    target = plist_path()
    if not target.exists():
        return False
    subprocess.run(["launchctl", "unload", "-w", str(target)], check=False)
    target.unlink()
    return True
