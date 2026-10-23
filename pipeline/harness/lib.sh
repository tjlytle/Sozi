#!/usr/bin/env bash
# Shared by the harness adapters (source it; contract: pipeline/harness/README.md).
#
# parse_args "$@" sets MODE, PROMPT, MODEL, ALLOW_FILE, CHECKOUT, OUT, SESSION
# and MESSAGE, resolving the file and directory arguments to absolute paths, and
# exits 64 with the usage line on stderr for anything unexpected.

USAGE="Usage: <adapter> run --prompt FILE --model M --allow FILE --checkout DIR --out DIR | resume --session ID --message FILE --model M --allow FILE --checkout DIR --out DIR"
MODE=""; PROMPT=""; MODEL=""; ALLOW_FILE=""; CHECKOUT=""; OUT=""; SESSION=""; MESSAGE=""

usage_exit() { echo "$USAGE" >&2; exit 64; }

parse_args() {
    MODE="${1:-}"; [ $# -gt 0 ] && shift
    while [ $# -gt 0 ]; do
        [ $# -ge 2 ] || usage_exit
        case "$1" in
            --prompt) PROMPT="$2" ;; --model) MODEL="$2" ;; --allow) ALLOW_FILE="$2" ;;
            --checkout) CHECKOUT="$2" ;; --out) OUT="$2" ;; --session) SESSION="$2" ;;
            --message) MESSAGE="$2" ;; *) usage_exit ;;
        esac
        shift 2
    done
    [ -n "$MODEL" ] && [ -n "$ALLOW_FILE" ] && [ -n "$CHECKOUT" ] && [ -n "$OUT" ] || usage_exit
    case "$MODE" in
        run) [ -n "$PROMPT" ] || usage_exit ;;
        resume) [ -n "$SESSION" ] && [ -n "$MESSAGE" ] || usage_exit ;;
        *) usage_exit ;;
    esac
    ALLOW_FILE=$(realpath -m "$ALLOW_FILE"); CHECKOUT=$(realpath -m "$CHECKOUT"); OUT=$(realpath -m "$OUT")
    [ -z "$PROMPT" ] || PROMPT=$(realpath -m "$PROMPT")
    [ -z "$MESSAGE" ] || MESSAGE=$(realpath -m "$MESSAGE")
}

# The text a harness without an edit hook puts before its stage prompt (README, verbatim).
HOOK_TEXT="This harness has no edit hook. After every file you write, run \`bin/check <file>\` and \`python3 .claude/hooks/check-file.py --advise <file>\` and act on the output; the loop runs the same checks after you finish and will hand you anything you missed. Every GitHub write goes through \`gh-as <persona>\`; never bare \`gh\` or \`git push\`."

# The text of this call: the hook text and the prompt for run, the message for resume.
call_text() {
    if [ "$MODE" = run ]; then
        printf '%s\n\n%s' "$HOOK_TEXT" "$(cat "$PROMPT")"
    else
        cat "$MESSAGE"
    fi
}
