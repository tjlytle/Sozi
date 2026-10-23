#!/usr/bin/env bash
# The files a session changed since its start commit, without what a merge brought in.
#
# Usage: pipeline/changed-files.sh <checkout> <start-sha>
#
# Prints, sorted and unique, one per line, the files that still exist among: those in
# the session's own commits (the first-parent line since <start-sha>, merges left out,
# so a merge of master adds nothing), uncommitted changes (staged or not) and untracked
# files. A branch with no commits of its own that fast-forwards to master counts
# master's commits as its own. Exit 2 when git failed (the git error is on stderr).
# Reads no environment.
set -u

checkout="$1"; start="$2"
cd "$checkout" || exit 2
g() { git -c core.quotePath=false "$@"; }

own=$(g log --first-parent --no-merges --name-only --format= "$start..HEAD") || exit 2
uncommitted=$(g diff --name-only HEAD) || exit 2
untracked=$(g ls-files --others --exclude-standard) || exit 2
printf '%s\n%s\n%s\n' "$own" "$uncommitted" "$untracked" | sort -u | while IFS= read -r f; do
    [ -n "$f" ] && [ -f "$f" ] && printf '%s\n' "$f"
done
exit 0
