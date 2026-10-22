/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Starting sessions: queued spawn requests first, then due issues, while a slot is free.
// Each session gets a rendered prompt in a fresh outbox and a container.

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {renderPrompt} from "./prompt.js";
import {ceiling, dueIssues, promptFor, scope} from "./state.js";
import {moveStage, writeLabel} from "./sync.js";

/**
 * @typedef {import("./sync.js").PassContext} PassContext
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
 * Start a spawn request as a session of its own.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {Spawn} spawn - The request.
 * @returns {Promise<void>}
 */
async function startSpawn(ctx, spawn) {
    const {settings, state, sandbox} = ctx;
    const issue = spawn.issue ?? 0;
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
        harness: spawn.harness ?? settings.harnessFor("qa"),
        model: settings.modelFor("qa"),
        tag: crypto.randomBytes(2).toString("hex"),
        env: sessionEnv(ctx, issue)
    });
    const started = new Date(ctx.clock.now()).toISOString();
    state.run.sessions.push({container, started, outbox, persona: spawn.persona, issue});
    ctx.summary.spawns++;
    ctx.log(`spawn ${spawn.persona} started: ${container}`);
}

/**
 * Start the stage session of an issue, labelled working while it runs.
 *
 * @param {PassContext} ctx - The pass context.
 * @param {number} n - The issue number.
 * @returns {Promise<void>}
 */
async function startIssue(ctx, n) {
    const {state, sandbox} = ctx;
    const record = state.issues[n];
    if (record.stage === "stage:blocked") {
        await moveStage(ctx, n, "stage:tests");
    }
    const stage = /** @type {string} */ (promptFor(record.stage));
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
            env: sessionEnv(ctx, n)
        });
    } catch (error) {
        record.labels = record.labels.filter(l => l !== "working");
        await writeLabel(ctx, {issue: n, add: [], remove: ["working"]});
        throw error;
    }
    record.session = {container, started: new Date(ctx.clock.now()).toISOString(), stage, outbox};
    ctx.summary.started.push(n);
    ctx.log(`#${n}: ${stage} started: ${container}`);
}

/**
 * The next issue to start: due, in scope, not tried this pass, the only one when set.
 *
 * @param {PassContext} ctx - The pass context.
 * @returns {number | undefined} The issue number.
 */
function nextIssue(ctx) {
    const {state} = ctx;
    const scoped = state.run.epic ? new Set(scope(state, {epic: state.run.epic})) : null;
    return dueIssues(state, ctx.settings, new Date(ctx.clock.now())).find(
        n =>
            !ctx.tried.has(n) &&
            (!scoped || scoped.has(n)) &&
            (state.run.only === null || n === state.run.only)
    );
}

/**
 * Start sessions while slots are free: queued spawns first, then due issues. One slot
 * past the soft ceiling; none while a model rate limit pauses starts.
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
    while (running(ctx) < limit) {
        const spawn = state.run.only === null ? state.run.spawns[0] : undefined;
        const n = spawn ? undefined : nextIssue(ctx);
        if (!spawn && n === undefined) {
            return;
        }
        try {
            if (spawn) {
                await startSpawn(ctx, spawn);
                state.run.spawns.shift();
            } else {
                await startIssue(ctx, /** @type {number} */ (n));
            }
        } catch (error) {
            ctx.log(`start failed, no more starts this pass: ${String(error)}`);
            return;
        }
    }
}
