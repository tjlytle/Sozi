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
binary; it is one word, a path, not a command with arguments (the tests use `test/fixtures/pipeline/fake-claude`). Usage comes from
the last `result` event; `rate-limited` when its `subtype` or `error`, or its `result` when `is_error`,
matches `rate limit|429|overloaded`, `budget` when `subtype` matches `budget`,
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
`turn.completed` (`input_tokens`, `output_tokens`); `turns` counts the completed items;
`costUsd` is 0, since a subscription reports no cost. `rate-limited` when a `turn.failed`
or `error` message matches `rate limit|usage limit|hit your … limit|429|overloaded`,
`error` for any other failure or no completed turn. `CODEX_BIN` overrides the binary;
`CODEX_HOME` (set by the profile) holds the login. Log in with
`npm run pipeline -- --login <persona> --harness codex`, then `codex login --device-auth`.

## agy

Working. Runs the Antigravity CLI: `agy -p TEXT --output-format stream-json --model MODEL
--dangerously-skip-permissions --add-dir DIR` in the checkout (`--conversation SESSION`
continues one), saves the raw stream to `DIR/stream.jsonl` and prints a readable log (text
deltas joined, `▶ <step type>: …` for a finished tool step, `■ <status> after N turns`).
Every tool call is approved, because the container is the sandbox; the allow list is only
checked to exist. The session id is the `conversation_id` of the `init` event. Usage comes
from the `result` event (`usage.input_tokens`, `usage.output_tokens`, `num_turns`);
`costUsd` is 0. `ok` when its `status` is `SUCCESS`, `rate-limited` when its error or
status matches `rate limit|usage limit|quota|RESOURCE_EXHAUSTED|429|overloaded`, `error`
otherwise or with no result. Model names are agy's own (`agy models`), and include Gemini
and Claude models. `AGY_BIN` overrides the binary. agy keeps its login in `~/.gemini` and
has no setting for that path, so the stage runner and the login container link it to
`/profile/gemini` (the login itself is `antigravity-cli/antigravity-oauth-token` there). Log in with `npm run pipeline -- --login <persona> --harness agy`, then
`agy`.

The tool-step field names in the log filter (`command_line`, `file_path`) and the error
texts that mean a limit come from short trial runs; they are checked against a real stage
before either harness runs one unattended.

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
