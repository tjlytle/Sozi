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
- Test decks: copy an `.svg` + `.sozi.json` pair into a scratch dir first. Opening a
  deck writes `*.sozi.html` and `*-presenter.sozi.html` next to it.

## GitHub Workflow

Bots: advocate=advocate, architect=architect, builder=builder, qa=qa, reviewer=reviewer, ops=ops

- `gh` in this clone must target the fork: `gh repo set-default tjlytle/Sozi` is set; always pass `-R tjlytle/Sozi` anyway. Never write to sozi-projects/Sozi.
