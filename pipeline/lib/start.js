/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Starting sessions: queued spawn requests first, then due issues, the least-busy persona first,
// while a slot is free and the persona has one. Each session gets a rendered prompt in a fresh
// outbox and a container, with its persona's profile mounted when the profile passes its checks.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {RateLimited} from "./github.js";
import {stillLoggedOut} from "./logins.js";
import {checkAllowlist, personaFor} from "./profile.js";
import {renderPrompt} from "./prompt.js";
import {planRoutes} from "./routing.js";
import {ceiling, dueIssues, promptFor, scope} from "./state.js";
import {backOff, inBackoff, moveStage, writeLabel} from "./sync.js";

/**
 * @typedef {import("./sync.js").PassContext} PassContext
 * @typedef {{persona: string, prompt: string, issue: number | null, harness: string | null}} Spawn
 * @typedef {{profile: boolean, updated: string | null} | {refused: string}} ProfileVerdict
 * @typedef {{harness: string, model: string, planned: boolean}} StageRoute
 */

/**
 * Read a file under pipeline/.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {string} name - The file name.
 * @returns {string} The contents.
 */
function read(ctx, name) {
    return fs.readFileSync(path.join(ctx.root, "pipeline", name), "utf8");
}

/**
 * Count the sessions running now, for issues and spawned ones.
 *
 * @param {PassContext} ctx - The pass context.
 * @returns {number} The count.
 */
export function running(ctx) {
    const issues = Object.values(ctx.state.issues).filter(r => r.session).length;
    return issues + ctx.state.run.sessions.length;
}

/**
 * Count the sessions of one persona running now; an issue session recorded before
 * sessions carried a persona counts for none.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {string} persona - The persona.
 * @returns {number} The count.
 */
export function runningFor(ctx, persona) {
    const issues = Object.values(ctx.state.issues).filter(
        r => /** @type {{persona?: string} | null} */ (r.session)?.persona === persona
    ).length;
    const spawns = ctx.state.run.sessions.filter(
        (/** @type {{persona: string}} */ s) => s.persona === persona
    ).length;
    return issues + spawns;
}

/**
 * Tell whether a persona has as many sessions as it may run at once.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {string} persona - The persona.
 * @returns {boolean} True when another session of it must wait.
 */
function atPersonaLimit(ctx, persona) {
    const limit = ctx.settings.perPersona;
    return limit > 0 && runningFor(ctx, persona) >= limit;
}

/**
 * Judge a persona's profile: mount it, start without one, or refuse the start. A verdict
 * to start carries when the profile's credentials last changed, when known.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {string} persona - The persona.
 * @param {string} harness - The harness the session runs on.
 * @returns {Promise<ProfileVerdict>} The verdict.
 */
async function judgeProfile(ctx, persona, harness) {
    const {settings, sandbox, env} = ctx;
    if (settings.profiles === "off") {
        return {profile: false, updated: null};
    }
    /** @type {import("./profile.js").ProfileInfo | null} */
    const info = await sandbox.inspectProfile(persona);
    const harnessFlag = harness === "claude" ? "" : ` --harness ${harness}`;
    const login = `npm run pipeline -- --login ${persona}${harnessFlag}`;
    if (info === null) {
        // Only Claude has a token that stands in for a profile.
        if (harness === "claude" && (env.CLAUDE_CODE_OAUTH_TOKEN || env.ANTHROPIC_API_KEY)) {
            return {profile: false, updated: null};
        }
        return {refused: `no profile for ${persona}: run ${login}`};
    }
    if (harness === "claude" && !info.claude.loggedIn) {
        return {refused: `profile of ${persona} is not logged in`};
    }
    // opencode keeps its login where the inspection does not look; its start is not judged.
    if ((harness === "codex" || harness === "agy") && !info[harness]?.loggedIn) {
        return {refused: `profile of ${persona} is not logged in to ${harness}: run ${login}`};
    }
    const extra = checkAllowlist(info, settings.mcpFor(persona));
    if (extra.length > 0) {
        return {
            refused: `profile of ${persona} holds MCP servers not allowed: ${extra.join(", ")}`
        };
    }
    return {profile: true, updated: info.claude.updated ?? null};
}

/**
 * The verdict on a persona's profile for one harness, inspected at most once a pass.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {string} persona - The persona.
 * @param {string} harness - The harness the session runs on.
 * @returns {Promise<ProfileVerdict>} The verdict.
 */
export async function profileFor(ctx, persona, harness) {
    const key = `${persona}/${harness}`;
    const cached = ctx.profiles.get(key);
    if (cached) {
        return cached;
    }
    const verdict = await judgeProfile(ctx, persona, harness);
    ctx.profiles.set(key, verdict);
    return verdict;
}

/**
 * The prompt stage an issue starts now; a blocked issue starts at its tests.
 *
 * @param {import("./state.js").IssueRecord} record - The issue record.
 * @returns {string} The prompt stage name.
 */
function stageOfIssue(record) {
    const stage = record.stage === "stage:blocked" ? "stage:tests" : record.stage;
    return /** @type {string} */ (promptFor(stage));
}

/**
 * The values a session's container reads by name.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} issue - The issue, or 0.
 * @returns {Record<string, string>} The values that are set.
 */
function sessionEnv(ctx, issue) {
    const run = ctx.state.run;
    /** @type {Record<string, string>} */
    const env = {PIPELINE_ISSUE: String(issue)};
    if (run.started) {
        env.PIPELINE_RUN = run.started;
    }
    if (run.notionPage) {
        env.PIPELINE_NOTION_PAGE = run.notionPage;
    }
    return env;
}

/**
 * Render a prompt with the run's settings block.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {string} template - The template.
 * @param {number} issue - The issue, or 0.
 * @param {string} stage - The prompt stage name.
 * @returns {string} The prompt.
 */
function render(ctx, template, issue, stage) {
    const {epic, until} = ctx.state.run;
    return renderPrompt(template, ctx.settings, {issue, stage, epic, until});
}

/**
 * Start a spawn request as a session of its own, recording its harness and model.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {Spawn} spawn - The request.
 * @param {boolean} profile - Whether to mount the persona's profile.
 * @returns {Promise<void>}
 */
async function startSpawn(ctx, spawn, profile) {
    const {settings, state, sandbox} = ctx;
    const issue = spawn.issue ?? 0;
    const harness = spawn.harness ?? settings.harnessFor("qa");
    const model = settings.modelFor("qa");
    const template = read(ctx, "spawn.md")
        .replaceAll("{PERSONA}", spawn.persona)
        .replaceAll("{PROMPT}", spawn.prompt);
    let prompt = render(ctx, template, issue, "spawn");
    if (!spawn.issue) {
        prompt = prompt.replace("- Issue: #0\n", "");
    }
    const allow = read(ctx, "allow.txt");
    const outbox = sandbox.prepareOutbox({issue, stage: "spawn", prompt, allow});
    const container = await sandbox.start({
        issue,
        stage: "spawn",
        outbox,
        mintUrl: state.run.mintUrl,
        mintKey: state.run.mintKey,
        harness,
        model,
        tag: crypto.randomBytes(2).toString("hex"),
        env: sessionEnv(ctx, issue),
        persona: spawn.persona,
        profile
    });
    const started = new Date(ctx.clock.now()).toISOString();
    const persona = spawn.persona;
    state.run.sessions.push({container, started, outbox, persona, issue, harness, model});
    ctx.summary.spawns++;
    ctx.log(`spawn ${spawn.persona} started: ${container}`);
}

/**
 * Start the stage session of an issue, labelled working while it runs. The session
 * records its harness, model and try now, since the settings may change before it ends.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @param {{persona: string, profile: boolean, route: StageRoute}} who - The persona, whether to mount its profile, and the harness and model to run on.
 * @returns {Promise<void>}
 */
async function startIssue(ctx, n, {persona, profile, route}) {
    const {state, sandbox} = ctx;
    const record = state.issues[n];
    const stage = stageOfIssue(record);
    if (record.stage === "stage:blocked") {
        await moveStage(ctx, n, "stage:tests");
    }
    const prompt = render(ctx, read(ctx, `${stage}.md`), n, stage);
    const outbox = sandbox.prepareOutbox({issue: n, stage, prompt, allow: read(ctx, "allow.txt")});
    await writeLabel(ctx, {issue: n, add: ["working"], remove: []});
    record.labels = [...record.labels.filter(l => l !== "working"), "working"];
    let container;
    try {
        const {mintUrl, mintKey} = state.run;
        container = await sandbox.start({
            issue: n,
            stage,
            outbox,
            mintUrl,
            mintKey,
            env: sessionEnv(ctx, n),
            persona,
            profile,
            harness: route.harness,
            model: route.model
        });
    } catch (error) {
        record.labels = record.labels.filter(l => l !== "working");
        await writeLabel(ctx, {issue: n, add: [], remove: ["working"]});
        throw error;
    }
    const started = new Date(ctx.clock.now()).toISOString();
    record.session = {container, started, stage, outbox, persona, ...route, try: record.tries + 1};
    ctx.summary.started.push(n);
    ctx.log(`#${n}: ${stage} started: ${container}`);
}

/**
 * The next issue to start: due, in scope, not tried this pass, the only one when set. Of
 * those, the one whose persona has the fewest sessions running now; on a tie, the lowest
 * number.
 *
 * @param {PassContext} ctx - The pass context.
 * @returns {number | undefined} The issue number.
 */
function nextIssue(ctx) {
    const {state} = ctx;
    const scoped = state.run.epic ? new Set(scope(state, {epic: state.run.epic})) : null;
    const due = dueIssues(state, ctx.settings, new Date(ctx.clock.now())).filter(
        n =>
            !ctx.tried.has(n) &&
            (!scoped || scoped.has(n)) &&
            (state.run.only === null || n === state.run.only)
    );
    let next;
    let fewest = Infinity;
    // dueIssues sorts by number, so a strict < keeps the lowest number on a tie.
    for (const n of due) {
        const count = runningFor(ctx, personaFor(stageOfIssue(state.issues[n])));
        if (count < fewest) {
            next = n;
            fewest = count;
        }
    }
    return next;
}

/**
 * Try the queued spawn at an index: it stays queued while its persona is at its limit or
 * logged out, and is dropped when its profile is refused or it cannot start.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} index - The index of the spawn in the queue.
 * @returns {Promise<number>} The index of the next spawn to try.
 */
async function trySpawn(ctx, index) {
    const spawns = ctx.state.run.spawns;
    /** @type {Spawn} */
    const spawn = spawns[index];
    const persona = personaFor("spawn", spawn.persona);
    if (atPersonaLimit(ctx, persona)) {
        return index + 1;
    }
    // Taken off the queue first: a spawn that cannot start is dropped, not retried.
    spawns.splice(index, 1);
    const verdict = await profileFor(ctx, persona, spawn.harness ?? ctx.settings.harnessFor("qa"));
    if ("refused" in verdict) {
        ctx.log(verdict.refused);
        ctx.log(`spawn ${persona} dropped`);
        return index;
    }
    if (stillLoggedOut(ctx.state, persona, verdict.updated)) {
        spawns.splice(index, 0, spawn);
        return index + 1;
    }
    await startSpawn(ctx, spawn, verdict.profile);
    return index;
}

/**
 * The harness and model a stage of an issue runs on: the line the newest plan has for the
 * stage, else the stage's setting. The plan stage reads no plan. Refused while GitHub is
 * backed off or rate limits the read, and when the plan's Harness section holds a line
 * that does not parse; any other failed read is thrown.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @param {string} stage - The prompt stage name.
 * @returns {Promise<StageRoute | {refused: string}>} The route, or why the issue waits.
 */
async function routeFor(ctx, n, stage) {
    const {settings} = ctx;
    const setting = {harness: settings.harnessFor(stage), model: settings.modelFor(stage)};
    if (stage === "plan") {
        return {...setting, planned: false};
    }
    if (inBackoff(ctx)) {
        return {refused: `#${n}: waits, GitHub backed off, its plan is not read`};
    }
    let text;
    try {
        text = (await ctx.github.planComment(n)) ?? "";
    } catch (error) {
        if (!(error instanceof RateLimited)) {
            throw error;
        }
        backOff(ctx, error);
        return {refused: `#${n}: waits, GitHub rate limited the read of its plan`};
    }
    const {routes, bad} = planRoutes(text);
    if (bad.length > 0) {
        return {refused: `#${n}: plan Harness line "${bad[0]}" is not <stage>: <harness> <model>`};
    }
    const route = routes[stage];
    return route ? {...route, planned: true} : {...setting, planned: false};
}

/**
 * Try a due issue: it waits for the next pass while its persona is at its limit, its
 * route or profile is refused or it is logged out.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @returns {Promise<void>}
 */
async function tryIssue(ctx, n) {
    const stage = stageOfIssue(ctx.state.issues[n]);
    const persona = personaFor(stage);
    if (atPersonaLimit(ctx, persona)) {
        ctx.log(`#${n}: waits, ${persona} at its limit`);
        ctx.tried.add(n);
        return;
    }
    const route = await routeFor(ctx, n, stage);
    if ("refused" in route) {
        ctx.log(route.refused);
        ctx.tried.add(n);
        return;
    }
    const verdict = await profileFor(ctx, persona, route.harness);
    if ("refused" in verdict) {
        ctx.log(verdict.refused);
        ctx.tried.add(n);
        return;
    }
    if (stillLoggedOut(ctx.state, persona, verdict.updated)) {
        ctx.tried.add(n);
        return;
    }
    await startIssue(ctx, n, {persona, profile: verdict.profile, route});
}

/**
 * Start sessions while slots are free: queued spawns first, then due issues, the least-busy persona
 * first. One slot past the soft ceiling; none while a model rate limit pauses starts. A spawn or
 * issue whose persona is at its limit or logged out waits for the next pass.
 *
 * @param {PassContext} ctx - The pass context.
 * @returns {Promise<void>}
 */
export async function start(ctx) {
    const {state} = ctx;
    const paused = state.run.startsPausedUntil;
    if (paused && ctx.clock.now() < Date.parse(paused)) {
        return;
    }
    const limit = ceiling(state, ctx.settings) === "soft" ? 1 : ctx.settings.parallel;
    let index = 0;
    while (running(ctx) < limit) {
        const spawn = state.run.only === null ? state.run.spawns[index] : undefined;
        const n = spawn ? undefined : nextIssue(ctx);
        if (!spawn && n === undefined) {
            return;
        }
        try {
            if (spawn) {
                index = await trySpawn(ctx, index);
            } else {
                await tryIssue(ctx, /** @type {number} */ (n));
            }
        } catch (error) {
            if (spawn) {
                ctx.log(`spawn ${spawn.persona} dropped: ${String(error)}`);
            }
            ctx.log(`start failed, no more starts this pass: ${String(error)}`);
            return;
        }
    }
}
