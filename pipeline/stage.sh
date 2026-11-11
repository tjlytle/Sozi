#!/usr/bin/env bash
# The in-container half of the loop: one agent session for one issue and stage.
#
# Clones the repo, runs the harness adapter on the stage prompt, runs the
# repository's edit-hook checks from the outside (hooks-outside.sh) and resumes
# the session with what they find, then writes result.json for the host. The
# checks run again after every resume, the last one included; PIPELINE_MAX_RESUMES
# caps the resumes, not the checks, so 0 still checks once. The host reads
# result.json, never this script's exit status. result.json is also written on an
# early failure and on SIGTERM/SIGINT (docker stop). Its hooks field is ok when the
# outside checks ran, error when they crashed, skipped when they never ran (an early
# failure, a failing harness, no session file).
#
# A session stopped at a usage limit (harness exit 75) leaves its work in the outbox:
# carry.bundle (its unpushed commits) and carry.patch (its uncommitted and untracked
# files). When the loop copies them into the next session's outbox, they are applied
# on top of the issue's branch before the harness runs; when they do not apply, the
# harness never runs and result.json says carry "failed". With PIPELINE_RESUME_SESSION
# that harness session is resumed with resume.md instead of a fresh run; a resume
# that fails before any model call (0 tokens) falls back to the run.
#
# Usage: pipeline/stage.sh <issue> <stage>   (the container's main process)
#
# Env read: PIPELINE_REPO, PIPELINE_HARNESS, PIPELINE_MODEL (required);
# PIPELINE_MAX_RESUMES (3); PIPELINE_OFFLINE (skip GitHub, for tests);
# PIPELINE_RESUME_SESSION (the session to resume);
# PIPELINE_PERSONA (when set, exported to gh-as as GH_AS_SIGNATURE, GH_AS_HARNESS, GH_AS_MODEL);
# MIRROR (/mirror), OUTBOX (/outbox), WORK (/work), CACHE (/cache),
# HARNESS_DIR (/pipeline/harness), HOOKS_OUTSIDE (/pipeline/hooks-outside.sh),
# CHANGED_FILES (/pipeline/changed-files.sh);
# XVFB_BIN (Xvfb), DISPLAY_NUM (99), X11_DIR (/tmp/.X11-unix) for the session display;
# PROFILE (/profile) and AGY_HOME_LINK ($HOME/.gemini) for the agy login.
# The adapter reads its own credentials and PIPELINE_SESSION_BUDGET_USD. No
# value of the environment is ever printed. PIPELINE_STAGE is exported for bin/advise.
set -u

issue="$1"
export PIPELINE_STAGE="${2:-}"
MIRROR="${MIRROR:-/mirror}"; OUTBOX="${OUTBOX:-/outbox}"; WORK="${WORK:-/work}"
CACHE="${CACHE:-/cache}"; HARNESS_DIR="${HARNESS_DIR:-/pipeline/harness}"
HOOKS_OUTSIDE="${HOOKS_OUTSIDE:-/pipeline/hooks-outside.sh}"
CHANGED_FILES="${CHANGED_FILES:-/pipeline/changed-files.sh}"
max_resumes="${PIPELINE_MAX_RESUMES:-3}"
XVFB_BIN="${XVFB_BIN:-Xvfb}"; DISPLAY_NUM="${DISPLAY_NUM:-99}"; X11_DIR="${X11_DIR:-/tmp/.X11-unix}"
PROFILE="${PROFILE:-/profile}"; AGY_HOME_LINK="${AGY_HOME_LINK:-$HOME/.gemini}"
start=""; harness_exit=1; resumes=0; hooks_state=skipped; carry_state=""; child=""; xvfb_pid=""

step() { echo "== $1" | tee -a "$OUTBOX/log"; }

# Files the session changed since the start commit (changed-files.sh), one per line.
changed_files() {
    [ -n "$start" ] || return 0
    "$CHANGED_FILES" "$WORK" "$start"
    return 0
}

# Lines on stdin as a compact JSON array of strings.
to_array() {
    if command -v jq >/dev/null; then jq -R . | jq -sc .
    else node -e 'const l=require("fs").readFileSync(0,"utf8").split("\n").filter(Boolean);console.log(JSON.stringify(l))'; fi
}

# After a usage limit (exit 75), leave the session's work for the next one: the commits
# on no remote branch as carry.bundle, the uncommitted and untracked files as carry.patch.
# The carry this session started from is removed first, so the files hold the tree as it is
# now; neither is written when there is nothing to carry.
write_carry() {
    local ref patch="$OUTBOX/carry.patch"
    [ "$harness_exit" -eq 75 ] && [ -n "$start" ] || return 0
    rm -f "$OUTBOX/carry.bundle" "$patch"
    ref=$(git -C "$WORK" symbolic-ref -q HEAD) || ref=HEAD
    if [ -n "$(git -C "$WORK" rev-list "$ref" --not --remotes -- 2>/dev/null | head -1)" ]; then
        git -C "$WORK" bundle create "$OUTBOX/carry.bundle" "$ref" --not --remotes 2>/dev/null
    fi
    git -C "$WORK" add -A && git -C "$WORK" diff --cached --binary HEAD >"$patch.tmp"
    git -C "$WORK" reset -q
    if [ -s "$patch.tmp" ]; then mv "$patch.tmp" "$patch"; else rm -f "$patch.tmp"; fi
}

# Put back the work of a session a usage limit stopped: its commits, on the branch they
# were made on, then its uncommitted and untracked files. Fails, with a log line, when any
# of it does not apply; the carry files stay in the outbox for the loop to keep.
apply_carry() {
    local bundle="$OUTBOX/carry.bundle" patch="$OUTBOX/carry.patch" head
    if [ -s "$bundle" ]; then
        step carry
        head=$(git -C "$WORK" bundle list-heads "$bundle" 2>/dev/null | head -1 | cut -d' ' -f2)
        if [ -z "$head" ] || ! git -C "$WORK" fetch -q "$bundle" "$head"; then
            step "carry: bundle failed"
            return 1
        fi
        case "$head" in
            refs/heads/*) git -C "$WORK" checkout -q -B "${head#refs/heads/}" FETCH_HEAD ;;
            *) git -C "$WORK" checkout -q --detach FETCH_HEAD ;;
        esac || { step "carry: checkout failed"; return 1; }
    fi
    if [ -s "$patch" ]; then
        step carry-files
        git -C "$WORK" apply --binary "$patch" || { step "carry: patch failed"; return 1; }
    fi
    return 0
}

# Write result.json from whatever state exists; runs on every exit. Its commits are the
# session's own: first parents only, no merge commits, so a merge of master adds none.
# Its usage is null when the harness left no usage.json (or one that is not JSON), so
# the host can tell a missing report from a real one. Its carry is "failed" when the
# carried work did not apply and the harness never ran.
write_result() {
    local sfile=/dev/null usage=null changed commits out="$OUTBOX/result.json"
    write_carry
    [ -s "$OUTBOX/session" ] && sfile="$OUTBOX/session"
    [ -s "$OUTBOX/usage.json" ] && usage=$(cat "$OUTBOX/usage.json")
    changed=$(changed_files | to_array)
    commits='[]'
    [ -n "$start" ] && commits=$(git -C "$WORK" log --oneline --first-parent --no-merges \
        "$start..HEAD" 2>/dev/null | to_array)
    if command -v jq >/dev/null && echo "$usage" | jq . >/dev/null 2>&1; then
        jq -n --argjson exit "$harness_exit" --rawfile session "$sfile" --argjson usage "$usage" \
            --argjson changed "$changed" --argjson commits "$commits" --argjson resumes "$resumes" \
            --arg hooks "$hooks_state" --arg carry "$carry_state" \
            '{exit: $exit, session: (if $session == "" then null else ($session | rtrimstr("\n")) end), usage: $usage, changed: $changed, commits: $commits, resumes: $resumes, hooks: $hooks} + (if $carry == "" then {} else {carry: $carry} end)' \
            >"$out.tmp"
    else
        node -e 'const a=process.argv;let u;try{u=JSON.parse(a[4])}catch{u=null}
console.log(JSON.stringify({exit:+a[1],session:require("fs").readFileSync(a[2],"utf8").trim()||null,usage:u,changed:JSON.parse(a[5]),commits:JSON.parse(a[6]),resumes:+a[3],hooks:a[7],...(a[8]?{carry:a[8]}:{})}))' \
            "$harness_exit" "$sfile" "$resumes" "$usage" "$changed" "$commits" "$hooks_state" "$carry_state" >"$out.tmp"
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

# One virtual display for the whole session, so Electron and Chromium can draw (and be
# screenshotted) without xvfb-run, which does not return in a container (#73). Only when
# no display is set and Xvfb exists; waits up to 5 s for the display's socket.
start_display() {
    [ -n "${DISPLAY:-}" ] && return 0
    command -v "$XVFB_BIN" >/dev/null || return 0
    step display
    "$XVFB_BIN" ":$DISPLAY_NUM" -screen 0 1920x1080x24 -nolisten tcp >/dev/null 2>&1 &
    xvfb_pid=$!
    export DISPLAY=":$DISPLAY_NUM"
    local i
    for i in $(seq 50); do [ -e "$X11_DIR/X$DISPLAY_NUM" ] && break; sleep 0.1; done
}

stop_display() { [ -n "$xvfb_pid" ] && kill "$xvfb_pid" 2>/dev/null; return 0; }

# Run the adapter (run, or resume with --session/--message) and record its exit.
# In the background so a signal interrupts the wait at once.
harness() {
    ( "$HARNESS_DIR/$PIPELINE_HARNESS" "$@" --model "$PIPELINE_MODEL" --allow "$OUTBOX/allow.txt" \
        --checkout "$WORK" --out "$OUTBOX" 2>&1 | tee -a "$OUTBOX/log"; exit "${PIPESTATUS[0]}" ) &
    child=$!
    wait "$child"
    harness_exit=$?
}

# The tokens the last call reported, 0 when it reported none.
tokens_used() {
    jq -r '(.tokensIn // 0) + (.tokensOut // 0)' "$OUTBOX/usage.json" 2>/dev/null || echo 0
}

# The session's first call: resume the session a usage limit stopped with resume.md when
# PIPELINE_RESUME_SESSION names it, else run the prompt. A resume that fails with no
# tokens used never reached the model (the transcript is gone): run the prompt instead.
first_call() {
    if [ -n "${PIPELINE_RESUME_SESSION:-}" ]; then
        echo "$PIPELINE_RESUME_SESSION" >"$OUTBOX/session"
        harness resume --session "$PIPELINE_RESUME_SESSION" --message "$OUTBOX/resume.md"
        case "$harness_exit" in 0 | 75) return ;; esac
        [ "$(tokens_used)" = 0 ] || return
        step "resume failed, running the prompt"
        rm -f "$OUTBOX/session" "$OUTBOX/usage.json"
    fi
    harness run --prompt "$OUTBOX/prompt.md"
}

# Run the outside hooks; resume the session while they find something new.
resume_loop() {
    local last="" report rc
    if [ "$harness_exit" -eq 0 ] && [ ! -s "$OUTBOX/session" ]; then
        step "no session file"
        return
    fi
    while [ "$harness_exit" -eq 0 ]; do
        step hooks
        report="$OUTBOX/report-$resumes.txt"
        "$HOOKS_OUTSIDE" "$WORK" "$start" "$report"
        rc=$?
        if [ "$rc" -gt 1 ] || { [ "$rc" -eq 1 ] && [ ! -s "$report" ]; } || [ ! -e "$report" ]; then
            step "hooks-outside failed (exit $rc)"
            hooks_state=error
            break
        fi
        hooks_state=ok
        [ -s "$report" ] || break
        [ "$(cat "$report")" = "$last" ] && break
        last=$(cat "$report")
        [ "$resumes" -ge "$max_resumes" ] && break
        resumes=$((resumes + 1))
        step resume
        harness resume --session "$(cat "$OUTBOX/session")" --message "$report"
    done
}

# agy keeps its login in ~/.gemini and has no setting for it, so that path points into
# the persona profile when the profile holds one.
link_agy() {
    if [ -d "$PROFILE/gemini" ] && [ ! -e "$AGY_HOME_LINK" ]; then
        ln -s "$PROFILE/gemini" "$AGY_HOME_LINK"
    fi
    return 0
}

# What gh-as signs with (packages/gh-as/README.md): the persona, harness and model of this
# stage. Only when the loop names the persona; without it gh-as signs nothing.
export_signature() {
    [ -n "${PIPELINE_PERSONA:-}" ] || return 0
    export GH_AS_SIGNATURE="$PIPELINE_PERSONA · $PIPELINE_HARNESS · $PIPELINE_MODEL"
    export GH_AS_HARNESS="$PIPELINE_HARNESS" GH_AS_MODEL="$PIPELINE_MODEL"
}

main() {
    mkdir -p "$OUTBOX"
    trap 'write_result; stop_display' EXIT
    trap 'on_signal 15' TERM
    trap 'on_signal 2' INT
    case "$PIPELINE_HARNESS" in */*) step "harness name rejected"; exit 0 ;; esac
    clone_repo && checkout_branch && install_modules || exit 0
    step tmp; mkdir -p "$WORK/.agents/tmp"
    start_display
    link_agy
    export_signature
    step start; start=$(git -C "$WORK" rev-parse HEAD)
    # A carry that does not apply ends the session before the harness: none of the tree is
    # the session's work, and its outbox still holds the carry.
    apply_carry || { carry_state=failed; start=""; exit 0; }
    step harness; first_call
    resume_loop
    step result
    exit 0
}

main
