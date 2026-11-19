"""launchd agents (macOS's built-in scheduler) for this Mac.

* `com.musica.backup`: `musica-worker backup run` every night. If the Mac is asleep at
  that time, launchd runs it on wake.
* `com.musica.worker`: `musica-worker run` from login, restarted if it stops. Its regular
  queue checks also keep the free Supabase project from pausing for inactivity.
"""

from __future__ import annotations

import plistlib
import shlex
import subprocess
from pathlib import Path

LABEL = "com.musica.backup"          # kept for the backup commands
WORKER_LABEL = "com.musica.worker"


def plist_path(label: str = LABEL) -> Path:
    return Path.home() / "Library" / "LaunchAgents" / f"{label}.plist"


def _script(worker_dir: Path, env_file: Path, uv: str, command: str) -> str:
    return (f"set -a && source {shlex.quote(str(env_file))} && set +a && "
            f"cd {shlex.quote(str(worker_dir))} && exec {shlex.quote(uv)} run musica-worker {command}")


def make_plist(worker_dir: Path, env_file: Path, uv: str, hour: int, minute: int, log: Path) -> bytes:
    return plistlib.dumps({
        "Label": LABEL,
        "ProgramArguments": ["/bin/zsh", "-c", _script(worker_dir, env_file, uv, "backup run")],
        "StartCalendarInterval": {"Hour": hour, "Minute": minute},
        "StandardOutPath": str(log),
        "StandardErrorPath": str(log),
        "ProcessType": "Background",
        "LowPriorityIO": True,
    })


def make_worker_plist(worker_dir: Path, env_file: Path, uv: str, log: Path) -> bytes:
    return plistlib.dumps({
        "Label": WORKER_LABEL,
        "ProgramArguments": ["/bin/zsh", "-c", _script(worker_dir, env_file, uv, "run")],
        "RunAtLoad": True,
        "KeepAlive": {"SuccessfulExit": False},   # restart after a crash, not after a clean stop
        "ThrottleInterval": 60,                   # at most one restart a minute
        "StandardOutPath": str(log),
        "StandardErrorPath": str(log),
        "ProcessType": "Background",
        "LowPriorityIO": True,
        "Nice": 5,
    })


def install(content: bytes, label: str = LABEL) -> Path:
    target = plist_path(label)
    target.parent.mkdir(parents=True, exist_ok=True)
    uninstall(label)
    target.write_bytes(content)
    subprocess.run(["launchctl", "load", "-w", str(target)], check=True)
    return target


def uninstall(label: str = LABEL) -> bool:
    target = plist_path(label)
    if not target.exists():
        return False
    subprocess.run(["launchctl", "unload", "-w", str(target)], check=False)
    target.unlink()
    return True
