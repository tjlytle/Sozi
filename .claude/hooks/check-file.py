#!/usr/bin/env python3
"""Edit hook: a PostToolUse hook (Edit, Write, MultiEdit) that runs the
repository's per-file checks (`bin/check FILE`) on the file just written.

A failing check is reported back to the model (exit 2, output on stderr) so it
fixes the file before committing. CI runs the same script over the whole
repository and is the only gate; this hook is the fast path.

Files outside src/ and test/, and files `bin/check` does not know, are ignored.
"""
import json
import os
import subprocess
import sys

CHECKED_DIRS = ("src", "test", "bin", "config", ".github")
CHECKED_EXT = (".js", ".mjs", ".cjs", ".ts", ".css", ".json", ".yml", ".yaml")


def main():
    try:
        payload = json.load(sys.stdin)
    except Exception:
        return
    tool_input = payload.get("tool_input") or {}
    file_path = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
    if not file_path:
        return
    root = payload.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()
    rel = os.path.relpath(os.path.abspath(file_path), root)
    if rel.startswith("..") or not rel.endswith(CHECKED_EXT):
        return
    if rel.split(os.sep)[0] not in CHECKED_DIRS and os.sep in rel:
        return
    check = os.path.join(root, "bin", "check")
    if not os.access(check, os.X_OK):
        return
    r = subprocess.run([check, rel], cwd=root, capture_output=True, text=True, timeout=120)
    if r.returncode != 0:
        sys.stderr.write(f"bin/check {rel} failed; fix before committing (bin/check --fix {rel} "
                         f"applies the mechanical fixes):\n{r.stdout}{r.stderr}")
        sys.exit(2)


if __name__ == "__main__":
    main()
