/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Starting sessions: queued spawn requests first, then due issues, the least-busy persona first,
// while a slot is free and the persona has one. Each session gets a rendered prompt in a fresh
// outbox and a container, with its persona's profile mounted when profile-verdict.js passes it,
// on the route stage-route.js picks.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {carryOf, fallbackNote} from "./carry.js";
import {handover} from "./leftover.js";
import {pausedUntil} from "./limits.js";
import {stillLoggedOut} from "./logins.js";
import {personaFor} from "./profile.js";
import {renderPrompt} from "./prompt.js";
import {atPersonaLimit, running, runningFor} from "./running.js";
import {pickRoute, routeFor} from "./stage-route.js";
import {dueIssues, scope} from "./due.js";
import {ceiling, promptFor} from "./state.js";
import {moveStage, writeComment, writeLabel} from "./sync.js";

/**
 * @typedef {import("./sync.js").PassContext} PassContext
 * @typedef {import("./stage-route.js").StageRoute} StageRoute
 * @typedef {{persona: string, prompt: string, issue: number | null, harness: string | null}} Spawn
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
 * The branch an issue's session works on, as PIPELINE_BRANCH: the head of the open PR that
 * closes the issue. Empty when there is no such PR, or when the lookup fails (logged), so
 * stage.sh falls back to listing the issue's branches.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @returns {Promise<Record<string, string>>} The value when there is one.
 */
async function branchEnv(ctx, n) {
    try {
        const pr = await ctx.github.openPrFor(n);
        return pr ? {PIPELINE_BRANCH: pr.headRefName} : {};
    } catch (error) {
        ctx.log(`#${n}: open PR lookup failed, the stage lists branches: ${String(error)}`);
        return {};
    }
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
 * @param {{profile: boolean, route: StageRoute}} how - Whether to mount the persona's profile, and the harness and model to run on.
 * @returns {Promise<void>}
 */
async function startSpawn(ctx, spawn, {profile, route}) {
    const {state, sandbox} = ctx;
    const issue = spawn.issue ?? 0;
    const {harness, model} = route;
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
 * Write the outbox of an issue's stage session: the prompt, the allow list, and what it
 * carries over from a session a usage limit stopped, with the resume message when it resumes.
 * When the last try of this stage left patches, they are copied under carried/ and the prompt
 * ends with the note that hands them over.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @param {string} stage - The prompt stage name.
 * @param {{carryFrom?: string, resume?: object}} carry - What carryOf found.
 * @returns {string} The outbox.
 */
function issueOutbox(ctx, n, stage, {carryFrom, resume}) {
    const taken = handover(ctx.state.issues[n].leftover, stage);
    const rendered = render(ctx, read(ctx, `${stage}.md`), n, stage);
    const prompt = taken ? `${rendered.trimEnd()}\n\n${taken.note}` : rendered;
    const allow = read(ctx, "allow.txt");
    const message = resume && read(ctx, "resume.md");
    return ctx.sandbox.prepareOutbox({
        ...{issue: n, stage, prompt, allow, carryFrom, resume: message},
        ...(taken && {patches: taken.patches})
    });
}

/**
 * Launch the container of an issue's stage session, labelled working on GitHub and in its record
 * while it starts, with the head of the issue's open PR as the branch to work on; when the start
 * throws, the label comes off in both places and the error goes on.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @param {import("./state.js").IssueRecord} record - The issue record.
 * @param {{stage: string, outbox: string, who: {persona: string, profile: boolean, route: StageRoute}, resume?: object}} session - The stage, its outbox, who runs it, and the session to resume.
 * @returns {Promise<string>} The container id.
 */
async function launch(ctx, n, record, {stage, outbox, who, resume}) {
    const {persona, profile, route} = who;
    await writeLabel(ctx, {issue: n, add: ["working"], remove: []});
    record.labels = [...record.labels.filter(l => l !== "working"), "working"];
    try {
        const {mintUrl, mintKey} = ctx.state.run;
        const env = {...sessionEnv(ctx, n), ...(await branchEnv(ctx, n))};
        return await ctx.sandbox.start({
            issue: n,
            stage,
            outbox,
            mintUrl,
            mintKey,
            env,
            persona,
            profile,
            harness: route.harness,
            model: route.model,
            resume
        });
    } catch (error) {
        record.labels = record.labels.filter(l => l !== "working");
        await writeLabel(ctx, {issue: n, add: [], remove: ["working"]});
        throw error;
    }
}

/**
 * Start the stage session of an issue, labelled working while it runs. It carries on the work of
 * a session of the same stage a usage limit stopped, resuming that session when it can, and keeps
 * that interruption in its session record so that a carry that does not apply is not lost.
 * The session records its harness, model and try now, since the settings may change before
 * it ends.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @param {{persona: string, profile: boolean, route: StageRoute, fallbackFrom?: string}} who - The persona, whether to mount its profile, the harness and model to run on, and the harness at its limit when it is a fallback.
 * @returns {Promise<void>}
 */
async function startIssue(ctx, n, who) {
    const {state} = ctx;
    const {persona, profile, route} = who;
    const record = state.issues[n];
    const stage = stageOfIssue(record);
    if (record.stage === "stage:blocked") {
        await moveStage(ctx, n, "stage:tests");
    }
    const carry = carryOf(record.interrupted, stage, who);
    const {resume} = carry;
    const outbox = issueOutbox(ctx, n, stage, carry);
    const container = await launch(ctx, n, record, {stage, outbox, who, resume});
    const started = new Date(ctx.clock.now()).toISOString();
    const carried = carry.carryFrom ? {carried: record.interrupted} : {};
    const attempt = record.tries + 1;
    record.session = {
        ...{container, started, stage, outbox, persona, profile, ...route, try: attempt},
        ...carried
    };
    record.interrupted = null;
    ctx.summary.started.push(n);
    ctx.log(`#${n}: ${stage} ${resume ? "resumed" : "started"}: ${container}`);
    const from = who.fallbackFrom;
    if (from) {
        const now = ctx.clock.now();
        const until = pausedUntil(state.run.limits, from, now) ?? started;
        await writeComment(ctx, n, fallbackNote({stage, route, from, until, now}));
    }
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
 * logged out or its harness is at its usage limit, and is dropped when its profile is refused or
 * it cannot start.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} index - The index of the spawn in the queue.
 * @returns {Promise<number>} The index of the next spawn to try.
 */
async function trySpawn(ctx, index) {
    const {settings, state} = ctx;
    const spawns = state.run.spawns;
    /** @type {Spawn} */
    const spawn = spawns[index];
    const persona = personaFor("spawn", spawn.persona);
    if (atPersonaLimit(ctx, persona)) {
        return index + 1;
    }
    const harness = spawn.harness ?? settings.harnessFor("qa");
    const pick = await pickRoute(ctx, persona, {
        harness,
        model: settings.modelFor("qa"),
        planned: false
    });
    if ("wait" in pick) {
        return index + 1;
    }
    // Taken off the queue first: a spawn that cannot start is dropped, not retried.
    spawns.splice(index, 1);
    const {verdict, route} = pick;
    if ("refused" in verdict) {
        ctx.log(verdict.refused);
        ctx.log(`spawn ${persona} dropped`);
        return index;
    }
    if (stillLoggedOut(state, persona, verdict.updated)) {
        spawns.splice(index, 0, spawn);
        return index + 1;
    }
    await startSpawn(ctx, spawn, {profile: verdict.profile, route});
    return index;
}

/**
 * Try a due issue: it waits for the next pass while its persona is at its limit, its
 * route or profile is refused, it is logged out, or its harness is at its usage limit with no
 * fallback to take.
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
    const pick = await pickRoute(ctx, persona, route);
    if ("wait" in pick) {
        ctx.log(`#${n}: waits, ${pick.wait}`);
        ctx.tried.add(n);
        return;
    }
    const {verdict} = pick;
    if ("refused" in verdict) {
        ctx.log(verdict.refused);
        ctx.tried.add(n);
        return;
    }
    if (stillLoggedOut(ctx.state, persona, verdict.updated)) {
        ctx.tried.add(n);
        return;
    }
    const {route: picked, fallbackFrom} = pick;
    await startIssue(ctx, n, {persona, profile: verdict.profile, route: picked, fallbackFrom});
}

/**
 * Start sessions while slots are free: queued spawns first, then due issues, the least-busy persona
 * first. One slot past the soft ceiling. A spawn or issue whose persona is at its limit or logged
 * out, or whose harness is at its usage limit, waits for the next pass.
 *
 * @param {PassContext} ctx - The pass context.
 * @returns {Promise<void>}
 */
export async function start(ctx) {
    const {state} = ctx;
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
