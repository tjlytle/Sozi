# Sozi fork (tjlytle/Sozi)

Fork of sozi-projects/Sozi. Goal: an agent-friendly CLI (and later MCP server) for
inspecting, editing, building and rendering Sozi presentations. Plan: issue #1.
Upstream (`upstream` remote) is maintenance-only; we do not open PRs there.

## Build

- `npm install` then `npx gulp` (default task = Electron build into `build/electron`), ~7 s.
  Node 24 works despite the README's Node 14 note.
- Run the editor: `node_modules/.bin/electron build/electron <file.svg>`.
  `ELECTRON_ENABLE_LOGGING=1` shows renderer console output in the terminal.
- `gulp` rewrites `locales/messages.pot` (timestamp) and `yarn.lock`; revert both
  before committing (`git checkout -- locales/messages.pot yarn.lock`).
- `npm run check` runs every CI check (Prettier, ESLint, Stylelint, tsc); `bin/check --fix
  <file>` applies the mechanical fixes to one file; `python3 .claude/hooks/check-file.py --advise
  <file>` prints the size and stale-comment notes the edit hook gives a model;
  `npm run check:deps` checks any dependency added since master the way CI does;
  `npm run check:pr` checks the branch name, the Closes line and build noise;
  `npm run check:coverage` lists which test covers each changed source file;
  `npm run test:features` runs the browser scenarios (needs a build and a display). The standard is
  the `code-standard` skill (`.claude/skills/code-standard/`); `docs/software-factory/code-standard.md`
  is the record of why each rule was chosen. Existing code is red by design until the
  cleanup issues land.
- Agent files: `AGENTS.md` is a link to this file for Codex and OpenCode. Agent-only files
  live under `.agents/`: plans in `.agents/plans/` (superpowers writes them there, not
  `docs/superpowers/`), temporary work in `.agents/tmp/` (gitignored), skills through
  `.agents/skills`.
- Test decks: copy an `.svg` + `.sozi.json` pair into a scratch dir first. Opening a
  deck writes `*.sozi.html` and `*-presenter.sozi.html` next to it.

## GitHub Workflow

Bots: advocate=advocate, architect=architect, builder=builder, qa=qa, reviewer=reviewer, ops=ops

- `gh` in this clone must target the fork: `gh repo set-default tjlytle/Sozi` is set; always pass `-R tjlytle/Sozi` anyway. Never write to sozi-projects/Sozi.
