# Harness adapters

`pipeline/stage.sh` runs one agent session through an adapter: a small bash
script, one per agent CLI, named for the harness (`PIPELINE_HARNESS`). Every
adapter has the same contract, so the loop can run any agent and switch per
stage. Design: `docs/software-factory/loop-design.md`, "Harnesses".

## Contract

```
<adapter> run --prompt FILE --model M --allow FILE --checkout DIR --out DIR
<adapter> resume --session ID --message FILE --model M --allow FILE --checkout DIR --out DIR
```

The shared parsing lives in `lib.sh`, sourced by every adapter. File and
directory arguments are resolved to absolute paths. Flags come in any order. An unknown flag or a missing required one prints the
usage line to stderr and exits 64.

- `--prompt FILE`: the stage prompt (`run`). `--message FILE`: the text to
  continue with (`resume`; the hook findings). `--session ID`: the session to
  continue (`resume`).
- `--model M`: the model name, in the harness's own spelling.
- `--allow FILE`: the tool allow list, one rule per line; `#` comments and
  blank lines are ignored.
- `--checkout DIR`: the working tree; the agent runs there.
- `--out DIR`: the outbox. The adapter writes into it, see below.

Stdout (and stderr) is the log; the stage runner tees it. On exit the adapter
has written:

- `DIR/session`: the session id. `run` writes it before launching the agent, so
  a killed session still leaves its id.
- `DIR/usage.json`: `{"tokensIn", "cacheRead", "cacheWrite", "tokensOut", "costUsd",
  "turns", "status"}`. `tokensIn` is the input the model read fresh; cached input is never
  inside it. `cacheRead` is input read from the prompt cache, `cacheWrite` input written to
  it (0 for a harness that does not report it), `tokensOut` the output. The run total adds
  all four. These are
  the session's totals over every call of this OUT dir (a `resume` starts from the file
  it finds, a `run` from zero): tokens and turns summed when the CLI reports them per
  call, the larger of the previous count and this call's when it reports the whole
  session (codex and agy tokens, agy turns), so a call with no usage keeps them; cost the
  larger of the previous cost and this call's, status from the latest call. `status` is one of `ok`, `error`,
  `rate-limited`, `auth`, `budget`, `unsupported`. `auth` means the call failed to
  authenticate before any model call; the loop then starts nothing more as that
  persona until its credentials change. With `rate-limited` the file also has `limit`:
  the CLI's own limit message, up to 300 characters, which the loop reads the reset
  time from (`pipeline/lib/resets.js`); the adapter does not parse it.

A session stopped at a usage limit is carried on by the next one (design: "Usage
limits" in `docs/software-factory/loop-design.md`). On exit 75, `stage.sh` writes
`DIR/carry.bundle` (the commits on no remote branch) and `DIR/carry.patch` (the
uncommitted and untracked files); the loop copies both into the next session's outbox,
and `stage.sh` applies them after checking out the branch. Each limit replaces both with
the tree as it is then. When they do not apply, `stage.sh` never runs the adapter and
`result.json` says `"carry": "failed"`. When that session resumes
the same one, the loop sets `PIPELINE_RESUME_SESSION` and writes `DIR/resume.md`, and
`stage.sh` calls `resume --session $PIPELINE_RESUME_SESSION --message DIR/resume.md`
instead of `run`, falling back to `run` when the resume fails with 0 tokens.

Exit status: 0 when the session ended on its own, 64 on a bad call, 69 when the
adapter is a stub (`status: unsupported`), 75 when rate-limited. Any other
non-zero status is the agent CLI's own failure. The loop parks an issue at once
when its stage's harness is a stub, with a comment naming the harness.

## claude

Working. Runs `claude -p` with `--permission-mode acceptEdits`, the allow list
as `--allowedTools`, `--output-format stream-json --verbose`, saves the raw
stream to `DIR/stream.jsonl` and prints a readable log (`▶` for a tool call,
`■` for the result). `--max-budget-usd` is added only when
`PIPELINE_SESSION_BUDGET_USD` is set and not `0`. `--settings` adds a PostToolUse hook
(matcher `.*`) that runs `pipeline/nudge.sh --hook`, so the runner's nudge reaches the
session after its next tool call (see "Advice and nudges" below). No `--plugin-dir`: the container
has no plugin, and `gh-as` is `/opt/gh-as` from `packages/gh-as/` for every harness. `CLAUDE_BIN` overrides the
binary; it is one word, a path, not a command with arguments (the tests use `test/fixtures/pipeline/fake-claude`). Usage comes from
the last `result` event of the call (`usage.input_tokens`,
`usage.cache_read_input_tokens` as `cacheRead`, `usage.cache_creation_input_tokens` as
`cacheWrite`, `usage.output_tokens`): its tokens and turns are per call and
added up, its `total_cost_usd` is already the session's, and the cost kept is the
larger of the previous cost and this call's (a call stopped by a usage limit
reports 0, a call with no result event none); `rate-limited` when its `subtype` or `error`, or its `result` when `is_error`,
matches `rate.?limit|usage limit|hit your .*limit|429|overloaded` (case-insensitive), `auth` (checked first) when the call made no
model call (0 tokens) and its `result` or `error`, or the lines of the call that are
not JSON when there is no result event, say `Failed to authenticate`,
`authentication_error` or `401`, `budget` when `subtype` matches `budget`,
`error` when `is_error` or there is no result event. An allow file with no rules omits
`--allowedTools`; a missing one exits 64. The edit hook runs inside
Claude Code, so no extra prompt text is needed.

## codex

Working. Runs `codex exec --json --skip-git-repo-check
--dangerously-bypass-approvals-and-sandbox -C DIR -m MODEL -` with the prompt on stdin
(`resume SESSION -` continues a thread), saves the raw stream to `DIR/stream.jsonl` and
prints a readable log (`▶ command: …` for a tool call, `■ done` or `■ failed: …` at the
end). The container is the sandbox, so Codex runs without its own; the allow list has no
Codex equivalent and is only checked to exist. The session id is the `thread_id` of
`thread.started`, written as soon as the stream names it. Usage comes from this call's
`turn.completed` (`input_tokens`, `cached_input_tokens`, `output_tokens`). Codex counts
the cached input inside `input_tokens`, so it is split out: `cacheRead` is
`cached_input_tokens`, `tokensIn` is `input_tokens` minus it, and `cacheWrite` is 0, since
Codex reports none. `turn.completed` counts the whole thread, not the call: in the run and
resume recorded on 2026-11-12 (`test/fixtures/pipeline/codex-run.jsonl`,
`codex-resume.jsonl`) the resume reports input 38,685 and output 10 against the run's
19,335 and 5. So on `resume` each token count keeps the larger of the previous value and
this call's. `turns` counts this call's completed items and is added;
`costUsd` is 0, since a subscription reports no cost. `rate-limited` when a `turn.failed`
or `error` message matches `rate limit|usage limit|hit your … limit|429|overloaded`,
`error` for any other failure or no completed turn. `CODEX_BIN` overrides the binary;
`CODEX_HOME` (set by the profile) holds the login. Log in with
`npm run pipeline -- --login <persona> --harness codex`, then `codex login --device-auth`.

## agy

Working. Runs the Antigravity CLI: `agy -p TEXT --output-format stream-json --model MODEL
--dangerously-skip-permissions --add-dir OUT` in the checkout (`--conversation SESSION`
continues one), saves the raw stream to `OUT/stream.jsonl` and prints a readable log (text
deltas joined, `▶ <step type>: …` for a finished tool step, `■ <status> after N turns`).
Every tool call is approved, because the container is the sandbox; the allow list is only
checked to exist. The session id is the `conversation_id` of the `init` event. Usage comes
from the `result` event (`usage.input_tokens`, `usage.cache_read_tokens` as `cacheRead`, 0
when absent, `usage.output_tokens`, `num_turns`); `cacheWrite` is 0, since agy reports
none. The `result` counts the whole conversation, `num_turns` included: in the run and
resume recorded on 2026-11-12 (`test/fixtures/pipeline/agy-run.jsonl`, `agy-resume.jsonl`)
the resume reports input 12,197, output 10 and 2 turns against the run's 9,935, 5 and 1.
So on `resume` each count keeps the larger of the previous value and this call's.
`cache_read_tokens` is separate from `input_tokens`: the resume's second call read 2,262
fresh and 7,881 from the cache, and its `total_tokens` (2,267) is input plus output
without the cache read. `costUsd` is 0. `ok` when its `status` is `SUCCESS`, `rate-limited` when its error or
status matches `rate limit|usage limit|quota|RESOURCE_EXHAUSTED|429|overloaded`, `error`
otherwise or with no result. Model names are agy's own (`agy models`), and include Gemini
and Claude models. `AGY_BIN` overrides the binary. agy keeps its login in `~/.gemini` and
has no setting for that path, so the stage runner and the login container link it to
`/profile/gemini` (the login itself is `antigravity-cli/antigravity-oauth-token` there). Log in with `npm run pipeline -- --login <persona> --harness agy`, then
`agy`.

The tool-step fields of both log filters were checked against a real review session of
each (2026-10-23). The error texts that mean a limit come from neither yet: they are the
CLIs' known wording, checked the first time a stage hits a limit.

`turns` is each CLI's own count and does not compare across harnesses: Claude counts
assistant turns, Codex counts completed items (tool calls and messages), and agy counts
one turn per prompt. Compare harnesses by tokens and outcome instead.

## opencode

Stub. A real adapter needs:

- `run`: `opencode run --model M --format json "$prompt"`.
- `resume`: the same with `--session ID`.
- Session id and usage from the JSON events.
- The allow list has no equivalent; the container is the boundary.
- The hook-equivalent text below prepended to every prompt.

## Advice and nudges

Not part of the adapter contract, and the same for every harness, since both go through
the outbox (design: "A stuck session can ask the advisor" in
`docs/software-factory/loop-design.md`):

- `bin/advise "<question>" [--output FILE]` writes `OUT/advise/q-<n>.json` and waits for
  `OUT/advise/a-<n>.json`: `{"advice"}` (printed, exit 0), `{"refused"}` or `{"error"}`
  (exit 1), nothing within `PIPELINE_ADVISOR_WAIT_MINUTES` (exit 2). It reads
  `PIPELINE_ISSUE` and `PIPELINE_STAGE`, which `stage.sh` exports.
- `pipeline/nudge.sh` prints `OUT/nudge.md` once and renames it to `nudge.seen`. The claude
  adapter runs it as a PostToolUse hook with `--hook`, which wraps the text as
  `additionalContext`; `bin/check` runs it plain, which reaches a harness with no hook.
- The advisor's own calls run the claude adapter in a short container: `OUT` is the
  consult's outbox at `/consult`, the checkout `/advisor`, the allow list empty.

## Hook-equivalent text

A harness without an edit hook prepends this to every prompt, verbatim:

> This harness has no edit hook. After every file you write, run `bin/check <file>` and `python3 .claude/hooks/check-file.py --advise <file>` and act on the output; the loop runs the same checks after you finish and will hand you anything you missed. Every GitHub write goes through `gh-as <persona>`; never bare `gh` or `git push`.
