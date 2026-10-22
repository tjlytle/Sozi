#!/usr/bin/env bash
# The in-container half of the loop: one agent session for one issue and stage.
#
# Clones the repo, runs the harness adapter on the stage prompt, runs the
# repository's edit-hook checks from the outside (hooks-outside.sh) and resumes
# the session with what they find, then writes result.json for the host. The
# host reads result.json, never this script's exit status. result.json is also
# written on an early failure and on SIGTERM/SIGINT (docker stop).
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
start=""; harness_exit=1; resumes=0; hooks_state=ok; child=""

step() { echo "== $1" | tee -a "$OUTBOX/log"; }

# Files changed since the start commit (tracked and untracked), one per line.
changed_files() {
    [ -n "$start" ] || return 0
    { git -C "$WORK" -c core.quotePath=false diff --name-only "$start"
      git -C "$WORK" -c core.quotePath=false ls-files --others --exclude-standard; } |
        sort -u | while IFS= read -r f; do [ -f "$WORK/$f" ] && printf '%s\n' "$f"; done
    return 0
}

# Lines on stdin as a compact JSON array of strings.
to_array() {
    if command -v jq >/dev/null; then jq -R . | jq -sc .
    else node -e 'const l=require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean);console.log(JSON.stringify(l))'; fi
}

# Write result.json from whatever state exists; runs on every exit.
write_result() {
    local sfile=/dev/null usage changed commits out="$OUTBOX/result.json"
    [ -s "$OUTBOX/session" ] && sfile="$OUTBOX/session"
    usage='{"tokensIn":0,"tokensOut":0,"costUsd":0,"turns":0,"status":"error"}'
    [ -s "$OUTBOX/usage.json" ] && usage=$(cat "$OUTBOX/usage.json")
    changed=$(changed_files | to_array)
    commits='[]'
    [ -n "$start" ] && commits=$(git -C "$WORK" log --oneline "$start..HEAD" 2>/dev/null | to_array)
    if command -v jq >/dev/null && echo "$usage" | jq -e . >/dev/null 2>&1; then
        jq -n --argjson exit "$harness_exit" --rawfile session "$sfile" --argjson usage "$usage" \
            --argjson changed "$changed" --argjson commits "$commits" --argjson resumes "$resumes" \
            --arg hooks "$hooks_state" \
            '{exit: $exit, session: (if $session == "" then null else ($session | rtrimstr("\n")) end), usage: $usage, changed: $changed, commits: $commits, resumes: $resumes, hooks: $hooks}' \
            >"$out.tmp"
    else
        node -e 'const a=process.argv;let u;try{u=JSON.parse(a[4])}catch{u={tokensIn:0,tokensOut:0,costUsd:0,turns:0,status:"error"}}
console.log(JSON.stringify({exit:+a[1],session:require("fs").readFileSync(a[2],"utf8").trim()||null,usage:u,changed:JSON.parse(a[5]),commits:JSON.parse(a[6]),resumes:+a[3],hooks:a[7]}))' \
            "$harness_exit" "$sfile" "$resumes" "$usage" "$changed" "$commits" "$hooks_state" >"$out.tmp"
    fi
    mv "$out.tmp" "$out"
}

# docker stop: record the interruption and leave; the exit trap writes the result.
on_signal() { harness_exit=$((128 + $1)); exit $((128 + $1)); }

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
# In the background so a signal interrupts the wait at once.
harness() {
    ( "$HARNESS_DIR/$PIPELINE_HARNESS" "$@" --model "$PIPELINE_MODEL" --allow "$OUTBOX/allow.txt" \
        --checkout "$WORK" --out "$OUTBOX" 2>&1 | tee -a "$OUTBOX/log"; exit "${PIPESTATUS[0]}" ) &
    child=$!
    wait "$child"
    harness_exit=$?
}

# Run the outside hooks; resume the session while they find something new.
resume_loop() {
    local last="" report rc
    if [ "$harness_exit" -eq 0 ] && [ ! -s "$OUTBOX/session" ]; then
        step "no session file"
        return
    fi
    while [ "$resumes" -lt "$max_resumes" ] && [ "$harness_exit" -eq 0 ]; do
        step hooks
        report="$OUTBOX/report-$resumes.txt"
        "$HOOKS_OUTSIDE" "$WORK" "$start" "$report"
        rc=$?
        if [ "$rc" -gt 1 ] || { [ "$rc" -eq 1 ] && [ ! -s "$report" ]; } || [ ! -e "$report" ]; then
            step "hooks-outside failed (exit $rc)"
            hooks_state=error
            break
        fi
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
    trap 'on_signal 15' TERM
    trap 'on_signal 2' INT
    case "$PIPELINE_HARNESS" in */*) step "harness name rejected"; exit 0 ;; esac
    clone_repo && checkout_branch && install_modules || exit 0
    step tmp; mkdir -p "$WORK/.agents/tmp"
    step start; start=$(git -C "$WORK" rev-parse HEAD)
    step harness; harness run --prompt "$OUTBOX/prompt.md"
    resume_loop
    step result
    exit 0
}

main
