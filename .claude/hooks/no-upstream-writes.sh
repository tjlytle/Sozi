#!/usr/bin/env bash
# PreToolUse hook (Bash): deny any command that writes to the upstream repo
# sozi-projects/Sozi. This fork only ever writes to tjlytle/Sozi.
cmd=$(jq -r '.tool_input.command // ""')
printf '%s' "$cmd" | grep -q 'sozi-projects/Sozi' || exit 0
if printf '%s' "$cmd" | grep -Eq 'gh-as|gh[[:space:]].*(issue[[:space:]]+(create|edit|close|comment|reopen|delete|transfer|pin|lock)|pr[[:space:]]+(create|edit|review|merge|close|ready|comment|reopen)|api[[:space:]].*-X[[:space:]]*(POST|PATCH|PUT|DELETE)|api[[:space:]].*--method[[:space:]]*(POST|PATCH|PUT|DELETE)|repo[[:space:]]+(edit|delete|rename|archive)|release[[:space:]]+(create|edit|delete))|git[[:space:]]+push'; then
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"Blocked: this command would write to sozi-projects/Sozi (upstream). This fork only writes to tjlytle/Sozi; pass -R tjlytle/Sozi."}}'
fi
