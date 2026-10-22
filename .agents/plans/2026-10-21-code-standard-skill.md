# Code Standard Skill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give agents a declarative code standard as a skill, and make every hook, script and lint message cite it instead of the reasoning record.

**Architecture:** `docs/software-factory/code-standard.md` stays untouched as the record. A new skill at `.claude/skills/code-standard/` condenses it: `SKILL.md` is the short part every session loads (commands, boundaries, judgment rules) and `references/<section>.md` hold the per-section detail an agent loads when it needs that part. The record's section numbers are kept so citations stay stable. Every message that today says `code-standard.md N` says `standard N` instead, where "the standard" is the skill. `AGENTS.md` makes the same instructions reach Codex and OpenCode, `.agents/` holds what only agents read (plans, a scratch directory), and `docs/` stays for people.

**Tech Stack:** Markdown (Agent Skills frontmatter), the existing ESLint/Stylelint configs, Python hook, Node scripts, `node:test`.

**Spec:** `docs/software-factory/loop-design.md`, section "The standard agents read is a skill, not the record".

## Global Constraints

- The record `docs/software-factory/code-standard.md` is not edited except for one status line pointing at the skill.
- The skill keeps the record's numbering (1.1 to 6.5) so that `standard 2.3` means the same thing in both; `SKILL.md` stays under 100 lines and each reference file under 120.
- Agent-only artifacts live under `.agents/` (`plans/`, `tmp/` gitignored); `docs/` is for people and agents both.
- No message printed by a hook, a `bin/` script, ESLint or Stylelint contains the string `code-standard.md` after this plan.
- `npm test` stays green (298 tests today); `npm run check` stays red only on the pre-existing cleanup files.
- Every commit goes through `gh-as builder --git commit` (the gh-personas hook blocks bare commits).

## Review Focus

- A skill longer than a screen or two stops being read; `SKILL.md` must stay under 100 lines. Task 1 asserts a line ceiling.
- A rule that exists in the record but not in the skill is a rule no agent follows. Task 1's test checks every numbered heading of the record has a counterpart in `SKILL.md` or a reference file, and that `SKILL.md` names every reference file so an agent knows it exists.
- The ESLint config test filters messages by the string `code-standard.md`; renaming without updating it makes 22 tests pass vacuously. Task 2 changes the filter first and watches it fail.
- Codex and OpenCode read `AGENTS.md`, not `CLAUDE.md`; a missing or stale `AGENTS.md` means those harnesses never see the GitHub workflow block or the skill. Task 3 makes it a symlink so it cannot drift.
- The hook's `--advise` output is what the loop's outside pass hands back to a session (loop plan); its wording must name the skill section so the session can look it up.

---

### Task 1: Write the skill

**Files:**
- Create: `.claude/skills/code-standard/SKILL.md`, `.claude/skills/code-standard/references/javascript.md` (section 2), `css.md` (3), `dependencies.md` (4), `change.md` (5), `tests.md` (6)
- Modify: `docs/software-factory/code-standard.md:3-5` (status line only)
- Test: `test/standard/skill.test.js`

**Interfaces:**
- Produces: `SKILL.md` with frontmatter `name: code-standard` and a `description` beginning "The Sozi fork's code standard"; body: the commands (section 1 in full, it is short), the three boundaries every change meets (2.3 the deck never depends on a surface, 2.5 messages through `src/js/protocol/`, 2.6 no HTML from strings outside `src/js/html/`), the judgment rules (2.1, 2.2, 2.8, 6.2, 6.5) in words, and a list "Read when you touch it:" naming each reference file with one line on what it covers. Each reference file carries `### N.M <title>` for every `### N.M` heading of its record section.

- [ ] **Step 1: Write the failing test**

```js
// test/standard/skill.test.js
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const dir = ".claude/skills/code-standard";
const skill = fs.readFileSync(`${dir}/SKILL.md`, "utf8");
const refs = Object.fromEntries(fs.readdirSync(`${dir}/references`).map(f => [f, fs.readFileSync(`${dir}/references/${f}`, "utf8")]));
const all = skill + Object.values(refs).join("\n");
const record = fs.readFileSync("docs/software-factory/code-standard.md", "utf8");

describe("the code standard skill", () => {
    test("has Agent Skills frontmatter", () => {
        assert.match(skill, /^---\nname: code-standard\ndescription: The Sozi fork's code standard/);
    });
    test("covers every numbered section of the record, in SKILL.md or a reference", () => {
        const numbers = [...record.matchAll(/^### (\d\.\d) /gm)].map(m => m[1]);
        assert.ok(numbers.length >= 20);
        for (const n of numbers) {
            assert.match(all, new RegExp(`^### ${n.replace(".", "\\.")} `, "m"), `section ${n}`);
        }
    });
    test("SKILL.md names every reference file", () => {
        assert.deepEqual(Object.keys(refs).sort(), ["change.md", "css.md", "dependencies.md", "javascript.md", "tests.md"]);
        for (const f of Object.keys(refs)) {
            assert.ok(skill.includes(`references/${f}`), f);
        }
    });
    test("is short and declarative", () => {
        assert.ok(skill.split("\n").length <= 100, "SKILL.md under 100 lines");
        for (const [f, text] of Object.entries(refs)) {
            assert.ok(text.split("\n").length <= 120, `${f} under 120 lines`);
        }
        assert.doesNotMatch(all, /alternative|we could have|instead of|decided/i);
        assert.doesNotMatch(all, /code-standard\.md/);
    });
});
```

- [ ] **Step 2: Run it to see it fail**

Run: `node --test test/standard/skill.test.js`
Expected: FAIL, `ENOENT` on the skill file.

- [ ] **Step 3: Write `SKILL.md` and the five reference files**

Frontmatter: `name: code-standard`; `description: The Sozi fork's code standard: how code in src/, test/ and packages/ is shaped, formatted, tested and reviewed. Use before writing, changing or reviewing any code in this repository.`

`SKILL.md` body, in this order: the commands (section 1 as one line per tool: `bin/check --fix FILE` for Prettier/ESLint/Stylelint; `npm run types`; `npm run check:deps`; `npm run check:pr`; `npm run check:coverage`; `npm test`; `npm run test:features`); the three boundaries (2.3, 2.5, 2.6) as one line each; the judgment rules in full words: 2.1 one concern per module, 2.2 classes for lifetimes and functions for computation, 2.8 the size guidelines (400 lines, 50 lines per function, 10 public methods) and the summary-comment rule, 6.2 the feature file changes first and the `# covers:` header, 6.5 held for a defect only; the scratch rule ("Temporary files go in `.agents/tmp/`, never committed"); then "Read when you touch it:" with the five reference files. The reference files: for each `### N.M` heading of their section, the same number and a shorter title, then one to four lines in present tense; a rule a tool enforces names the tool. No "why", no alternatives, no dates. `SKILL.md` ends with: "The reasoning behind each rule is in docs/software-factory/code-standard.md; it is history, not instructions."

- [ ] **Step 4: Run the test to see it pass**

Run: `node --test test/standard/skill.test.js`
Expected: PASS, 4 tests.

- [ ] **Step 5: Point the record's status line at the skill**

In `docs/software-factory/code-standard.md`, after the status paragraph, add one line: "Agents read the condensed version, `.claude/skills/code-standard/SKILL.md`; this file is the record of why."

- [ ] **Step 6: Add the test directory to the runner and commit**

In `test/cli/run.sh` add `"test/standard/*.test.js"` to both `node --test` lines.

```bash
gh-as builder --git add .claude/skills/code-standard test/standard/skill.test.js test/cli/run.sh docs/software-factory/code-standard.md
gh-as builder --git commit -m "Add the code standard skill, the version agents read"
```

### Task 2: Re-point every message at the skill

**Files:**
- Modify: `config/eslintrc.mjs` (every `message:`), `config/stylelintrc.json` (three `message` values), `.claude/hooks/check-file.py` (docstring and every note), `bin/check-pr.js:6,67`, `bin/check-deps.js:6,195,245`, `bin/check-coverage.js:6`, `.github/workflows/ci.yml:1,25,40,55`, `.github/PULL_REQUEST_TEMPLATE.md:14,23`, `test/features/presenter/previews.feature:11`, `test/features/support/world.js:7`, comments in `test/*/*.test.js`
- Test: `test/lint/eslint-config.test.js:30`, `test/standard/skill.test.js`

**Interfaces:**
- Produces: the citation form `(standard N.M)` in every user-visible message; the hook's notes read "... (standard 2.8)".

- [ ] **Step 1: Change the ESLint test's filter and watch it fail**

In `test/lint/eslint-config.test.js:30` replace `m.includes("code-standard.md")` with `m.includes("standard ")`.

Run: `node --test test/lint/eslint-config.test.js`
Expected: FAIL on every scope test (messages still say `code-standard.md`, so none pass the new filter).

- [ ] **Step 2: Add a test that no message cites the record**

Append to `test/standard/skill.test.js`:

```js
test("no hook, script or lint message cites the record", () => {
    const files = [
        "config/eslintrc.mjs", "config/stylelintrc.json", ".claude/hooks/check-file.py",
        "bin/check-pr.js", "bin/check-deps.js", "bin/check-coverage.js",
        ".github/workflows/ci.yml", ".github/PULL_REQUEST_TEMPLATE.md"
    ];
    for (const f of files) {
        assert.doesNotMatch(fs.readFileSync(f, "utf8"), /code-standard\.md/, f);
    }
});
```

Run: `node --test test/standard/skill.test.js`
Expected: FAIL on that test.

- [ ] **Step 3: Replace the citations**

In every file listed, replace `code-standard.md N.M` and `code-standard.md N` with `standard N.M` / `standard N`; the two script header comments that say "code-standard.md section 5" become "standard 5 (.claude/skills/code-standard/SKILL.md)". In `.claude/hooks/check-file.py` the docstring line "Some rules of code-standard.md are judgment calls" becomes "Some rules of the standard (the code-standard skill) are judgment calls". `ci.yml:1` becomes `# The gate. See .claude/skills/code-standard/SKILL.md, section 1.5.`

- [ ] **Step 4: Run the whole suite**

Run: `npm test`
Expected: PASS, 303 tests (298 plus Task 1's 4 plus this one), no `code-standard.md` in any message. Also run `python3 .claude/hooks/check-file.py --advise src/js/presenter.js` and confirm each note ends with `(standard 2.8)` or `(standard 6.2)`.

- [ ] **Step 5: Commit**

```bash
gh-as builder --git add -A config .claude bin .github test
gh-as builder --git commit -m "Cite the standard by section, not the record"
```

### Task 3: Reach the other harnesses, and the agent directories

**Files:**
- Create: `AGENTS.md` (symlink to `CLAUDE.md`), `.agents/skills` (symlink to `../.claude/skills`), `.agents/tmp/.gitkeep`, `.agents/README.md`
- Modify: `CLAUDE.md:20-24` (the Build section's pointer and a new "Agent files" paragraph), `.gitignore`

- [ ] **Step 1: Make the links, the scratch directory and the pointer**

```bash
ln -s CLAUDE.md AGENTS.md
ln -s ../.claude/skills .agents/skills
mkdir -p .agents/tmp && touch .agents/tmp/.gitkeep
printf '.agents/tmp/*\n!.agents/tmp/.gitkeep\n' >> .gitignore
```

`.agents/README.md`, four lines: what is here is for agents (`plans/` the implementation plans, `skills` the same skills Claude loads, `tmp/` scratch that is never committed); `docs/` is for people and agents both.

In `CLAUDE.md` replace "The standard is `docs/software-factory/code-standard.md`." with "The standard is the `code-standard` skill (`.claude/skills/code-standard/`); `docs/software-factory/code-standard.md` is the record of why each rule was chosen." Add a paragraph "Agent files": "`AGENTS.md` is a link to this file for Codex and OpenCode. Agent-only files live under `.agents/`: plans in `.agents/plans/` (superpowers writes them there, not `docs/superpowers/`), temporary work in `.agents/tmp/` (gitignored), skills through `.agents/skills`."

- [ ] **Step 2: Verify the links resolve for the other harnesses' layout**

Run: `ls .agents/skills/code-standard/SKILL.md && head -3 AGENTS.md`
Expected: the skill file is listed through the link; `AGENTS.md` shows the first lines of `CLAUDE.md`.

- [ ] **Step 3: Verify the plugin still resolves personas**

Run: `gh-personas mode`
Expected: the same six `bot` lines as before (the plugin reads `CLAUDE.md` first; the link changes nothing for it).

- [ ] **Step 4: Commit**

```bash
gh-as builder --git add AGENTS.md CLAUDE.md .agents .gitignore
gh-as builder --git commit -m "Point CLAUDE.md and AGENTS.md at the skill; .agents for agent-only files"
```
