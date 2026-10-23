#!/usr/bin/env bash
# Reports what a persona profile holds, for the host to check before a stage runs.
#
# Prints one JSON line: {"claude": {"present", "loggedIn", "servers", "updated"}, "codex":
# {"present", "loggedIn", "servers"}, "agy": {"present", "loggedIn", "servers"}, "writable"}.
# Claude's "servers" merges the user-scope and every local-scope (per project) MCP server
# name; Codex's are the [mcp_servers.<name>] tables of config.toml; agy's the keys of
# mcpServers in config/mcp_config.json (or its top-level keys when it has none). "updated"
# is the ISO modification time of the Claude credentials file, or null without one. Only
# booleans, MCP server names and that time are printed; no value from any file in the
# profile is ever read out.
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
agy_present=false
[ -e "$PROFILE/gemini" ] && agy_present=true
agy_logged_in=false
[ -e "$PROFILE/gemini/antigravity-cli/antigravity-oauth-token" ] && agy_logged_in=true
writable=false
[ -w "$PROFILE" ] && writable=true

claude_logged_in=false
claude_updated=null
creds="$PROFILE/claude/.credentials.json"
if [ -e "$creds" ]; then
    claude_updated=$(node -e '
        console.log(JSON.stringify(require("fs").statSync(process.argv[1]).mtime.toISOString()));
        ' "$creds" 2>/dev/null || echo null)
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
    # User-scope servers sit at the top level, local-scope ones under projects.<path>.
    servers=$(node -e '
        try {
            const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
            const isMap = m => m !== null && typeof m === "object" && !Array.isArray(m);
            const maps = isMap(c) ? [c.mcpServers] : [];
            if (isMap(c) && isMap(c.projects)) {
                for (const p of Object.values(c.projects)) {
                    maps.push(isMap(p) ? p.mcpServers : undefined);
                }
            }
            const names = new Set(maps.filter(isMap).flatMap(m => Object.keys(m)));
            console.log(JSON.stringify([...names].sort()));
        } catch (_) {
            console.log("[]");
        }' "$settings" 2>/dev/null || echo '[]')
fi

codex_servers=$(sed -n -E 's/^[[:space:]]*\[mcp_servers\.("?)([^]".]+)\1\][[:space:]]*$/\2/p' \
    "$PROFILE/codex/config.toml" 2>/dev/null | sort -u | node -e '
        const names = require("fs").readFileSync(0, "utf8").split("\n").filter(Boolean);
        console.log(JSON.stringify(names));' 2>/dev/null || echo '[]')

agy_servers='[]'
agy_mcp="$PROFILE/gemini/config/mcp_config.json"
if [ -s "$agy_mcp" ]; then
    agy_servers=$(node -e '
        try {
            const c = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
            const isMap = m => m !== null && typeof m === "object" && !Array.isArray(m);
            const map = isMap(c) && isMap(c.mcpServers) ? c.mcpServers : isMap(c) ? c : {};
            console.log(JSON.stringify(Object.keys(map).sort()));
        } catch (_) {
            console.log("[]");
        }' "$agy_mcp" 2>/dev/null || echo '[]')
fi

printf '{"claude":{"present":%s,"loggedIn":%s,"servers":%s,"updated":%s},"codex":{"present":%s,"loggedIn":%s,"servers":%s},"agy":{"present":%s,"loggedIn":%s,"servers":%s},"writable":%s}\n' \
    "$claude_present" "$claude_logged_in" "$servers" "$claude_updated" "$codex_present" "$codex_logged_in" \
    "$codex_servers" "$agy_present" "$agy_logged_in" "$agy_servers" "$writable"
