#!/usr/bin/env bash
# The files a session changed since its start commit, without what a merge brought in.
#
# Usage: pipeline/changed-files.sh <checkout> <start-sha>
#
# Prints, sorted and unique, one per line, the files that still exist among: those in
# the session's own commits (the first-parent line since <start-sha>, merges left out),
# those a first-parent merge commit wrote itself (a conflict resolved by hand or a hand
# edit: its result differs from every parent; a file merged cleanly matches one parent,
# so a clean merge of master adds nothing), uncommitted changes (staged or not) and
# untracked files. A branch with no commits of its own that fast-forwards to master counts
# master's commits as its own. Exit 2 when git failed (the git error is on stderr) or
# when <checkout> or <start-sha> is missing or empty (the usage line is on stderr).
# Reads no environment.
set -u

if ! { [ $# -ge 2 ] && [ -n "$1" ] && [ -n "$2" ]; }; then
    echo "usage: changed-files.sh <checkout> <start-sha>" >&2; exit 2
fi
checkout="$1"; start="$2"
cd "$checkout" || exit 2
g() { git -c core.quotePath=false "$@"; }

own=$(g log --first-parent --no-merges --name-only --format= "$start..HEAD") || exit 2
resolved=$(g log --first-parent --merges --cc --name-only --format= "$start..HEAD") || exit 2
uncommitted=$(g diff --name-only HEAD) || exit 2
untracked=$(g ls-files --others --exclude-standard) || exit 2
printf '%s\n%s\n%s\n%s\n' "$own" "$resolved" "$uncommitted" "$untracked" | sort -u | while IFS= read -r f; do
    [ -n "$f" ] && [ -f "$f" ] && printf '%s\n' "$f"
done
exit 0
