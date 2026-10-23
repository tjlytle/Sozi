#!/usr/bin/env bash
# The shell of an interactive login container: prepares the persona profile volume,
# says what to run, then hands over the terminal.
#
# Env read: PROFILE (/profile), PIPELINE_LOGIN_PERSONA, PIPELINE_LOGIN_HARNESS (claude),
# AGY_HOME_LINK ($HOME/.gemini, where agy keeps its login; linked into the profile),
# SHELL_CMD (bash -l; the tests set it so no shell is left open).
set -u

PROFILE="${PROFILE:-/profile}"
persona="${PIPELINE_LOGIN_PERSONA:-unknown}"
harness="${PIPELINE_LOGIN_HARNESS:-claude}"

test -w "$PROFILE" || { echo "profile is not writable; rebuild the image (docker/factory/README.md)"; exit 1; }
mkdir -p "$PROFILE/claude" "$PROFILE/codex" "$PROFILE/gemini" "$PROFILE/xdg"
# agy has no setting for its directory, so its home path points into the profile.
link="${AGY_HOME_LINK:-$HOME/.gemini}"
[ -e "$link" ] || ln -s "$PROFILE/gemini" "$link"

echo "Logging in $persona; the profile is the volume sozi-factory-profile-$persona."
case "$harness" in
    claude)
        echo "Run \`claude\`, then \`/login\` (open the URL on the host, paste the code),"
        echo "then exit; for each allowed MCP server run \`claude mcp add --scope user <name> ...\`,"
        echo "then \`claude\` and \`/mcp\` to authorise it, then exit."
        ;;
    codex)
        echo "Run \`codex login --device-auth\` (open the URL on the host, enter the code), then exit."
        ;;
    agy)
        echo "Run \`agy\` and sign in (open the URL on the host, paste the code), then exit."
        ;;
    opencode)
        echo "Run \`opencode auth login\`, then exit."
        ;;
esac

# shellcheck disable=SC2086
exec ${SHELL_CMD:-bash -l}
