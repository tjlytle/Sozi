#!/usr/bin/env bash
# The edit hook, run from the outside.
#
# The Claude Code edit hook (.claude/hooks/check-file.py) only fires inside a
# Claude Code session. Other harnesses have no such hook, so the stage runner
# calls this after a session and resumes the session with whatever it finds.
#
# Usage: pipeline/hooks-outside.sh <checkout> <start-sha> <report-file>
#
# For every file changed since <start-sha> (tracked or untracked) that the hook
# would look at (a root-level file with a checked extension, or a file under a
# checked directory) it runs `bin/check FILE` and `check-file.py --advise FILE`,
# both against the diff since <start-sha> so committed changes still count. Only
# the `bin/check` findings on lines changed since <start-sha> are reported
# (pipeline/check-changed.py); a failure with no line number is reported whole.
# The report file is empty when nothing was found; otherwise its
# first line is "The edit hook would have told you:".
# Exit 0 when the report is empty, 1 when it holds findings, 2 when git failed
# (the git error is on stderr). Reads no environment.
set -u

CHECKED_DIRS="src test bin config .github"
CHECKED_EXT="js mjs cjs ts tsx css json yml yaml html feature"
CHECK_CHANGED="$(cd "$(dirname "$0")" && pwd)/check-changed.py"

# Files changed since the start commit that still exist, one per line.
changed_files() {
    local tracked untracked f
    tracked=$(git -c core.quotePath=false diff --name-only "$1") || return 1
    untracked=$(git -c core.quotePath=false ls-files --others --exclude-standard) || return 1
    printf '%s\n%s\n' "$tracked" "$untracked" | sort -u | while IFS= read -r f; do
        [ -n "$f" ] && [ -f "$f" ] && printf '%s\n' "$f"
    done
    return 0
}

# True when the hook would look at the file: known extension, and either at the
# root or under a checked directory.
is_checked() {
    local top="${1%%/*}" ext="${1##*.}" d e
    for e in $CHECKED_EXT; do
        if [ "$e" = "$ext" ]; then
            [ "$top" = "$1" ] && return 0
            for d in $CHECKED_DIRS; do [ "$d" = "$top" ] && return 0; done
        fi
    done
    return 1
}

# Append the findings for one file (checks, then advice) to the report text.
check_one() {
    local out diff
    diff=$(mktemp)
    if git ls-files --error-unmatch -- "$1" >/dev/null 2>&1; then
        git diff -U0 "$start" -- "$1" >"$diff" 2>/dev/null
    else
        git diff -U0 --no-index /dev/null "$1" >"$diff" 2>/dev/null
    fi
    if ! out=$(python3 "$CHECK_CHANGED" "$1" "$diff" 2>&1); then
        found+="== bin/check $1"$'\n'"$out"$'\n'"bin/check --fix $1 applies the mechanical fixes."$'\n'
    fi
    out=$(python3 .claude/hooks/check-file.py --advise "$1" --diff "$diff" 2>&1)
    rm -f "$diff"
    [ -n "$out" ] && found+="$out"$'\n'
}

main() {
    local checkout="$1" report="$3" f list
    start="$2"; found=""
    case "$report" in /*) ;; *) report="$PWD/$report" ;; esac
    cd "$checkout" || exit 2
    export CLAUDE_PROJECT_DIR="$PWD"
    list=$(changed_files "$start") || exit 2
    while IFS= read -r f; do
        [ -n "$f" ] && is_checked "$f" && check_one "$f"
    done <<<"$list"
    if [ -z "$found" ]; then
        : >"$report"
        exit 0
    fi
    { echo "The edit hook would have told you:"; printf '%s' "$found"; } >"$report"
    exit 1
}

main "$@"
