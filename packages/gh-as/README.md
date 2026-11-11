# gh-as

`gh-as <persona> <gh args>` runs `gh` or `git` as one of the factory's persona Apps. The stage
containers are its only user for now: the image copies this directory to `/opt/gh-as` and puts
`/opt/gh-as/bin` on `PATH`, whatever the harness. On the host, the loop and the sessions keep
using the gh-personas plugin.

## Where it came from

`bin/gh-as`, `bin/bot-token` and `lib/config.sh` are copied unchanged from `plugins/gh-personas`
of [tjlytle/dev-flow](https://github.com/tjlytle/dev-flow), plugin version 0.1.0. The commit
could not be read from the stage that vendored it, so the copy is pinned by the git blob ids of
the three files; `git log --find-object=<id>` in dev-flow names the commit that holds each:

| File            | Blob id                                    |
| --------------- | ------------------------------------------ |
| `bin/gh-as`     | `32419bef12201cb10de699518f8bc317d1c8d8f1` |
| `bin/bot-token` | `fccd36f7d057c974e52d16718af7584cca089e08` |
| `lib/config.sh` | `0caaf9354a3dc23da59c5b0d2e4326eca95dff7a` |

The plugin's skill, hooks and `gh-personas` command stay in the plugin. Changes made here are
their own commits on top of the copy, so `git log packages/gh-as` reads as the diff to upstream.

## Signature

Set by `pipeline/stage.sh` in a stage; outside a stage, with `GH_AS_SIGNATURE` unset, `gh-as`
posts and commits exactly what it is given.

- `GH_AS_SIGNATURE`: one line, such as `architect · codex · gpt-5.5`, appended after a blank line
  to every body of `gh issue|pr create|comment|edit` and `gh pr review` (`--body`, `-b`,
  `--body-file`, `-F`, stdin with `-`), unless the body's last non-blank line already is it.
- `GH_AS_HARNESS` and `GH_AS_MODEL`: `git commit` through `gh-as <who> --git` gets a
  `Harness:` and a `Model:` trailer, each only when its variable is set and only while
  `GH_AS_SIGNATURE` is.
