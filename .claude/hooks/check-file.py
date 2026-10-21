#!/usr/bin/env python3
"""Edit hook: a PostToolUse hook (Edit, Write, MultiEdit) for the file just written.

Two jobs, in this order:

1. Run the repository's per-file checks (`bin/check FILE`). A failing check is
   reported back to the model (exit 2, output on stderr) so it fixes the file
   before committing. CI runs the same script over the whole repository and is
   the only gate; this hook is the fast path.

2. Advise. Some rules of code-standard.md are judgment calls, not limits: a file
   that has grown past the size guideline (2.8), a function that has, a class with
   many public methods, or code that changed under a summary comment that did not
   (2.8). The hook measures those and hands the model a note (hook
   `additionalContext`, exit 0) asking it to consider, rather than failing.

People can ask for the same notes:

    python3 .claude/hooks/check-file.py --advise FILE [--diff DIFF_FILE]

`--diff` supplies a unified diff of FILE instead of the diff against HEAD.

Files outside the checked directories, and files `bin/check` does not know, are
ignored.
"""
import json
import os
import re
import subprocess
import sys

CHECKED_DIRS = ("src", "test", "bin", "config", ".github")
CHECKED_EXT = (".js", ".mjs", ".cjs", ".ts", ".tsx", ".css", ".json", ".yml", ".yaml")
CODE_EXT = (".js", ".mjs", ".cjs", ".ts", ".tsx", ".html", ".feature")

# code-standard.md 2.8: guidelines, not limits.
MAX_FILE_LINES = 400
MAX_FUNCTION_LINES = 50
MAX_PUBLIC_METHODS = 10

KEYWORDS = {"if", "for", "while", "switch", "catch", "return", "constructor"}
DOC_START = re.compile(r"^\s*/\*\*")
DOC_END = re.compile(r"\*/\s*$")
DECLARATION = re.compile(
    r"^(?P<indent>\s*)(?:export\s+)?(?:default\s+)?(?:async\s+)?"
    r"(?:(?:function\s*\*?\s*|class\s+)(?P<name1>[A-Za-z_$][\w$]*)"
    r"|(?:const|let|var)\s+(?P<name2>[A-Za-z_$][\w$]*)\s*="
    r"|(?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?(?P<name3>[A-Za-z_$#][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{)"
)
METHOD = re.compile(r"^    (?:static\s+)?(?:async\s+)?(?:get\s+|set\s+)?([A-Za-z$][\w$]*)\s*\([^)]*\)\s*(?::\s*[^{]+)?\{")
CLASS = re.compile(r"^\s*(?:export\s+)?(?:default\s+)?class\s+([A-Za-z_$][\w$]*)")
HUNK = re.compile(r"^@@ -\d+(?:,\d+)? \+(\d+)(?:,(\d+))? @@")


def run(cmd, cwd):
    return subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=120)


# --- advice -------------------------------------------------------------------

def declarations(lines):
    """Each declaration in the file as (name, doc_range, body_range).

    Ranges are 1-based and inclusive. doc_range is the `/** ... */` block right
    above the declaration, or None. A body runs to the line before the next
    declaration at the same or lower indentation (or its doc comment).
    """
    found = []
    i = 0
    while i < len(lines):
        doc = None
        if DOC_START.match(lines[i]):
            start = i
            while i < len(lines) and not DOC_END.search(lines[i]):
                i += 1
            doc = (start + 1, i + 1)
            i += 1
            while i < len(lines) and not lines[i].strip():
                i += 1
            if i >= len(lines):
                break
        m = DECLARATION.match(lines[i])
        if m:
            name = m.group("name1") or m.group("name2") or m.group("name3")
            if name not in KEYWORDS:
                found.append([name, doc, len(m.group("indent")), i + 1])
        i += 1
    out = []
    for k, (name, doc, indent, line) in enumerate(found):
        end = len(lines)
        for later_name, later_doc, later_indent, later_line in found[k + 1:]:
            if later_indent <= indent:
                end = (later_doc[0] if later_doc else later_line) - 1
                break
        out.append((name, doc, (line, end)))
    return out


def changed_lines(diff_text):
    changed = set()
    for line in diff_text.splitlines():
        m = HUNK.match(line)
        if m:
            start = int(m.group(1))
            count = int(m.group(2)) if m.group(2) is not None else 1
            changed.update(range(start, start + max(count, 1)))
    return changed


def stale_comments(lines, diff_text):
    """Names whose body changed while the doc comment above them did not."""
    changed = changed_lines(diff_text)
    if not changed:
        return []
    stale = []
    for name, doc, body in declarations(lines):
        if not doc:
            continue
        body_changed = any(body[0] <= n <= body[1] for n in changed)
        doc_changed = any(doc[0] <= n <= doc[1] for n in changed)
        if body_changed and not doc_changed:
            stale.append((name, doc[0]))
    return stale


def public_methods(lines):
    """(class name, number of public methods) for each class in the file."""
    out = []
    current = None
    for line in lines:
        m = CLASS.match(line)
        if m:
            if current:
                out.append(current)
            current = [m.group(1), 0]
            continue
        if current:
            mm = METHOD.match(line)
            if mm and mm.group(1) not in KEYWORDS and not mm.group(1).startswith("_"):
                current[1] += 1
    if current:
        out.append(current)
    return out


def long_functions(root, rel):
    """(name, lines) for functions over the guideline, measured by ESLint."""
    rule = {"max-lines-per-function": ["warn", {
        "max": MAX_FUNCTION_LINES, "skipBlankLines": True, "skipComments": True}]}
    r = run(["npx", "eslint", "--config", "config/eslintrc.mjs", "--rule", json.dumps(rule),
             "-f", "json", rel], root)
    try:
        results = json.loads(r.stdout or "[]")
    except json.JSONDecodeError:
        return []
    out = []
    for f in results:
        for m in f.get("messages", []):
            if m.get("ruleId") == "max-lines-per-function":
                mm = re.search(r"'([^']+)' has too many lines \((\d+)\)", m.get("message", ""))
                if mm:
                    out.append((mm.group(1), int(mm.group(2))))
    return out


def coverage_notes(root, rel):
    """Notes from bin/check-coverage.js: an edited source file with no covering test,
    or a test and the code it covers changing together (code-standard.md 6.2)."""
    if not (rel.startswith("src/") or rel.startswith("test/")):
        return []
    r = run(["node", "bin/check-coverage.js", "--json", "--files", rel], root)
    try:
        report = json.loads(r.stdout or "{}")
    except json.JSONDecodeError:
        return []
    notes = []
    for s in report.get("sources", []):
        if s["path"] == rel and not s["covered"] and not s["waived"]:
            notes.append(f"No unit test or feature file covers {rel}. Add a scenario to a feature file "
                         f"(tag it with the issue and list {rel} in its '# covers:' line) or a unit test "
                         f"named after it; if the change needs no test, say why in the PR body as "
                         f"'No test: {rel} - <reason>' (code-standard.md 6.2).")
    for t in report.get("together", []):
        if rel == t["test"] or rel in t["sources"]:
            other = ", ".join(t["sources"]) if rel == t["test"] else t["test"]
            notes.append(f"{rel} and {other} are changing together. Was the behaviour meant to change? "
                         f"If so the feature file should have changed first; and which other test still "
                         f"covers the related behaviour unchanged? (code-standard.md 6.2)")
    return notes


def advice(root, rel, diff_text=None):
    """The notes for one file: size guidelines and stale summary comments."""
    path = os.path.join(root, rel)
    if not rel.endswith(CODE_EXT) or not os.path.isfile(path):
        return []
    with open(path, encoding="utf-8", errors="replace") as fh:
        lines = fh.read().splitlines()
    notes = []
    if len(lines) > MAX_FILE_LINES:
        notes.append(f"{rel} is {len(lines)} lines; the guideline is {MAX_FILE_LINES} "
                     f"(code-standard.md 2.8). Consider whether it holds more than one concern "
                     f"and should be split. This is a judgment call, not a rule.")
    for name, n in long_functions(root, rel):
        notes.append(f"{rel}: `{name}` is {n} lines of code; the guideline is {MAX_FUNCTION_LINES} "
                     f"(code-standard.md 2.8). Consider whether part of it is a separate function.")
    for cls, n in public_methods(lines):
        if n > MAX_PUBLIC_METHODS:
            notes.append(f"{rel}: class `{cls}` has {n} public methods; the guideline is "
                         f"{MAX_PUBLIC_METHODS} (code-standard.md 2.8). Consider whether it has "
                         f"more than one job.")
    if diff_text is None:
        tracked = run(["git", "ls-files", "--error-unmatch", rel], root).returncode == 0
        diff_text = run(["git", "diff", "-U0", "HEAD", "--", rel], root).stdout if tracked else ""
    notes.extend(coverage_notes(root, rel))
    for name, doc_line in stale_comments(lines, diff_text):
        notes.append(f"{rel}: the code of `{name}` changed but the summary comment above it "
                     f"(line {doc_line}) did not. Consider whether the comment still describes "
                     f"it (code-standard.md 2.8).")
    return notes


# --- hook ---------------------------------------------------------------------

def project_root():
    root = os.environ.get("CLAUDE_PROJECT_DIR")
    if root:
        return root
    r = run(["git", "rev-parse", "--show-toplevel"], os.getcwd())
    return r.stdout.strip() or os.getcwd()


def main():
    if len(sys.argv) > 2 and sys.argv[1] == "--advise":
        root = project_root()
        rel = os.path.relpath(os.path.abspath(sys.argv[2]), root)
        diff_text = None
        if "--diff" in sys.argv:
            with open(sys.argv[sys.argv.index("--diff") + 1], encoding="utf-8") as fh:
                diff_text = fh.read()
        for note in advice(root, rel, diff_text):
            print(note)
        return
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
    r = run([check, rel], root)
    if r.returncode != 0:
        sys.stderr.write(f"bin/check {rel} failed; fix before committing (bin/check --fix {rel} "
                         f"applies the mechanical fixes):\n{r.stdout}{r.stderr}")
        sys.exit(2)
    notes = advice(root, rel)
    if notes:
        sys.stdout.write(json.dumps({"hookSpecificOutput": {
            "hookEventName": "PostToolUse",
            "additionalContext": "\n".join(notes)}}))


if __name__ == "__main__":
    main()
