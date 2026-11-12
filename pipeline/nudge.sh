#!/usr/bin/env bash
# Print the runner's nudges to the agent, once each (contract: pipeline/harness/README.md).
#
# Usage: pipeline/nudge.sh [--hook]
#
# The loop writes OUTBOX/nudge.md when a session has used its share of the time
# (PIPELINE_ADVISOR_NUDGE_SHARE) and OUTBOX/nudge-cap.md a few minutes before the cap
# (PIPELINE_SESSION_WARN_MINUTES). This prints every OUTBOX/nudge*.md, in name order, up to
# 4 KiB each, and renames each to .seen, so the next call prints nothing; a link is skipped.
# With --hook it prints a Claude Code PostToolUse hook reply carrying the texts, joined, as
# one additionalContext (the claude adapter's --settings); without, the plain text (bin/check
# runs it, which reaches Codex and agy). Always exits 0.
#
# Env read: OUTBOX (/outbox).
set -u
export LC_ALL=C

texts=()
for file in "${OUTBOX:-/outbox}"/nudge*.md; do
    [ -f "$file" ] && [ ! -L "$file" ] || continue
    text=$(head -c 4096 "$file")
    mv -f "$file" "${file%.md}.seen" 2>/dev/null || continue
    texts+=("$text")
done
[ "${#texts[@]}" -gt 0 ] || exit 0
joined=$(printf '%s\n' "${texts[@]}")
if [ "${1:-}" = --hook ]; then
    jq -cn --arg text "$joined" \
        '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $text}}'
else
    printf '%s\n' "$joined"
fi
exit 0
