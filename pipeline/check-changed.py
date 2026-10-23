#!/usr/bin/env python3
"""The `bin/check FILE` findings that sit on lines a session changed.

    python3 pipeline/check-changed.py FILE DIFF_FILE

DIFF_FILE is a unified diff of FILE (`git diff -U0`); its hunks are the changed
lines, read by the edit hook's `changed_lines` so hunk parsing has one owner. A
finding on line 0 is kept. A failed check whose output has no line number in it
(Prettier) is kept whole, and output with no failed check in it is printed as it
is, so unknown output is never hidden. Prints what is left; exit 0 when nothing
is, 1 otherwise. Run from the repository root.
"""
import importlib.util
import os
import re
import subprocess
import sys

# bin/check output: "  L:C  ..." (ESLint stylish, Stylelint string) or "FILE(L,C): ..." (tsc).
FINDING = re.compile(r"^\s+(\d+):\d+\s|\((\d+),\d+\): ")
SUMMARY = re.compile(r"^✖ \d+ problems? |^\s+\d+ errors? and \d+ warnings? potentially fixable")


def edit_hook():
    """The edit hook module, loaded from its file without writing bytecode beside it."""
    sys.dont_write_bytecode = True
    path = os.path.join(os.path.dirname(__file__), "..", ".claude", "hooks", "check-file.py")
    spec = importlib.util.spec_from_file_location("check_file", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def check_findings(output, changed):
    """The failed sections of `bin/check` output, keeping only findings on changed lines.

    A finding on line 0 is kept. A failed section with no line number in it is
    kept whole; a section whose findings were all dropped goes, with its summary.
    """
    sections = []
    for line in output.splitlines():
        if line.startswith("== ") and not line.endswith(": FAILED"):
            sections.append([line])
        elif sections:
            sections[-1].append(line)
    kept = []
    for lines in sections:
        if not lines[-1].endswith(": FAILED"):
            continue
        numbers = []
        for line in lines:
            m = FINDING.search(line)
            numbers.append(int(m.group(1) or m.group(2)) if m else None)
        if all(n is None for n in numbers):
            kept.extend(lines)
        elif any(n is not None and (n == 0 or n in changed) for n in numbers):
            kept.extend(line for line, n in zip(lines, numbers)
                        if (n is None and not SUMMARY.search(line)) or n == 0 or n in changed)
    return "".join(line + "\n" for line in kept)


def main():
    rel, diff_file = sys.argv[1], sys.argv[2]
    r = subprocess.run(["bin/check", rel], stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
                       text=True)
    if r.returncode == 0:
        return
    if ": FAILED" in r.stdout:
        with open(diff_file, encoding="utf-8") as fh:
            out = check_findings(r.stdout, edit_hook().changed_lines(fh.read()))
    else:
        out = r.stdout
    if out:
        sys.stdout.write(out)
        sys.exit(1)


if __name__ == "__main__":
    main()
