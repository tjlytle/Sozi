#!/usr/bin/env bash
# The edit hook, run from the outside.
#
# The Claude Code edit hook (.claude/hooks/check-file.py) only fires inside a
# Claude Code session. Other harnesses have no such hook, so the stage runner
# calls this after a session and resumes the session with whatever it finds.
#
# Usage: pipeline/hooks-outside.sh <checkout> <start-sha> <report-file>
#
# For every file changed since <start-sha> (tracked or untracked) under the
# hook's checked directories and extensions it runs `bin/check FILE` and
# `check-file.py --advise FILE`. The report file is empty when nothing was
# found; otherwise its first line is "The edit hook would have told you:".
# Exit 0 when the report is empty, 1 otherwise. Reads no environment.
set -u

CHECKED_DIRS="src test bin config .github"
CHECKED_EXT="js mjs cjs ts tsx css json yml yaml html feature"

# Files changed since the start commit that still exist, one per line.
changed_files() {
    { git diff --name-only "$1"; git ls-files --others --exclude-standard; } |
        sort -u | while IFS= read -r f; do [ -f "$f" ] && printf '%s\n' "$f"; done
}

# True when the hook would look at the file: checked directory, known extension.
is_checked() {
    local top="${1%%/*}" ext="${1##*.}" d e
    [ "$top" = "$1" ] && return 1
    for d in $CHECKED_DIRS; do
        if [ "$d" = "$top" ]; then
            for e in $CHECKED_EXT; do [ "$e" = "$ext" ] && return 0; done
        fi
    done
    return 1
}

# Append the findings for one file to the report text.
check_one() {
    local out
    if ! out=$(bin/check "$1" 2>&1); then
        found+="== bin/check $1"$'\n'"$out"$'\n'
    fi
    out=$(python3 .claude/hooks/check-file.py --advise "$1" 2>&1)
    [ -n "$out" ] && found+="$out"$'\n'
}

main() {
    local checkout="$1" start="$2" report="$3" f found=""
    cd "$checkout" || exit 1
    while IFS= read -r f; do
        is_checked "$f" && check_one "$f"
    done < <(changed_files "$start")
    if [ -z "$found" ]; then
        : >"$report"
        exit 0
    fi
    { echo "The edit hook would have told you:"; printf '%s' "$found"; } >"$report"
    exit 1
}

main "$@"
