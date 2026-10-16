#!/usr/bin/env python3
"""Repo lock: a PreToolUse hook (Bash) that denies any gh, gh-as or git push
command whose target repository is not one of the locked repositories.

    python3 repo-lock.py OWNER/REPO [OWNER/REPO ...]

The locked repositories are the arguments. Every gh command that acts on a
repository must act on one of them:

  * `-R` / `--repo` names the repository explicitly: it must be locked.
  * No `-R`: the repository gh would resolve from the working directory
    (`gh repo set-default`, or the only remote) must be locked. A directory
    with several remotes and no default is ambiguous and is denied, which is
    exactly the fork-clone case that once sent issues to the parent repository.
  * A GitHub URL positional (`gh issue view https://github.com/o/r/issues/1`)
    is a target too.
  * `gh api repos/O/R/...` targets O/R; `{owner}/{repo}` placeholders resolve
    from the working directory; `gh api graphql` is checked for owner/name
    pairs and a mutation that names no repository is denied.
  * `git push` and `gh-as <who> --push` resolve the remote in the working
    directory (after any `cd` or `git -C` in the command).

Commands that do not act on a repository (`gh auth`, `gh api rate_limit`,
`gh search`, `gh project`, ...) are allowed. Reads of other repositories are
denied like writes: the lock is "only this repository", not "no writes".

Fails closed: anything it cannot parse or resolve is denied with a reason.
Allow: exit 0 with no output. Deny: exit 0 with a PreToolUse deny JSON.
"""
import json
import os
import re
import shlex
import subprocess
import sys

REPO_SUBCOMMANDS = {
    "issue", "pr", "release", "label", "workflow", "run", "secret", "variable",
    "cache", "ruleset", "browse", "milestone", "attestation",
}
# gh repo <verb>: which verbs take a repository as their first positional.
REPO_VERB_POSITIONAL = {
    "clone", "fork", "view", "edit", "delete", "archive", "unarchive", "sync",
    "set-default", "deploy-key", "gitignore", "license", "autolink",
}
REPO_VERB_CWD_ONLY = {"rename"}      # positional is the new name, repo from -R or cwd
REPO_VERB_FREE = {"list", "create"}  # list: no repo; create: a new repo, never locked
GH_FREE = {
    "auth", "config", "extension", "extensions", "alias", "completion",
    "status", "search", "gpg-key", "ssh-key", "codespace", "cs", "org",
    "project", "version", "help", "copilot", "preview", "agent-task",
}
# gh flags that take a value (so the value is never mistaken for a positional).
GH_VALUE_FLAGS = {
    "-R", "--repo", "-X", "--method", "-f", "-F", "--field", "--raw-field",
    "-H", "--header", "--input", "-p", "--preview", "-q", "--jq", "-t",
    "--template", "--hostname", "--cache", "-b", "--body", "-B", "--body-file",
    "-T", "--title", "-l", "--label", "-a", "--assignee", "-m", "--milestone",
    "-P", "--project", "-S", "--search", "-s", "--state", "-L", "--limit",
    "-A", "--author", "--mention", "-r", "--reviewer", "-c", "--comment",
    "-e", "--editor", "-w", "--web", "--json", "--template", "-h", "--head",
    "--base", "-M", "--match", "-O", "--order", "--sort", "-n", "--notes",
    "-d", "--description", "--add-label", "--remove-label", "--add-assignee",
    "--remove-assignee", "--add-project", "--remove-project", "--add-reviewer",
    "--remove-reviewer", "--color", "--name", "--branch", "--recurse-submodules",
    "--env", "--org", "--user", "--owner", "--subject", "--match-head-commit",
    "--commit", "--pattern", "--key", "--path", "--ref", "-i", "--interval",
    "--since", "--until", "--limit", "--verbosity", "--format", "-D",
    "--delete-local", "--gitignore", "--license", "--homepage", "--source",
    "--remote", "--team", "--include-all-branches", "--default-branch",
    "--visibility", "--allow-forking", "--enable-issues", "--enable-wiki",
    "--pushdir", "--assignee", "--discussion-category", "--target", "--tag",
    "--latest", "--prerelease", "--notes-file", "--notes-start-tag",
    "--verify-tag", "--clobber", "--from-stdin", "--fields",
}
# Flags whose value is a repo-ish thing but not a target.
GIT_PUSH_VALUE_OPTS = {"-o", "--push-option", "--receive-pack", "--exec", "--repo"}

URL_RE = re.compile(
    r"^(?:https?://|ssh://)?(?:git@)?([^/:@\s]+)[/:]([^/\s]+)/([^/\s#?]+)", re.I
)
GRAPHQL_OWNER_RE = re.compile(r'owner\s*:\s*["\']([^"\']+)["\']', re.I)
GRAPHQL_NAME_RE = re.compile(r'name\s*:\s*["\']([^"\']+)["\']', re.I)


def deny(reason):
    sys.stdout.write(json.dumps({
        "hookSpecificOutput": {
            "hookEventName": "PreToolUse",
            "permissionDecision": "deny",
            "permissionDecisionReason": reason,
        }
    }))
    sys.exit(0)


class Unresolved(Exception):
    pass


# --- target normalisation ---------------------------------------------------

def normalise(target):
    """'OWNER/REPO', 'HOST/OWNER/REPO' or any GitHub URL -> 'owner/repo'."""
    t = target.strip().strip("'\"")
    if "://" in t or t.startswith("git@"):
        m = URL_RE.match(t)
        if not m or m.group(1).lower() != "github.com":
            raise Unresolved(f"not a github.com repository: {target}")
        owner, repo = m.group(2), m.group(3)
    else:
        parts = t.split("/")
        if len(parts) == 3 and parts[0].lower() == "github.com":
            parts = parts[1:]
        if len(parts) == 3:
            raise Unresolved(f"not a github.com repository: {target}")
        if len(parts) != 2 or not all(parts):
            raise Unresolved(f"not a repository: {target}")
        owner, repo = parts
    if repo.endswith(".git"):
        repo = repo[:-4]
    return f"{owner}/{repo}".lower()


def repo_from_url_prefix(token):
    """A positional that is a github.com URL -> 'owner/repo', else None."""
    if not re.match(r"^https?://github\.com/", token, re.I):
        return None
    try:
        return normalise(token)
    except Unresolved:
        return None


# --- working-directory resolution --------------------------------------------

def git(cwd, *args):
    r = subprocess.run(["git", "-C", cwd, *args], capture_output=True, text=True,
                       timeout=5)
    return r.returncode, r.stdout.strip()


def remote_url(cwd, name):
    code, out = git(cwd, "remote", "get-url", "--push", name)
    if code != 0 or not out:
        raise Unresolved(f"no remote {name!r} in {cwd}")
    return normalise(out)


def repo_from_cwd(cwd):
    """What gh would use with no -R: the set-default remote, or the only remote."""
    code, out = git(cwd, "rev-parse", "--show-toplevel")
    if code != 0:
        raise Unresolved(f"{cwd} is not a git repository")
    code, out = git(cwd, "config", "--get-regexp", r"^remote\..*\.gh-resolved$")
    if code == 0 and out:
        key, _, value = out.splitlines()[0].partition(" ")
        name = key[len("remote."):-len(".gh-resolved")]
        if value.strip() == "base":
            return remote_url(cwd, name)
        return normalise(value)
    code, out = git(cwd, "remote")
    remotes = [r for r in out.splitlines() if r]
    if len(remotes) == 1:
        return remote_url(cwd, remotes[0])
    if not remotes:
        raise Unresolved(f"{cwd} has no remotes")
    raise Unresolved(
        f"{cwd} has remotes {', '.join(remotes)} and no gh default "
        "(run `gh repo set-default` there or pass -R)")


# --- command splitting -------------------------------------------------------

def unquoted_newlines_to_semicolons(cmd):
    out, quote, esc = [], None, False
    for ch in cmd:
        if esc:
            out.append(ch)
            esc = False
            continue
        if ch == "\\" and quote != "'":
            out.append(ch)
            esc = True
            continue
        if quote:
            if ch == quote:
                quote = None
            out.append(ch)
            continue
        if ch in ("'", '"'):
            quote = ch
            out.append(ch)
        elif ch == "\n":
            out.append(" ; ")
        else:
            out.append(ch)
    return "".join(out)


def segments(cmd):
    """Split a shell command into simple commands (token lists)."""
    lex = shlex.shlex(unquoted_newlines_to_semicolons(cmd), posix=True,
                      punctuation_chars=";&|()<>")
    lex.whitespace_split = True
    segs, cur = [], []
    for tok in lex:
        if tok and all(c in ";&|()<>" for c in tok):
            if cur:
                segs.append(cur)
            cur = []
        else:
            cur.append(tok)
    if cur:
        segs.append(cur)
    return segs


def strip_prefixes(tokens):
    """Drop VAR=val, env, command, exec, nice, timeout N, sudo ... prefixes."""
    i = 0
    while i < len(tokens):
        t = tokens[i]
        if re.match(r"^[A-Za-z_][A-Za-z0-9_]*=", t):
            i += 1
        elif t in ("env", "command", "exec", "nice", "sudo", "nohup", "time",
                   "do", "then", "else", "elif", "if", "while", "until", "!", "{"):
            i += 1
        elif t == "timeout" and i + 1 < len(tokens):
            i += 2
        else:
            break
    return tokens[i:]


# --- gh argument analysis ----------------------------------------------------

def gh_targets(args, cwd):
    """Return the list of repositories a gh invocation acts on, or [] for a
    command that acts on none. Raises Unresolved when it cannot tell."""
    explicit = []
    positionals = []
    values = {}     # flag -> list of values (for api)
    i = 0
    while i < len(args):
        a = args[i]
        if a == "--":
            positionals.extend(args[i + 1:])
            break
        if a.startswith("--") and "=" in a:
            flag, _, val = a.partition("=")
            values.setdefault(flag, []).append(val)
            if flag == "--repo":
                explicit.append(val)
            i += 1
            continue
        if a.startswith("-R") and len(a) > 2:
            explicit.append(a[2:])
            i += 1
            continue
        if re.match(r"^-[fFHXpqt][^\s]+$", a):   # -ftitle=x, -XPOST
            values.setdefault(a[:2], []).append(a[2:])
            i += 1
            continue
        if a in GH_VALUE_FLAGS:
            val = args[i + 1] if i + 1 < len(args) else ""
            values.setdefault(a, []).append(val)
            if a in ("-R", "--repo"):
                explicit.append(val)
            i += 2
            continue
        if a.startswith("-"):
            i += 1
            continue
        positionals.append(a)
        i += 1

    if not positionals:
        return []
    sub = positionals[0]
    targets = []

    if sub in GH_FREE:
        return []

    url_targets = [r for r in (repo_from_url_prefix(p) for p in positionals[1:]) if r]

    if sub in REPO_SUBCOMMANDS:
        if explicit:
            targets.extend(normalise(e) for e in explicit)
        targets.extend(url_targets)
        if not targets:
            targets.append(repo_from_cwd(cwd))
        return targets

    if sub == "repo":
        verb = positionals[1] if len(positionals) > 1 else ""
        rest = positionals[2:]
        if verb in REPO_VERB_FREE:
            if verb == "create":
                raise Unresolved("gh repo create makes a repository outside the lock")
            return []
        if explicit:
            targets.extend(normalise(e) for e in explicit)
        if verb in REPO_VERB_POSITIONAL and rest:
            targets.append(normalise(rest[0]))
        elif verb == "deploy-key" and len(rest) > 1 and "/" in rest[1]:
            targets.append(normalise(rest[1]))
        if not verb:
            return []
        if not targets:
            targets.append(repo_from_cwd(cwd))
        return targets

    if sub == "api":
        endpoint = positionals[1] if len(positionals) > 1 else ""
        if explicit:
            targets.extend(normalise(e) for e in explicit)
        m = re.match(r"^/?repos/([^/\s]+)/([^/\s]+)", endpoint)
        if m:
            if "{" in m.group(0):
                targets.append(repo_from_cwd(cwd))
            else:
                targets.append(normalise(f"{m.group(1)}/{m.group(2)}"))
        elif "{owner}" in endpoint or "{repo}" in endpoint:
            targets.append(repo_from_cwd(cwd))
        elif re.match(r"^https?://api\.github\.com/repos/", endpoint, re.I):
            m = re.match(r"^https?://api\.github\.com/repos/([^/]+)/([^/?#]+)", endpoint, re.I)
            targets.append(normalise(f"{m.group(1)}/{m.group(2)}"))
        elif endpoint == "graphql":
            text = " ".join(
                v for f in ("-f", "-F", "--field", "--raw-field", "--input")
                for v in values.get(f, []))
            fields = {}
            for v in values.get("-f", []) + values.get("-F", []) + \
                    values.get("--field", []) + values.get("--raw-field", []):
                k, _, val = v.partition("=")
                fields[k] = val
            owners = GRAPHQL_OWNER_RE.findall(text)
            names = GRAPHQL_NAME_RE.findall(text)
            if "owner" in fields and "name" in fields:
                owners.append(fields["owner"])
                names.append(fields["name"])
            for o, n in zip(owners, names):
                targets.append(normalise(f"{o}/{n}"))
            for v in fields.values():
                if re.match(r"^[\w.-]+/[\w.-]+$", v):
                    targets.append(normalise(v))
            if not targets and re.search(r"\bmutation\b", text, re.I):
                raise Unresolved("gh api graphql mutation names no repository")
        return targets

    # Anything else (an extension, an unknown subcommand): only check explicit
    # and URL targets.
    targets.extend(normalise(e) for e in explicit)
    targets.extend(url_targets)
    return targets


# --- git push analysis -------------------------------------------------------

def git_push_target(args, cwd):
    """args are the git arguments; returns the pushed-to repo or None if not a push."""
    i = 0
    while i < len(args):
        a = args[i]
        if a == "-C" and i + 1 < len(args):
            cwd = os.path.expanduser(args[i + 1])
            if not os.path.isabs(cwd):
                raise Unresolved(f"relative git -C {args[i + 1]!r}")
            i += 2
        elif a in ("-c", "--git-dir", "--work-tree", "--namespace", "--exec-path") \
                and i + 1 < len(args):
            i += 2
        elif a.startswith("-"):
            i += 1
        else:
            break
    if i >= len(args) or args[i] != "push":
        return None
    rest = args[i + 1:]
    remote = None
    j = 0
    while j < len(rest):
        a = rest[j]
        if a == "--":
            if j + 1 < len(rest):
                remote = rest[j + 1]
            break
        if a in GIT_PUSH_VALUE_OPTS:
            if a == "--repo" and j + 1 < len(rest):
                remote = rest[j + 1]
            j += 2
            continue
        if a.startswith("--repo="):
            remote = a[len("--repo="):]
            j += 1
            continue
        if a.startswith("-"):
            j += 1
            continue
        remote = a
        break
    if remote is None:
        code, out = git(cwd, "config", "--get", "remote.pushDefault")
        remote = out if code == 0 and out else "origin"
    if "://" in remote or remote.startswith("git@") or "/" in remote:
        return normalise(remote)
    return remote_url(cwd, remote)


# --- main --------------------------------------------------------------------

def main():
    shown_as = {normalise(a): a.strip() for a in sys.argv[1:]}
    locked = set(shown_as)
    lock_list = ", ".join(shown_as[k] for k in sorted(shown_as))
    first = shown_as[sorted(shown_as)[0]] if shown_as else ""
    try:
        payload = json.load(sys.stdin)
    except Exception:
        deny("repo lock: could not parse the hook payload")
    cmd = (payload.get("tool_input") or {}).get("command") or ""
    if not re.search(r"\bg(h|it)\b", cmd):
        return
    cwd = payload.get("cwd") or os.environ.get("CLAUDE_PROJECT_DIR") or os.getcwd()

    try:
        segs = segments(cmd)
    except ValueError as e:
        deny(f"repo lock: could not parse the command ({e})")

    eff = cwd
    for seg in segs:
        toks = strip_prefixes(seg)
        if not toks:
            continue
        name = os.path.basename(toks[0])
        if name == "cd":
            if len(toks) == 1 or toks[1] == "~":
                eff = os.path.expanduser("~")
            elif toks[1] == "-":
                eff = None
            else:
                p = os.path.expanduser(toks[1])
                eff = p if os.path.isabs(p) else (os.path.join(eff, p) if eff else None)
            continue
        if name == "pushd" and len(toks) > 1:
            p = os.path.expanduser(toks[1])
            eff = p if os.path.isabs(p) else (os.path.join(eff, p) if eff else None)
            continue
        if name not in ("gh", "gh-as", "git"):
            continue
        if not locked:
            deny("repo lock: no repositories are locked; add OWNER/REPO arguments "
                 "to the hook command in settings")
        shown = " ".join(toks[:6]) + (" …" if len(toks) > 6 else "")
        try:
            where = eff
            if where is None:
                raise Unresolved("working directory unknown after `cd -`")
            if name == "gh":
                targets = gh_targets(toks[1:], where)
            elif name == "gh-as":
                if len(toks) < 3:
                    continue
                if toks[2] == "--push":
                    targets = [remote_url(where, "origin")]
                elif toks[2] == "--git":
                    t = git_push_target(toks[3:], where)
                    targets = [t] if t else []
                else:
                    targets = gh_targets(toks[2:], where)
            else:
                t = git_push_target(toks[1:], where)
                targets = [t] if t else []
        except Unresolved as e:
            deny(f"repo lock: cannot tell which repository `{shown}` acts on "
                 f"({e}). Pass -R {first}.")
        except subprocess.TimeoutExpired:
            deny(f"repo lock: git timed out resolving `{shown}`. Pass -R {first}.")
        for t in targets:
            if t not in locked:
                deny(f"repo lock: `{shown}` acts on {t}; this project only acts on "
                     f"{lock_list}.")


if __name__ == "__main__":
    main()
