#!/usr/bin/env bash
# Print the runner's nudge to the agent, once (contract: pipeline/harness/README.md).
#
# Usage: pipeline/nudge.sh [--hook]
#
# The loop writes OUTBOX/nudge.md when a session has used its share of the time
# (PIPELINE_ADVISOR_NUDGE_SHARE). This prints it and renames it to nudge.seen, so the
# next call prints nothing. With --hook it prints a Claude Code PostToolUse hook reply
# carrying the text as additionalContext (the claude adapter's --settings); without, the
# plain text (bin/check runs it, which reaches Codex and agy). Always exits 0.
#
# Env read: OUTBOX (/outbox).
set -u

file="${OUTBOX:-/outbox}/nudge.md"
[ -f "$file" ] && [ ! -L "$file" ] || exit 0
text=$(head -c 4096 "$file")
mv -f "$file" "${file%.md}.seen" 2>/dev/null || exit 0
if [ "${1:-}" = --hook ]; then
    jq -cn --arg text "$text" \
        '{hookSpecificOutput: {hookEventName: "PostToolUse", additionalContext: $text}}'
else
    printf '%s\n' "$text"
fi
exit 0
