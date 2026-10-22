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

Flags come in any order. An unknown flag or a missing required one prints the
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
- `DIR/usage.json`: `{"tokensIn", "tokensOut", "costUsd", "turns", "status"}`
  for the latest call only (the host sums per session). `status` is one of
  `ok`, `error`, `rate-limited`, `budget`, `unsupported`.

Exit status: 0 when the session ended on its own, 64 on a bad call, 69 when the
adapter is a stub (`status: unsupported`), 75 when rate-limited. Any other
non-zero status is the agent CLI's own failure.

## claude

Working. Runs `claude -p` with `--permission-mode acceptEdits`, the allow list
as `--allowedTools`, `--output-format stream-json --verbose`, saves the raw
stream to `DIR/stream.jsonl` and prints a readable log (`▶` for a tool call,
`■` for the result). `--max-budget-usd` is added only when
`PIPELINE_SESSION_BUDGET_USD` is set and not `0`; `--plugin-dir` only when
`PLUGIN_DIR` (default `/opt/gh-personas`) exists. `CLAUDE_BIN` overrides the
binary (the tests use `test/fixtures/pipeline/fake-claude`). Usage comes from
the last `result` event; `rate-limited` when its `subtype`, `error` or `result`
matches `rate limit|429|overloaded`, `budget` when `subtype` matches `budget`,
`error` when `is_error` or there is no result event. The edit hook runs inside
Claude Code, so no extra prompt text is needed.

## codex

Stub. A real adapter needs:

- `run`: `codex exec --json -C DIR --sandbox workspace-write -m MODEL "$prompt"`.
- `resume`: `codex exec resume SESSION_ID "$message"`.
- Session id and usage from the JSONL stream (`turn.completed` carries the
  token counts); a log filter like the claude one.
- The allow list has no equivalent; the container is the boundary.
- The hook-equivalent text below prepended to every prompt.

## opencode

Stub. A real adapter needs:

- `run`: `opencode run --model M --format json "$prompt"`.
- `resume`: the same with `--session ID`.
- Session id and usage from the JSON events.
- The allow list has no equivalent; the container is the boundary.
- The hook-equivalent text below prepended to every prompt.

## Hook-equivalent text

A harness without an edit hook prepends this to every prompt, verbatim:

> This harness has no edit hook. After every file you write, run `bin/check <file>` and `python3 .claude/hooks/check-file.py --advise <file>` and act on the output; the loop runs the same checks after you finish and will hand you anything you missed. Every GitHub write goes through `gh-as <persona>`; never bare `gh` or `git push`.
