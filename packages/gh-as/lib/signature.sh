# gh-as signature: sourced by bin/gh-as. Not part of the upstream plugin (see README.md).
#
# Only while GH_AS_SIGNATURE is non-empty:
#   - the body of `gh issue|pr create|comment|edit` and `gh pr review` gets a blank line and
#     the signature appended, unless its last non-blank line already is the signature;
#   - `git commit` gets a `Harness:` trailer (GH_AS_HARNESS) and a `Model:` trailer
#     (GH_AS_MODEL), each only when its variable is set.
#
# A signed copy of a body file goes in the directory `sig_dir`, which bin/gh-as makes with
# `gh_as_tmpdir` and removes when it exits, whether gh succeeded or not.

# gh_as_tmpdir → a new directory for this run's body copies, signed or marked.
gh_as_tmpdir() {
  mktemp -d "${TMPDIR:-/tmp}/gh-as-run.XXXXXX"
}

# sig_applies <gh args…> → success when the command's body is signed.
sig_applies() {
  [ -n "${GH_AS_SIGNATURE:-}" ] || return 1
  case "${1:-} ${2:-}" in
    "issue create"|"issue comment"|"issue edit") return 0 ;;
    "pr create"|"pr comment"|"pr edit"|"pr review") return 0 ;;
  esac
  return 1
}

# sig_signed <body> → success when the body's last non-blank line is the signature.
sig_signed() {
  [ "$(printf '%s\n' "$1" | awk 'NF { last = $0 } END { print last }')" = "$GH_AS_SIGNATURE" ]
}

# sig_append <body> → the body with the signature after a blank line, or unchanged when signed.
sig_append() {
  if sig_signed "$1"; then printf '%s' "$1"
  elif [ -z "$1" ]; then printf '%s\n' "$GH_AS_SIGNATURE"
  else printf '%s\n\n%s\n' "$1" "$GH_AS_SIGNATURE"
  fi
}

# sig_file <path|-> → a file in sig_dir holding the signed body; the caller's own path when
# already signed.
sig_file() {
  local src="$1" body tmp
  if [ "$src" = "-" ]; then body=$(cat); else body=$(cat "$src"); fi
  if [ "$src" != "-" ] && sig_signed "$body"; then printf '%s' "$src"; return; fi
  tmp=$(mktemp "${sig_dir:?gh_as_tmpdir first}/body.XXXXXX")
  sig_append "$body" > "$tmp"
  printf '%s' "$tmp"
}

# Rewrite gh args so the body carries the signature (NUL-separated output).
signed_gh_args() {
  local out=() a
  while [ $# -gt 0 ]; do
    a="$1"; shift
    case "$a" in
      -b|--body)      out+=("$a" "$(sig_append "${1:-}")"); shift || true ;;
      --body=*)       out+=("--body=$(sig_append "${a#--body=}")") ;;
      -F|--body-file) out+=("$a" "$(sig_file "${1:--}")"); shift || true ;;
      --body-file=*)  out+=("--body-file=$(sig_file "${a#--body-file=}")") ;;
      *)              out+=("$a") ;;
    esac
  done
  printf '%s\0' "${out[@]}"
}

# sig_trailers → the `--trailer` arguments for a commit (NUL-separated output), or nothing.
sig_trailers() {
  [ -n "${GH_AS_SIGNATURE:-}" ] || return 0
  [ -z "${GH_AS_HARNESS:-}" ] || printf '%s\0' --trailer "Harness: $GH_AS_HARNESS"
  [ -z "${GH_AS_MODEL:-}" ] || printf '%s\0' --trailer "Model: $GH_AS_MODEL"
  return 0
}
