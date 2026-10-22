#!/usr/bin/env bash
# The shell of an interactive login container: prepares the persona profile volume,
# says what to run, then hands over the terminal.
#
# Env read: PROFILE (/profile), PIPELINE_LOGIN_PERSONA, PIPELINE_LOGIN_HARNESS (claude),
# SHELL_CMD (bash -l; the tests set it so no shell is left open).
set -u

PROFILE="${PROFILE:-/profile}"
persona="${PIPELINE_LOGIN_PERSONA:-unknown}"
harness="${PIPELINE_LOGIN_HARNESS:-claude}"

test -w "$PROFILE" || { echo "profile is not writable; rebuild the image (docker/factory/README.md)"; exit 1; }
mkdir -p "$PROFILE/claude" "$PROFILE/codex" "$PROFILE/xdg"

echo "Logging in $persona; the profile is the volume sozi-factory-profile-$persona."
case "$harness" in
    claude)
        echo "Run \`claude\`, then \`/login\` (open the URL on the host, paste the code),"
        echo "then exit; for each allowed MCP server run \`claude mcp add --scope user <name> ...\`,"
        echo "then \`claude\` and \`/mcp\` to authorise it, then exit."
        ;;
    codex)
        echo "Run \`codex login\`, then exit."
        ;;
    opencode)
        echo "Run \`opencode auth login\`, then exit."
        ;;
esac

# shellcheck disable=SC2086
exec ${SHELL_CMD:-bash -l}
