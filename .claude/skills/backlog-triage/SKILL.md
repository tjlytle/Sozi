---
name: backlog-triage
description: Triage the Sozi fork's backlog epic (PIPELINE_BACKLOG, the findings and ideas the factory agents file while they work) with Tim, interactively in a session. Use when Tim asks to triage, review or clean up the backlog, the findings, or the ideas.
---

# Backlog triage

The factory files every finding and idea under the backlog epic (`PIPELINE_BACKLOG` in
`pipeline/config`), not under the epic being worked on. Nothing there starts during an
`--epic` run. Triage is Tim's call: you read, sort and recommend; he decides; you apply
what he decided with `bin/backlog.js`, which acts as him (`gh-as -`).

## Steps

1. **Read the backlog.** `node bin/backlog.js list` prints the open issues grouped by kind:
   `triage` (a finding that needs him), the stage labels (findings that would start on
   their own outside an epic run), then `idea`. Each line has the number, the persona
   that filed it, the issue it came from, and the title. Read an issue itself
   (`gh issue view <n> -R tjlytle/Sozi`) only when the title does not tell you what it is.
2. **Sort it before asking.** Give every issue one recommendation, with one line of why:
   - **Do**: it fixes a defect someone has hit, or it unblocks an epic that is open now.
     Name the epic it belongs to (the factory epic for loop and pipeline issues, the
     product epic for product issues).
   - **Keep**: worth doing, not now. It stays in the backlog as it is.
   - **Close**: a tidy-up nobody needs, an alternative the work already settled, or
     anything an open or merged issue covers. Name the covering issue for a duplicate.
   An idea is Close unless it is worth doing on its own. A refactor of a test file is
   Keep unless that file is being changed anyway.
3. **Ask in batches.** Show each kind as a short table first (number, title, your
   recommendation, the why). Then ask about the issues where your recommendation is not
   obvious, up to four questions at a time, each with your recommendation as the first
   option. Ask once for the rest of a group ("close these six ideas as settled?") rather
   than issue by issue.
4. **Apply what he decided.**
   - Do: `node bin/backlog.js move <n>... --epic <#> --stage todo`
   - Close: `node bin/backlog.js close <n>... --reason "<why, in his words or yours>"`
   - Keep: nothing.
   Never move an issue into an epic he did not name or agree to, and never close one he
   did not agree to close.
5. **Report.** One line per decision kind (moved, closed, kept) with the issue numbers,
   and what is left in the backlog.
