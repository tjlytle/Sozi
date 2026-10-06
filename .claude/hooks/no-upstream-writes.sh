#!/usr/bin/env bash
# PreToolUse hook (Bash): deny a command that names the upstream repository
# sozi-projects/Sozi (any letter case) together with a GitHub write. This fork
# only ever writes to tjlytle/Sozi.
#
# This guards against accidental writes that name the upstream explicitly in
# the command text. It is not a complete control: it does not resolve git
# remotes, aliases, variables or commands run from scripts.
#
# Allow: exit 0 with no output. Deny: exit 0 with a PreToolUse deny JSON.
# Fails closed: if jq is missing or cannot parse the payload, deny.

deny() {
    printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","permissionDecision":"deny","permissionDecisionReason":"%s"}}' "$1"
    exit 0
}

if ! command -v jq >/dev/null 2>&1 || ! cmd=$(jq -r '.tool_input.command // ""' 2>/dev/null); then
    deny "Blocked: hook could not parse the command (jq missing or invalid payload)."
fi

printf '%s' "$cmd" | grep -qi 'sozi-projects/sozi' || exit 0

# GitHub write subcommands, shared by gh and gh-as. `gh api` with a field or
# an input body sends a POST without -X.
writes='(issue[[:space:]]+(create|edit|close|comment|reopen|delete|transfer|pin|lock)|pr[[:space:]]+(create|edit|review|merge|close|ready|comment|reopen)|api[[:space:]].*(-X|--method)[[:space:]=]*(POST|PATCH|PUT|DELETE)|api[[:space:]](.*[[:space:]])?(-f|-F|--field|--raw-field|--input)([[:space:]=]|$)|repo[[:space:]]+(edit|delete|rename|archive)|release[[:space:]]+(create|edit|delete))'

if printf '%s' "$cmd" | grep -Eiq "gh[[:space:]].*${writes}|gh-as[[:space:]]+[^[:space:]]+[[:space:]]+(${writes}|--push|--git[[:space:]]+push)|git[[:space:]]+push"; then
    deny "Blocked: this command would write to sozi-projects/Sozi (upstream). This fork only writes to tjlytle/Sozi; pass -R tjlytle/Sozi."
fi
exit 0
