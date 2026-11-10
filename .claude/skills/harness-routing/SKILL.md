---
name: harness-routing
description: Which harness and model each stage of an issue runs on (claude, codex, agy, opencode), and why. Use when writing the Harness heading of an Implementation Plan, or when asked which agent should build, review, test or QA a kind of change.
---

# Harness routing

Each stage of an issue (`tests`, `build`, `review`, `qa`) runs on the harness and model its
setting names (`PIPELINE_HARNESS_<STAGE>`, `PIPELINE_MODEL_<STAGE>`, in `pipeline/config`),
unless the issue's Implementation Plan has a line for it under **Harness**. The architect
writes those lines from the rules below when the issue is planned.

## The rules

Tim's two rules (2026-10-23) start the list. A rule names the stage, the harness and the
model, and says why.

1. **Reviews run on Codex.** Every issue: `- review: codex gpt-6.1-sol`. A reviewer on another
   model than the builder catches what the builder's model takes for granted.
2. **Presenter UI changes run on Codex.** When the change is in the presenter's panels,
   templates or CSS (`src/js/presenter/`, `src/js/presenter.js`, the presenter's templates
   and stylesheets): `- build: codex gpt-6.1-sol`. Tim wants to compare Codex on UI work.

Everything else stays on its stage setting: write no line for it. When no rule applies,
the Harness heading says "none".

## Writing the lines

- One line per stage that leaves its setting: `- <stage>: <harness> <model>`.
- The stage is one of `tests`, `build`, `review`, `qa`. The `plan` stage cannot be routed:
  no plan exists when it starts.
- The harness is one of `claude`, `codex`, `agy`, `opencode`.
- Every line names a model. Model names do not carry across harnesses (`claude-opus-5-5`
  means nothing to Codex), so the loop does not fall back to the stage's model.
- The loop refuses a line it cannot read, and a harness the stage's persona has no login
  for (`profile of reviewer is not logged in to codex: run …`). The issue waits; it is
  never moved to another harness.

## Growing the list

Add a rule when a trial shows one harness does a kind of work better, with the date, who
decided and the reason, in the same shape as the two above. A rule that stops paying off
is deleted, not commented out.
