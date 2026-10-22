#!/usr/bin/env bash
# Reports what a persona profile holds, for the host to check before a stage runs.
#
# Prints one JSON line: {"claude": {"present", "loggedIn", "servers"}, "codex":
# {"present", "loggedIn"}, "writable"}. Only booleans and MCP server names are printed;
# no value from any file in the profile is ever read out.
#
# Env read: PROFILE (/profile).
set -u

PROFILE="${PROFILE:-/profile}"

claude_present=false
[ -e "$PROFILE/claude" ] && claude_present=true
codex_present=false
[ -e "$PROFILE/codex" ] && codex_present=true
codex_logged_in=false
[ -e "$PROFILE/codex/auth.json" ] && codex_logged_in=true
writable=false
[ -w "$PROFILE" ] && writable=true

claude_logged_in=false
creds="$PROFILE/claude/.credentials.json"
if [ -e "$creds" ]; then
    claude_logged_in=$(node -e '
        try {
            const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
            console.log(c !== null && typeof c === "object" && "claudeAiOauth" in c ? "true" : "false");
        } catch (_) {
            console.log("false");
        }' "$creds" 2>/dev/null || echo false)
fi

servers='[]'
settings="$PROFILE/claude/.claude.json"
if [ -e "$settings" ]; then
    servers=$(node -e '
        try {
            const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
            const m = c && typeof c.mcpServers === "object" && c.mcpServers !== null ? c.mcpServers : {};
            console.log(JSON.stringify(Object.keys(m).sort()));
        } catch (_) {
            console.log("[]");
        }' "$settings" 2>/dev/null || echo '[]')
fi

printf '{"claude":{"present":%s,"loggedIn":%s,"servers":%s},"codex":{"present":%s,"loggedIn":%s},"writable":%s}\n' \
    "$claude_present" "$claude_logged_in" "$servers" "$codex_present" "$codex_logged_in" "$writable"
