#!/usr/bin/env bash
# Copies one persona profile into another, leaving the Claude login out.
#
# Copies of one login share its refresh token, and the first refresh breaks the rest, so the
# target's claude/.credentials.json loses claudeAiOauth and keeps every other key (mcpOAuth
# among them). The file is removed when nothing is left and left alone when it does not parse.
# No value from any file in the profile is ever printed.
#
# Env read: FROM (/from), PROFILE (/profile).
set -eu

FROM="${FROM:-/from}"
PROFILE="${PROFILE:-/profile}"

cp -a "$FROM/." "$PROFILE/"

creds="$PROFILE/claude/.credentials.json"
if [ -e "$creds" ]; then
    node -e '
        const fs = require("fs");
        const file = process.argv[1];
        let c;
        try {
            c = JSON.parse(fs.readFileSync(file, "utf8"));
        } catch (_) {
            process.exit(0);
        }
        if (c === null || typeof c !== "object" || Array.isArray(c)) {
            process.exit(0);
        }
        delete c.claudeAiOauth;
        if (Object.keys(c).length === 0) {
            fs.rmSync(file);
        } else {
            fs.writeFileSync(file, JSON.stringify(c), {mode: 0o600});
            fs.chmodSync(file, 0o600);
        }' "$creds" >/dev/null 2>&1 || {
        # Node's own message could quote the file, so it stays hidden.
        echo "could not remove the Claude login from $creds" >&2
        exit 1
    }
fi
