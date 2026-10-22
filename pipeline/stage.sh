#!/usr/bin/env bash
# The in-container half of the loop: one agent session for one issue and stage.
#
# Clones the repo, runs the harness adapter on the stage prompt, runs the
# repository's edit-hook checks from the outside (hooks-outside.sh) and resumes
# the session with what they find, then writes result.json for the host. The
# host reads result.json, never this script's exit status.
#
# Usage: pipeline/stage.sh <issue> <stage>   (the container's main process)
#
# Env read: PIPELINE_REPO, PIPELINE_HARNESS, PIPELINE_MODEL (required);
# PIPELINE_MAX_RESUMES (3); PIPELINE_OFFLINE (skip GitHub, for tests);
# MIRROR (/mirror), OUTBOX (/outbox), WORK (/work), CACHE (/cache),
# HARNESS_DIR (/pipeline/harness), HOOKS_OUTSIDE (/pipeline/hooks-outside.sh).
# The adapter reads its own credentials and PIPELINE_SESSION_BUDGET_USD. No
# value of the environment is ever printed.
set -u

issue="$1"
MIRROR="${MIRROR:-/mirror}"; OUTBOX="${OUTBOX:-/outbox}"; WORK="${WORK:-/work}"
CACHE="${CACHE:-/cache}"; HARNESS_DIR="${HARNESS_DIR:-/pipeline/harness}"
HOOKS_OUTSIDE="${HOOKS_OUTSIDE:-/pipeline/hooks-outside.sh}"
max_resumes="${PIPELINE_MAX_RESUMES:-3}"
start=""; harness_exit=1; resumes=0

step() { echo "== $1" | tee -a "$OUTBOX/log"; }

# Files changed since the start commit (tracked and untracked), one per line.
changed_files() {
    [ -n "$start" ] || return 0
    { git -C "$WORK" diff --name-only "$start"; git -C "$WORK" ls-files --others --exclude-standard; } |
        sort -u | while IFS= read -r f; do [ -f "$WORK/$f" ] && printf '%s\n' "$f"; done
}

# Lines on stdin as a compact JSON array of strings.
to_array() {
    if command -v jq >/dev/null; then jq -R . | jq -sc .
    else node -e 'const l=require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean);console.log(JSON.stringify(l))'; fi
}

# First element of a JSON array on stdin, as JSON (null when empty).
jq_first() {
    if command -v jq >/dev/null; then jq -c '.[0]'
    else node -e 'console.log(JSON.stringify(JSON.parse(require("fs").readFileSync(0,"utf8"))[0]??null))'; fi
}

# Write result.json from whatever state exists; runs on every exit.
write_result() {
    local session=null usage changed commits
    [ -s "$OUTBOX/session" ] && session=$(to_array <"$OUTBOX/session" | jq_first)
    usage='{"tokensIn":0,"tokensOut":0,"costUsd":0,"turns":0,"status":"error"}'
    [ -s "$OUTBOX/usage.json" ] && usage=$(cat "$OUTBOX/usage.json")
    changed=$(changed_files | to_array)
    commits=$([ -n "$start" ] && git -C "$WORK" log --oneline "$start..HEAD" 2>/dev/null | to_array || echo '[]')
    [ -n "$commits" ] || commits='[]'
    if command -v jq >/dev/null && echo "$usage" | jq -e . >/dev/null 2>&1; then
        jq -n --argjson exit "$harness_exit" --argjson session "$session" --argjson usage "$usage" \
            --argjson changed "$changed" --argjson commits "$commits" --argjson resumes "$resumes" \
            '{exit: $exit, session: $session, usage: $usage, changed: $changed, commits: $commits, resumes: $resumes}' \
            >"$OUTBOX/result.json"
    else
        node -e 'const a=process.argv;let u;try{u=JSON.parse(a[4])}catch{u={tokensIn:0,tokensOut:0,costUsd:0,turns:0,status:"error"}}
console.log(JSON.stringify({exit:+a[1],session:JSON.parse(a[2]),usage:u,changed:JSON.parse(a[5]),commits:JSON.parse(a[6]),resumes:+a[3]}))' \
            "$harness_exit" "$session" "$resumes" "$usage" "$changed" "$commits" >"$OUTBOX/result.json"
    fi
}

# Clone the mirror, point origin at GitHub, fetch.
clone_repo() {
    step clone
    git clone -q "$MIRROR" "$WORK" &&
        git -C "$WORK" remote set-url origin "https://github.com/$PIPELINE_REPO.git" || return 1
    [ "${PIPELINE_OFFLINE:-}" = 1 ] || git -C "$WORK" fetch -q origin
}

# Check out the issue's branch when it exists, else master.
checkout_branch() {
    step branch
    local remote=origin b
    [ "${PIPELINE_OFFLINE:-}" = 1 ] && remote="$MIRROR"
    b=$(git -C "$WORK" ls-remote --heads "$remote" "refs/heads/${issue}-*" | head -1 | sed 's#.*refs/heads/##')
    if [ -n "$b" ]; then git -C "$WORK" checkout -q -B "$b" "origin/$b"
    else git -C "$WORK" checkout -q -B master origin/master; fi
}

# Link the cached node_modules when the lockfile matches, else install.
install_modules() {
    step node_modules
    if [ -f "$CACHE/lock-sha" ] && [ "$(cat "$CACHE/lock-sha")" = "$(sha256sum "$WORK/package-lock.json" | cut -d' ' -f1)" ]; then
        ln -s "$CACHE/node_modules" "$WORK/node_modules"
    else
        (cd "$WORK" && npm ci --no-audit --no-fund)
    fi
}

# Run the adapter (run, or resume with --session/--message) and record its exit.
harness() {
    local -a mode=("$@")
    "$HARNESS_DIR/$PIPELINE_HARNESS" "${mode[@]}" --model "$PIPELINE_MODEL" --allow "$OUTBOX/allow.txt" \
        --checkout "$WORK" --out "$OUTBOX" 2>&1 | tee -a "$OUTBOX/log"
    harness_exit=${PIPESTATUS[0]}
}

# Run the outside hooks; resume the session while they find something new.
resume_loop() {
    local last="" report
    while [ "$resumes" -lt "$max_resumes" ] && [ "$harness_exit" -eq 0 ]; do
        step hooks
        report="$OUTBOX/report-$resumes.txt"
        "$HOOKS_OUTSIDE" "$WORK" "$start" "$report"
        [ -s "$report" ] || break
        [ "$(cat "$report")" = "$last" ] && break
        last=$(cat "$report")
        resumes=$((resumes + 1))
        step resume
        harness resume --session "$(cat "$OUTBOX/session")" --message "$report"
    done
}

main() {
    mkdir -p "$OUTBOX"
    trap write_result EXIT
    clone_repo && checkout_branch && install_modules || exit 0
    step tmp
    mkdir -p "$WORK/.agents/tmp"
    step start
    start=$(git -C "$WORK" rev-parse HEAD)
    step harness
    harness run --prompt "$OUTBOX/prompt.md"
    resume_loop
    step result
    exit 0
}

main
