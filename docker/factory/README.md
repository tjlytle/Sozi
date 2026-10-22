# Factory image

The image every factory stage runs in (`sozi-factory`, from `node:24-bookworm`). The loop
starts one container per stage and runs `/pipeline/stage.sh <issue> <stage>` in it.

## Build

    node bin/pipeline.js --build-image

This runs `docker build -t sozi-factory -f docker/factory/Dockerfile --build-context
ghp=<gh-personas plugin dir> .` from the repo root, so the Dockerfile can `COPY pipeline`
and the lockfile. `.dockerignore` keeps `node_modules`, `build`, `dist`, `var`, `.git`,
`.agents/tmp` and `.superpowers` out of the context.

Measured on the dev machine (cold cache): about 6 minutes, image size 6.48 GB (Chromium,
Electron's libraries, the three harness CLIs and `node_modules`). `/cache` is created
and filled as `factory`, so no layer re-owns it.

## What is in it

- Debian packages: git, gh (GitHub's apt repo), jq, python3, curl, xvfb, and the libraries
  Electron needs; Playwright adds Chromium's own.
- Global npm: `@anthropic-ai/claude-code`, `@openai/codex`, `opencode-ai`. These are
  **not pinned**: a rebuild picks up the newest release of each.
- `/opt/gh-personas`: the gh-personas plugin (hooks, skill, `bin/` on `PATH`).
- `/cache`: `node_modules` from `npm ci` for the lockfile, `lock-sha` (its hash, which
  `stage.sh` compares with the checkout's lockfile), and Playwright's Chromium in
  `/cache/ms-playwright`.
- `/pipeline`: a copy of the repo's `pipeline/` directory (the runner and the adapters).
- User `factory` (build arg `FACTORY_UID`, default 1000; `buildImage()` passes the host
  user's uid). The host user must have that uid, or the bind-mounted outbox is not writable;
  override by hand with `docker build --build-arg FACTORY_UID=$(id -u) ...`. The base image's `node` user is removed to free uid 1000.
  Mount points: `/mirror`, `/outbox`, `/work`.

`/profile` is the mount point of a persona's profile volume (`sozi-factory-profile-<persona>`,
one per persona, created by `--login` or `--copy-profile`). The image creates it owned by
`factory`, so an image built before profiles existed lacks a writable `/profile`; rebuild it.
`/pipeline/profile-inspect.sh` and `/pipeline/login.sh` live in the image.

Electron and Playwright Chromium cannot start their own sandboxes under Docker's default
seccomp profile (verified 2026-10-22: Electron aborts with "Failed to move to new namespace"
even with the setuid helper in place; `--no-sandbox` works). The choice between
`--security-opt seccomp=unconfined` on the container, a custom seccomp profile that allows
user namespaces (Playwright publishes one), or `--no-sandbox` in the stage runner is open.
Until it is made, stages that run `npm test` or the scenarios inside a container will fail
at the Electron launch.

## When to rebuild

- `package-lock.json` changed: the cached `node_modules` and Chromium are stale (a stage
  still works, it just installs on the fly).
- Anything under `pipeline/` changed: the runner is baked into the image.
- The gh-personas plugin was updated.
- You want newer harness CLIs.
- The sandbox helper's setuid bit (`chrome-sandbox`, root 4755) is set in the image. An
  in-checkout `npm ci` (lockfile mismatch) produces an Electron without it, so stage runs
  on a branch whose lockfile differs from the image's cannot run Electron until the image
  is rebuilt.

## Adding a harness

Add an executable `pipeline/harness/<name>` (see `pipeline/harness/README.md` for the
contract), install its CLI with the global `npm install -g` line in the Dockerfile, and
rebuild.
