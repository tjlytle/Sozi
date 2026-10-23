# Persona Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Each persona's stage containers run from a Docker volume that Tim authorised once by logging in inside a container, instead of tokens passed through the environment.

**Architecture:** A named volume per persona (`sozi-factory-profile-<persona>`) is mounted at `/profile` in every container of that persona; the harness CLIs find their configuration there through `CLAUDE_CONFIG_DIR`, `CODEX_HOME` and `XDG_CONFIG_HOME`. `npm run pipeline -- --login <persona>` opens an interactive shell in the stage image with that volume so Tim logs the CLI in and authorises MCP servers; the loop inspects the volume before a start, enforces the persona's MCP allowlist against it, limits one session per persona at a time, and falls back to `CLAUDE_CODE_OAUTH_TOKEN` only when no profile exists. All of it is a new module `pipeline/lib/profile.js` plus small changes to the settings, the sandbox, the starter and the CLI.

**Tech Stack:** Node 24 ES modules, `node:test`, Docker named volumes, bash in the stage image (`docker/factory/Dockerfile`).

**Spec:** issue #68, the architect's comment "Persona profiles" (2026-10-22), plus Tim's answers of 2026-10-22: six profiles (one per persona), a profile holds every harness's configuration, "cloud" means hosted sessions (Claude Code cloud, Codex cloud) and is a follow-on, not this plan.

## Global Constraints

- Nothing from the host's home directory is ever mounted; the only mount besides the mirror and the outbox is the persona's own volume at `/profile`.
- No value from a profile is ever printed or logged: inspection reports names (server names, "logged in" booleans) only.
- `CLAUDE_CODE_OAUTH_TOKEN` and `ANTHROPIC_API_KEY` stay passed by name as today; they are the fallback when `PIPELINE_PROFILES=auto` finds no volume.
- Personas are exactly `advocate`, `architect`, `builder`, `qa`, `reviewer`, `ops`; stages map to personas as `plan→architect`, `tests→qa`, `build→builder`, `review→reviewer`, `qa→qa`; a spawn uses its request's persona.
- Every docker command goes through the sandbox's injectable runner (`run`) as today; the one interactive command (`--login`) goes through a new injectable `runInteractive` dep so tests never touch Docker.
- The code standard applies (`.claude/skills/code-standard/SKILL.md`): JSDoc types, `bin/check` clean on every changed file, tests under `test/pipeline/` with `node:test`, commits through `gh-as builder --git commit -F <file>`.
- The branch is `68-persona-profiles`; the PR closes #68.

## Review Focus

1. A persona with no volume and no token: the start is refused with a log line naming the persona and the login command, no container starts, and the issue is not marked `working`. Pinned by Task 5's "refused start" test.
2. A profile holding an MCP server not in that persona's allowlist: refused with the server's name in the log and nothing else from the profile. Pinned by Task 3's `checkAllowlist` test and Task 5's start test.
3. Two due issues for the same persona with `PIPELINE_PER_PERSONA=1`: the second is skipped this pass (not dropped, not tried) and another persona's issue can still start. Pinned by Task 5's "skips to another persona" test.
4. `--login` with an unknown persona or harness: exit 2 with the usage, no docker command. Pinned by Task 6's test.
5. A volume created by an older image with root-owned files: the login shell cannot write. Task 4 makes the image create `/profile` as `factory` so a fresh volume inherits it, and the login banner runs `test -w /profile` first. Pinned by Task 4's Dockerfile grep test and Task 6's banner test.

---

### Task 1: Settings for profiles, allowlists and the per-persona limit

**Files:**
- Modify: `pipeline/lib/config.js` (DEFAULTS, CHOICES, NUMBERS, the returned object)
- Modify: `pipeline/config` (two commented lines documenting the new keys)
- Test: `test/pipeline/config.test.js`

**Interfaces:**
- Produces: `settings.profiles: "auto" | "off"` (`PIPELINE_PROFILES`, default `auto`); `settings.perPersona: number` (`PIPELINE_PER_PERSONA`, default `1`, `0` = no limit); `settings.mcpFor(persona: string): string[]` (`PIPELINE_MCP_<PERSONA>` as a comma list, trimmed, empty by default, `PIPELINE_MCP_ARCHITECT=mobbin` style keys read through the same `perStage` helper, uppercase persona).

- [ ] **Step 1: Write the failing tests**

```js
test("profiles, per-persona limit and MCP allowlists", () => {
    const s = loadConfig({root: "/nonexistent", env: {PIPELINE_MCP_ARCHITECT: "mobbin, context7"}});
    assert.equal(s.profiles, "auto");
    assert.equal(s.perPersona, 1);
    assert.deepEqual(s.mcpFor("architect"), ["mobbin", "context7"]);
    assert.deepEqual(s.mcpFor("builder"), []);
});
test("PIPELINE_PROFILES takes auto or off", () => {
    assert.throws(() => loadConfig({root: "/nonexistent", env: {PIPELINE_PROFILES: "yes"}}), /PIPELINE_PROFILES must be one of auto\|off/);
    assert.equal(loadConfig({root: "/nonexistent", env: {PIPELINE_PROFILES: "off"}}).profiles, "off");
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `node --test test/pipeline/config.test.js`
Expected: FAIL (`s.profiles` is undefined; no throw on `yes`).

- [ ] **Step 3: Implement**

Add `PIPELINE_PROFILES: "auto"` and `PIPELINE_PER_PERSONA: "1"` to `DEFAULTS`, `PIPELINE_PROFILES: ["auto", "off"]` to `CHOICES`, `PIPELINE_PER_PERSONA` to `NUMBERS`; return `profiles`, `perPersona` and `mcpFor` (split on commas, trim, drop empties). In `pipeline/config` add two comment lines: `# PIPELINE_PROFILES=auto|off  (auto: a persona's volume when it exists, else the token)` and `# PIPELINE_MCP_<PERSONA>=name,name  (MCP servers the persona's profile may hold; empty = none)`, then Tim's allowlists of 2026-10-22 as real lines: `PIPELINE_MCP_ARCHITECT=mobbin,context7`, `PIPELINE_MCP_ADVOCATE=mobbin`, `PIPELINE_MCP_BUILDER=context7` (qa, reviewer and ops: none). The names are the keys the CLI stores for those servers; Task 3's inspection reports the stored keys, so the first `--status` after a login shows the exact spelling to use if it differs.

- [ ] **Step 4: Run the tests**

Run: `node --test test/pipeline/config.test.js`
Expected: PASS, all tests.

- [ ] **Step 5: Commit**

`gh-as builder --git add pipeline/lib/config.js pipeline/config test/pipeline/config.test.js` and commit with subject `Settings for persona profiles (#68)`.

### Task 2: The profile module: names, mounts, personas

**Files:**
- Create: `pipeline/lib/profile.js`
- Test: `test/pipeline/profile.test.js`

**Interfaces:**
- Produces:
  - `PERSONAS: readonly string[]` = `["advocate", "architect", "builder", "qa", "reviewer", "ops"]`.
  - `personaFor(stage: string, spawnPersona?: string): string` — the mapping in Global Constraints; `"spawn"` returns `spawnPersona`; an unknown stage throws `Error("no persona for stage <stage>")`.
  - `volumeName(persona: string): string` = `sozi-factory-profile-<persona>`; throws on a persona not in `PERSONAS`.
  - `profileArgs(persona: string): string[]` = `["-v", "<volume>:/profile", "-e", "CLAUDE_CONFIG_DIR=/profile/claude", "-e", "CODEX_HOME=/profile/codex", "-e", "XDG_CONFIG_HOME=/profile/xdg"]`.

- [ ] **Step 1: Write the failing tests**

```js
test("stages map to personas; spawn takes its own", () => {
    assert.equal(personaFor("plan"), "architect");
    assert.equal(personaFor("tests"), "qa");
    assert.equal(personaFor("build"), "builder");
    assert.equal(personaFor("review"), "reviewer");
    assert.equal(personaFor("qa"), "qa");
    assert.equal(personaFor("spawn", "advocate"), "advocate");
    assert.throws(() => personaFor("deploy"), /no persona for stage deploy/);
});
test("volume name and mount arguments", () => {
    assert.equal(volumeName("builder"), "sozi-factory-profile-builder");
    assert.throws(() => volumeName("root"), /persona/);
    assert.deepEqual(profileArgs("qa"), ["-v", "sozi-factory-profile-qa:/profile",
        "-e", "CLAUDE_CONFIG_DIR=/profile/claude", "-e", "CODEX_HOME=/profile/codex",
        "-e", "XDG_CONFIG_HOME=/profile/xdg"]);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/pipeline/profile.test.js`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `pipeline/lib/profile.js`** with the three functions and the constant, a file header comment in the style of `sandbox.js`.

- [ ] **Step 4: Run the tests**

Expected: PASS.

- [ ] **Step 5: Commit** — subject `Profile names, mounts and the stage-to-persona map (#68)`.

### Task 3: Inspecting a profile and checking the allowlist

**Files:**
- Create: `pipeline/profile-inspect.sh` (runs inside the image)
- Modify: `pipeline/lib/profile.js`
- Test: `test/pipeline/profile.test.js`, `test/pipeline/profile-inspect.test.js`

**Interfaces:**
- Consumes: `volumeName` (Task 2); the sandbox's `run` runner type (`import("./github.js").Runner`).
- Produces:
  - `pipeline/profile-inspect.sh`: reads `/profile` and prints one JSON line `{"claude": {"present": bool, "loggedIn": bool, "servers": [names]}, "codex": {"present": bool, "loggedIn": bool}, "writable": bool}`. `claude.present` = `/profile/claude` exists; `claude.loggedIn` = `/profile/claude/.credentials.json` exists and contains the key `claudeAiOauth`; `claude.servers` = the keys of `mcpServers` in `/profile/claude/.claude.json` (empty when absent); `codex.present` = `/profile/codex` exists; `codex.loggedIn` = `/profile/codex/auth.json` exists; `writable` = `test -w /profile`. Uses `node -e` for the JSON reads (the image has node); never prints a value from either file.
  - `inspectProfile(run: Runner, {image, persona}): Promise<ProfileInfo | null>` — runs `docker volume inspect <volume>`; returns `null` when it fails (no volume); else runs `docker run --rm -v <volume>:/profile:ro <image> bash /pipeline/profile-inspect.sh` and parses the line. A parse failure throws `Error("profile inspect failed for <persona>")`.
  - `checkAllowlist(info: ProfileInfo, allowed: string[]): string[]` — the servers in `info.claude.servers` not in `allowed`, sorted.

- [ ] **Step 1: Write the failing tests**

In `test/pipeline/profile.test.js`:
```js
test("inspectProfile: no volume is null; a volume is inspected read-only", async () => {
    const calls = [];
    const run = async cmd => { calls.push(cmd); return cmd[1] === "volume"
        ? {code: 1, stdout: "", stderr: "no such volume"}
        : {code: 0, stdout: "", stderr: ""}; };
    assert.equal(await inspectProfile(run, {image: "img", persona: "qa"}), null);
    assert.equal(calls.length, 1);
    const run2 = async cmd => ({code: 0, stdout: cmd[1] === "volume" ? "[]" :
        '{"claude":{"present":true,"loggedIn":true,"servers":["context7"]},"codex":{"present":false,"loggedIn":false},"writable":true}\n', stderr: ""});
    const info = await inspectProfile(run2, {image: "img", persona: "qa"});
    assert.deepEqual(info.claude.servers, ["context7"]);
});
test("inspect uses a read-only mount and the image", async () => {
    let args;
    const run = async cmd => { if (cmd[1] === "run") args = cmd; return {code: 0, stdout: cmd[1] === "run" ? '{"claude":{"present":false,"loggedIn":false,"servers":[]},"codex":{"present":false,"loggedIn":false},"writable":true}' : "[]", stderr: ""}; };
    await inspectProfile(run, {image: "sozi-factory", persona: "builder"});
    assert.ok(args.includes("sozi-factory-profile-builder:/profile:ro"));
    assert.ok(args.includes("--rm") && args.includes("sozi-factory"));
});
test("checkAllowlist names the servers the persona may not hold", () => {
    const info = {claude: {present: true, loggedIn: true, servers: ["mobbin", "context7"]}, codex: {present: false, loggedIn: false}, writable: true};
    assert.deepEqual(checkAllowlist(info, ["context7"]), ["mobbin"]);
    assert.deepEqual(checkAllowlist(info, ["context7", "mobbin"]), []);
});
```

In `test/pipeline/profile-inspect.test.js` (runs the script with bash on a temp directory, `PROFILE=<dir>` overriding `/profile`, like `test/pipeline/stage.test.js` does for its paths):
```js
test("an empty profile", () => { /* mkdtemp; run `bash pipeline/profile-inspect.sh` with env PROFILE=dir; parse; assert claude.present false, writable true */ });
test("a logged-in claude profile with two servers", () => { /* write claude/.credentials.json {"claudeAiOauth":{"accessToken":"SECRET"}} and claude/.claude.json {"mcpServers":{"mobbin":{},"context7":{}}}; assert loggedIn true, servers ["context7","mobbin"] sorted; assert the output does not contain "SECRET" */ });
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/pipeline/profile.test.js test/pipeline/profile-inspect.test.js`
Expected: FAIL (functions and script missing).

- [ ] **Step 3: Implement** the script (`PROFILE="${PROFILE:-/profile}"`, `set -u`, one `node -e` per JSON read that prints only booleans and key names) and the two functions.

- [ ] **Step 4: Run the tests**

Expected: PASS.

- [ ] **Step 5: Commit** — subject `Inspect a profile without reading its secrets (#68)`.

### Task 4: The sandbox mounts the profile; the image owns `/profile`

**Files:**
- Modify: `pipeline/lib/sandbox.js` (`StartOptions`, `startArgs`, new `profileExists`, new `login`)
- Modify: `docker/factory/Dockerfile:30-31` (`/profile` in the mkdir and chown)
- Modify: `bin/pipeline.js` DEFAULT_DEPS (new `runInteractive`)
- Test: `test/pipeline/sandbox.test.js`

**Interfaces:**
- Consumes: `profileArgs`, `volumeName`, `inspectProfile` (Tasks 2 and 3).
- Produces:
  - `StartOptions.persona?: string` and `StartOptions.profile?: boolean`: when `profile` is true, `startArgs` appends `profileArgs(persona)` before the image name; when false or absent, nothing changes (today's arguments byte for byte).
  - `sandbox.inspectProfile(persona: string): Promise<ProfileInfo | null>` — `inspectProfile(run, {image: settings.image, persona})`.
  - `sandbox.loginArgs({persona, harness}): string[]` = `["run", "-it", "--rm", "--network", "host", "--name", "factory-login-<persona>", ...profileArgs(persona), "-e", "PIPELINE_LOGIN_PERSONA=<persona>", "-e", "PIPELINE_LOGIN_HARNESS=<harness>", settings.image, "bash", "/pipeline/login.sh"]` (`login.sh` is Task 6; `--network host` so an MCP OAuth callback to a localhost port reaches the container during the login only).
  - `sandbox.login({persona, harness}): Promise<number>` — `runInteractive(["docker", ...loginArgs(...)])`, which inherits stdio; returns the exit status. `createSandbox` takes `runInteractive` as an option with a default that uses `child_process.spawnSync(cmd[0], cmd.slice(1), {stdio: "inherit"}).status ?? 1`.

- [ ] **Step 1: Write the failing tests**

```js
test("the profile volume and the harness config dirs when profile is set", () => {
    const args = sb.startArgs({issue: 25, stage: "build", persona: "builder", profile: true, outbox: "/o", mintUrl: "u", mintKey: "k"});
    assert.ok(args.includes("sozi-factory-profile-builder:/profile"));
    assert.ok(args.includes("CLAUDE_CONFIG_DIR=/profile/claude"));
    assert.ok(args.indexOf("sozi-factory") > args.indexOf("CLAUDE_CONFIG_DIR=/profile/claude"));
});
test("no profile arguments when profile is not set", () => {
    const args = sb.startArgs({issue: 25, stage: "build", persona: "builder", outbox: "/o", mintUrl: "u", mintKey: "k"});
    assert.ok(!args.some(a => a.includes("/profile")));
});
test("login runs an interactive container on the host network with the volume", async () => {
    let cmd;
    const sb2 = createSandbox({settings, root: "/repo", run: async () => ({code: 0, stdout: "", stderr: ""}), runInteractive: c => { cmd = c; return 0; }});
    assert.equal(await sb2.login({persona: "architect", harness: "claude"}), 0);
    assert.deepEqual(cmd.slice(0, 4), ["docker", "run", "-it", "--rm"]);
    assert.ok(cmd.includes("--network") && cmd.includes("host"));
    assert.ok(cmd.includes("sozi-factory-profile-architect:/profile"));
    assert.ok(cmd.includes("PIPELINE_LOGIN_HARNESS=claude"));
    assert.ok(cmd.includes("PIPELINE_LOGIN_PERSONA=architect"));
    assert.deepEqual(cmd.slice(-2), ["bash", "/pipeline/login.sh"]);
});
test("the image creates /profile for the factory user", () => {
    const text = fs.readFileSync(path.join(REPO, "docker", "factory", "Dockerfile"), "utf8");
    assert.match(text, /mkdir -p [^\n]*\/profile/);
    assert.match(text, /chown factory:factory [^\n]*\/profile/);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/pipeline/sandbox.test.js`
Expected: FAIL on the four new tests.

- [ ] **Step 3: Implement** the sandbox changes and the Dockerfile line (`mkdir -p /work /outbox /mirror /cache /profile` and the matching chown). Add `runInteractive` to `DEFAULT_DEPS` in `bin/pipeline.js` and pass it into `createSandbox` there.

- [ ] **Step 4: Run the tests**

Expected: PASS, whole file.

- [ ] **Step 5: Commit** — subject `Mount the persona profile in stage containers (#68)`.

### Task 5: The starter uses profiles, enforces the allowlist and the per-persona limit

**Files:**
- Modify: `pipeline/lib/start.js` (`running`, `startIssue`, `startSpawn`, `start`, new `profileFor`)
- Modify: `pipeline/lib/state.js` only if the session record needs `persona` (it does: add `persona` to the issue session record written in `startIssue`; spawned sessions already carry it)
- Test: `test/pipeline/pass.test.js` (through `pass-world.js`, whose fake sandbox gains `inspectProfile`)

**Interfaces:**
- Consumes: `personaFor`, `checkAllowlist` (Tasks 2, 3); `settings.profiles`, `settings.perPersona`, `settings.mcpFor` (Task 1); `sandbox.inspectProfile`, `StartOptions.persona/profile` (Task 4).
- Produces:
  - `runningFor(ctx, persona): number` — sessions of that persona (issue sessions by their record's `persona`, spawns by theirs).
  - `profileFor(ctx, persona): Promise<{profile: boolean} | {refused: string}>`, cached per pass in `ctx.profiles` (a `Map`): with `settings.profiles === "off"` → `{profile: false}`; else inspect; `null` and a token in `ctx.env` (`CLAUDE_CODE_OAUTH_TOKEN` or `ANTHROPIC_API_KEY`) → `{profile: false}`; `null` and no token → `{refused: "no profile for <persona>: run npm run pipeline -- --login <persona>"}`; a profile whose `claude.loggedIn` is false → `{refused: "profile of <persona> is not logged in"}`; `checkAllowlist(info, settings.mcpFor(persona))` non-empty → `{refused: "profile of <persona> holds MCP servers not allowed: a, b"}`; else `{profile: true}`.
  - In `start`: for each candidate (spawn or issue) compute the persona; if `settings.perPersona > 0 && runningFor(ctx, persona) >= settings.perPersona`, skip it this pass (issues: add to `ctx.tried` so `nextIssue` moves on; spawns: leave it queued and move to issues); if `profileFor` refuses, log the reason, add the issue to `ctx.tried` (or drop the spawn), and continue with the next candidate; otherwise start with `persona` and `profile` set.
  - `ctx.env` must be available on the pass context: check `pass.js`/`sync.js` `PassContext`; if the loop env is not on it, add `env` to the context built in `pass.js` from the `env` `bin/pipeline.js` already passes to `createSandbox` (`runEnv`).

- [ ] **Step 1: Write the failing tests** (in `pass.test.js`, with `pass-world.js` extended: the fake sandbox records `start` options and exposes `world.profiles = {builder: info | null, ...}` that `inspectProfile` answers from; default: every persona has a logged-in profile with no servers)

```js
test("a stage starts with its persona's profile", async () => { /* issue 25 stage:in-progress due → start called with persona "builder", profile true; the mount arguments are the sandbox's concern, assert only options */ });
test("no profile and no token: the start is refused and logged, no working label", async () => { /* world.profiles.builder = null; env without tokens; after pass: no session, log line matches /no profile for builder: run npm run pipeline -- --login builder/, record.labels has no "working" */ });
test("no profile but a token: starts without a profile", async () => { /* world.profiles.builder = null; env CLAUDE_CODE_OAUTH_TOKEN=t; start called with profile false */ });
test("a server outside the allowlist refuses the start by name", async () => { /* profile servers ["mobbin"], PIPELINE_MCP_BUILDER unset → log matches /not allowed: mobbin/; nothing from the profile besides the name */ });
test("one session per persona: the second builder issue waits, a qa issue starts", async () => { /* issues 25 and 26 both stage:in-progress, 27 stage:tests; PIPELINE_PARALLEL=3; after pass: 25 and 27 have sessions, 26 none and not in deadLetters; tried does not persist across passes */ });
test("PIPELINE_PER_PERSONA=0 lifts the limit", async () => { /* same as above with 0 → 25 and 26 both start */ });
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/pipeline/pass.test.js`
Expected: FAIL on the six new tests (start options lack `persona`; no refusal; both builders start).

- [ ] **Step 3: Implement** in `start.js`; keep `running` (total) for the global limit and add `runningFor`.

- [ ] **Step 4: Run the pipeline tests**

Run: `node --test test/pipeline/`
Expected: PASS, all files (`pass-queue`, `pass-recovery` and `pipeline` tests still pass with the extended fake: the `host()` fake in `pipeline.test.js` needs `inspectProfile: async () => ({claude: {present: true, loggedIn: true, servers: []}, codex: {present: false, loggedIn: false}, writable: true})`).

- [ ] **Step 5: Commit** — subject `Start stages from persona profiles, one per persona at a time (#68)`.

### Task 6: `--login <persona>` and the in-container login shell

**Files:**
- Create: `pipeline/login.sh`
- Modify: `bin/pipeline.js` (usage, `parseCommand`, `main`)
- Modify: `package.json` scripts if `npm run pipeline` does not already forward arguments (check; it does today through `--`)
- Test: `test/pipeline/pipeline.test.js`, `test/pipeline/login.test.js`

**Interfaces:**
- Consumes: `sandbox.login` (Task 4), `PERSONAS` (Task 2).
- Produces:
  - `--login <persona>` with optional `--harness claude|codex|opencode` (default `claude`): validates the persona against `PERSONAS` and the harness against the three names (else exit 2 with the usage); calls `sandbox.login({persona, harness})` and returns its status. No state file, no mint, no mirror.
  - `pipeline/login.sh`: `set -u`; `test -w /profile || { echo "profile is not writable; rebuild the image (docker/factory/README.md)"; exit 1; }`; `mkdir -p /profile/claude /profile/codex /profile/xdg`; prints a banner for `PIPELINE_LOGIN_HARNESS`: for `claude` — "run `claude`, then `/login` (open the URL on the host, paste the code), then `/mcp` for each server, then exit"; for `codex` — "run `codex login`" ; for `opencode` — "run `opencode auth login`"; then `exec ${SHELL_CMD:-bash -l}` (`SHELL_CMD` exists for the tests only). The banner names the volume (`sozi-factory-profile-<persona>`, from `PIPELINE_LOGIN_PERSONA`, which Task 4's `loginArgs` passes). `PROFILE="${PROFILE:-/profile}"` as in Task 3's script.
  - `--copy-profile <from> <to>`: copies one persona's volume into another's (Tim, 2026-10-22: log in once, copy to the other five, fix later if a token refresh ever invalidates the copies). `sandbox.copyProfile({from, to}): Promise<void>` runs, through `run`: `docker volume create <volume(to)>` then `docker run --rm -v <volume(from)>:/from:ro -v <volume(to)>:/to <image> cp -a /from/. /to/`; it refuses when `to` already has a volume (`docker volume inspect` succeeds) with `Error("profile of <to> exists; remove the volume first")`, so a copy never overwrites an authorised profile. Both personas validated against `PERSONAS`. Test in `sandbox.test.js`: the two commands in order with the right volume names and the read-only source mount; the refusal when the target exists. Test in `pipeline.test.js`: `--copy-profile builder qa` calls `sandbox.copyProfile({from: "builder", to: "qa"})` and returns 0; an unknown persona exits 2.
  - Usage lines in `bin/pipeline.js`: `node bin/pipeline.js --login <persona> [--harness claude|codex|opencode]   log a persona in inside a container` and `node bin/pipeline.js --copy-profile <from> <to>   copy one persona's profile to another`.

- [ ] **Step 1: Write the failing tests**

In `pipeline.test.js`:
```js
test("--login runs the interactive login for a persona and returns its status", async () => {
    const h = host({statuses: []});
    let got;
    h.deps.sandbox.login = async opts => { got = opts; return 0; };
    assert.equal(await main(["--login", "architect"], {root: h.root, env: {}, out: () => {}, deps: h.deps}), 0);
    assert.deepEqual(got, {persona: "architect", harness: "claude"});
    assert.ok(!h.events.includes("close"), "no mint was opened");
});
test("--login rejects an unknown persona or harness with the usage", async () => {
    let text = "";
    assert.equal(await main(["--login", "root"], {env: {}, err: t => (text += t)}), 2);
    assert.match(text, /persona must be one of advocate\|architect\|builder\|qa\|reviewer\|ops/);
    assert.equal(await main(["--login", "qa", "--harness", "cursor"], {env: {}, err: () => {}}), 2);
});
```

In `login.test.js` (runs `bash pipeline/login.sh` with `PROFILE` overridden like Task 3's script, and `SHELL_CMD=true` so the script execs `true` instead of a shell when set):
```js
test("the login shell refuses an unwritable profile", () => { /* chmod 500 the dir; status 1; stdout matches /not writable/ */ });
test("the banner names the persona, the volume and the claude steps", () => { /* PIPELINE_LOGIN_PERSONA=qa, PIPELINE_LOGIN_HARNESS=claude; stdout matches /sozi-factory-profile-qa/ and /\/login/ and /\/mcp/; the three dirs exist afterwards */ });
```

- [ ] **Step 2: Run to verify they fail**

Run: `node --test test/pipeline/pipeline.test.js test/pipeline/login.test.js`
Expected: FAIL (`--login` is an unknown argument; script missing).

- [ ] **Step 3: Implement** `parseCommand` (`login: {type: "string"}`), the early branch in `main` right after `loadConfig` (before the state file is opened), the script, and the usage.

- [ ] **Step 4: Run the tests**

Run: `node --test test/pipeline/`
Expected: PASS.

- [ ] **Step 5: Commit** — subject `--login: authorise a persona inside its container (#68)`.

### Task 7: Status shows the profiles; the prompts stop pushing with `-u`

**Files:**
- Modify: `pipeline/lib/status.js` (or wherever `statusText` lives: `grep -n statusText pipeline/lib`), `bin/pipeline.js` `--status` branch
- Modify: `pipeline/spawn.md:14`, `pipeline/build.md:11,66`, `pipeline/tests.md:10,61` (drop ` -u` from every `--push` example)
- Test: `test/pipeline/pipeline.test.js`, `test/pipeline/prompts.test.js`

**Interfaces:**
- Consumes: `sandbox.inspectProfile` (Task 4), `PERSONAS`.
- Produces: `--status` prints, after the sessions, one line per persona: `profile <persona>: none` | `profile <persona>: claude logged in, servers: a, b` | `profile <persona>: claude not logged in`; `--status` therefore takes the sandbox (it builds one today only after the status branch; move the `createSandbox` call above it). The prompts' push examples read `gh-as <persona> --push <branch>`.

- [ ] **Step 1: Write the failing tests**

```js
test("--status lists each persona's profile without values", async () => { /* fake sandbox.inspectProfile answering per persona; text matches /profile architect: claude logged in, servers: mobbin/ and /profile ops: none/; text does not match /accessToken/ */ });
```
In `prompts.test.js`: `test("no prompt pushes with -u", () => { for each pipeline/*.md: assert.doesNotMatch(text, /--push [^\n]*-u\b/); })`.

- [ ] **Step 2: Run to verify they fail**

Expected: FAIL on both.

- [ ] **Step 3: Implement.**

- [ ] **Step 4: Run** `node --test test/pipeline/` — Expected: PASS.

- [ ] **Step 5: Commit** — subject `Status shows the persona profiles; prompts push without -u (#68)`.

### Task 8: Design record, launch plan and README

**Files:**
- Modify: `docs/software-factory/loop-design.md:193-205` (the credentials paragraph) and the Builder notes section
- Modify: `.agents/plans/2026-10-21-factory-launch.md` Task 6 (the token check and Task 0's token line)
- Modify: `docs/software-factory/README.md` (how to log a persona in)
- Modify: `docker/factory/README.md` (the `/profile` volume, rebuilding for ownership)
- Test: none (documents); `npm run check` on the tree.

- [ ] **Step 1: Write the design section** "Persona profiles" in `loop-design.md` replacing the sentence "The Claude Code token comes from `claude setup-token` on the host, stored once." with the profile design (volume per persona at `/profile`, the three config dirs, `--login`, the allowlist enforced against the profile, one session per persona, the token as the fallback, the host network during login only, hosted cloud sessions as a follow-on since a volume cannot be mounted there: a profile exported as an encrypted blob is the candidate). Keep it under 25 lines.
- [ ] **Step 2: Update the launch plan**: Task 0's token line becomes `npm run pipeline -- --login <persona>` for the six personas (`--harness codex` too where Tim wants Codex); Task 6's token check becomes `node bin/pipeline.js --status` showing every persona `logged in` and the allowed servers, and `docker exec <container> sh -c 'test -d "$CLAUDE_CONFIG_DIR" && echo set'`.
- [ ] **Step 3: README lines**: under the loop's how-to, "Before the first run: `npm run pipeline -- --login architect` (and each persona); inside, `claude`, `/login`, `/mcp`, exit. `--status` shows what each profile holds."
- [ ] **Step 4: Run** `npm run check` (Prettier on the markdown is not enforced; ESLint, Stylelint and tsc must be unchanged: 151 ESLint findings after #69 and #70 merge, or the count master has when the branch is cut) and `node --test test/pipeline/`.
- [ ] **Step 5: Commit** — subject `Record the persona profiles in the design, the launch plan and the README (#68)`.

### Task 9: PR

- [ ] **Step 1:** `npx gulp` then revert the noise files; `npm test` (667 plus the new tests); `node bin/check-coverage.js --base master` and `node bin/check-pr.js --base master` print `ok` with the PR body in `.agents/tmp/pr-68.md` (`Closes #68`; What changed per task; Plan: this file's path; Dependencies: none; Ideas filed: the hosted-cloud follow-on as an `idea` issue by `builder`; QA: the counts).
- [ ] **Step 2:** `gh-as builder --push 68-persona-profiles` (no `-u`), `gh-as builder pr create -R tjlytle/Sozi --head 68-persona-profiles --title "Persona profiles: authorise once inside a container (#68)" --body-file .agents/tmp/pr-68.md`; move #68 to `stage:review`.
