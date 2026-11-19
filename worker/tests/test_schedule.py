import plistlib
from pathlib import Path

from musica_worker.schedule import LABEL, make_plist


def test_nightly_plist():
    raw = make_plist(Path("/Users/andre/dev/musica/worker"), Path("/Users/andre/dev/musica/.env"),
                     "/opt/homebrew/bin/uv", 3, 30, Path("/Users/andre/Library/Logs/musica-backup.log"))
    p = plistlib.loads(raw)
    assert p["Label"] == LABEL
    assert p["StartCalendarInterval"] == {"Hour": 3, "Minute": 30}
    script = p["ProgramArguments"][2]
    assert "source /Users/andre/dev/musica/.env" in script
    assert script.endswith("exec /opt/homebrew/bin/uv run musica-worker backup run")


def test_paths_with_spaces_are_quoted():
    raw = make_plist(Path("/Users/a b/musica/worker"), Path("/Users/a b/musica/.env"), "uv", 2, 0, Path("/tmp/l"))
    script = plistlib.loads(raw)["ProgramArguments"][2]
    assert "source '/Users/a b/musica/.env'" in script and "cd '/Users/a b/musica/worker'" in script
