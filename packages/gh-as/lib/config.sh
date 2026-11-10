# gh-personas shared config: sourced by bin/gh-as, bin/gh-personas and the hooks.
# Reads the consumer repo's `## GitHub Workflow` block (CLAUDE.md, then AGENTS.md,
# at the git toplevel) and resolves a persona to an identity mode.
#
# Lines read (all optional):
#   Bots: advocate=advocate, architect=architect, builder=claude-dev, qa=-
#   Personas: off                 # disable gh-personas in this repo
#   Marker: 🤖 **[{persona}]**     # marker-mode prefix; {persona} is substituted
#   Require PR: no                # allow direct pushes to the default branch
#   Trail map: docs/rfcs/*.md = architect rfc; notes/*.md = -
#   Trail: off                    # disable the trail bridge reminders

GHP_PERSONAS="advocate architect builder qa reviewer ops"
GHP_DEFAULT_MARKER='🤖 **[{persona}]**'

ghp_toplevel() { git rev-parse --show-toplevel 2>/dev/null; }

# Print the `## GitHub Workflow` block of the repo's agent instructions file.
ghp_block() {
  local top f
  top=$(ghp_toplevel) || return 0
  for f in "$top/CLAUDE.md" "$top/AGENTS.md" "$top/.claude/CLAUDE.md"; do
    [ -f "$f" ] || continue
    if grep -q '^## GitHub Workflow' "$f"; then
      awk '/^## GitHub Workflow/{on=1;next} on&&/^## /{exit} on' "$f"
      return 0
    fi
  done
}

# ghp_config <Key> → value of the first "Key:" line in the block (trimmed), or empty.
ghp_config() {
  ghp_block | awk -v k="$1" '
    { line=$0; sub(/^[-*][ \t]*/, "", line) }
    tolower(substr(line, 1, length(k)+1)) == tolower(k ":") {
      v=substr(line, length(k)+2); sub(/^[ \t]+/, "", v); sub(/[ \t]+$/, "", v); print v; exit
    }'
}

ghp_is_persona() { case " $GHP_PERSONAS " in *" $1 "*) return 0 ;; esac; return 1; }

ghp_off() {
  case "$(ghp_config Personas | tr 'A-Z' 'a-z')" in off|no|false|disabled) return 0 ;; esac
  return 1
}

# ghp_resolve <persona|bot|-> → one of: "user", "off", "marker", "bot <name>"
ghp_resolve() {
  local who="$1" bots val
  if [ "$who" = "-" ]; then echo user; return; fi
  if ghp_off; then echo off; return; fi
  if ! ghp_is_persona "$who"; then echo "bot $who"; return; fi   # explicit bot name, e.g. claude-dev
  bots=$(ghp_config Bots)
  [ -n "$bots" ] || { echo marker; return; }
  val=$(printf '%s\n' "$bots" | tr ',' '\n' | awk -F= -v p="$who" '
    { gsub(/^[ \t]+|[ \t]+$/, "", $1); gsub(/^[ \t]+|[ \t]+$/, "", $2) }
    $1 == p { print $2; exit }')
  case "$val" in ""|-) echo marker ;; *) echo "bot $val" ;; esac
}

# ghp_marker <persona> → the marker text for this repo.
ghp_marker() {
  local tpl
  tpl=$(ghp_config Marker)
  [ -n "$tpl" ] || tpl="$GHP_DEFAULT_MARKER"
  printf '%s' "${tpl//\{persona\}/$1}"
}

ghp_require_pr() {
  case "$(ghp_config 'Require PR' | tr 'A-Z' 'a-z')" in no|false|off) return 1 ;; esac
  return 0
}

ghp_repo_from_origin() {
  local url
  url=$(git config --get remote.origin.url 2>/dev/null) || return 1
  url=${url%.git}
  case "$url" in
    git@*:*)   printf '%s' "${url#*:}" ;;
    http*://*) printf '%s' "$url" | sed -E 's#https?://[^/]+/##' ;;
    *)         return 1 ;;
  esac
}

ghp_default_branch() {
  git symbolic-ref --quiet --short refs/remotes/origin/HEAD 2>/dev/null | sed 's#^origin/##' || true
}
