/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The docker run arguments and environment of the containers stages run in: a stage, an
// interactive login and an advisor call. Pure: nothing here runs a command.

import {profileArgs} from "./profile.js";

/** Credentials (the mint key among them) and per-session values passed by name, so Docker reads them from the
 * environment of the docker command and they never appear in a process listing.
 */
export const BY_NAME = [
    "CLAUDE_CODE_OAUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "NOTION_TOKEN",
    "PIPELINE_NOTION_PAGE",
    "PIPELINE_EVIDENCE_ACCOUNT",
    "PIPELINE_EVIDENCE_BUCKET",
    "PIPELINE_EVIDENCE_TOKEN",
    "PIPELINE_EVIDENCE_URL",
    "PIPELINE_RUN",
    "PIPELINE_ISSUE",
    "PIPELINE_BRANCH",
    "GH_MINT_KEY"
];

/** The fallback credentials a mounted profile's login replaces. */
export const PROFILE_REPLACES = ["CLAUDE_CODE_OAUTH_TOKEN", "ANTHROPIC_API_KEY"];

/** How many times a stage may resume its harness session. */
export const MAX_RESUMES = "3";

/**
 * @typedef {object} StartOptions
 * @property {number} issue - The issue number; 0 for a spawned session with no issue.
 * @property {string} stage - The prompt stage name: plan, tests, build, review, qa or spawn.
 * @property {string} outbox - The host directory mounted at /outbox.
 * @property {string} mintUrl - The mint endpoint as the container reaches it.
 * @property {string} mintKey - The run's mint credential.
 * @property {string} [harness] - The harness; the stage's setting when absent.
 * @property {string} [model] - The model; the stage's setting when absent.
 * @property {string} [tag] - A suffix that keeps the container name unique.
 * @property {string} [persona] - The persona the stage runs as: passed as PIPELINE_PERSONA, and its profile volume is the one mounted.
 * @property {boolean} [profile] - Whether to mount the persona's profile; nothing is mounted when absent.
 * @property {Date} [now] - The time the name carries; the current time when absent.
 * @property {Record<string, string>} [env] - Values for the names passed through, such as PIPELINE_ISSUE.
 * @property {{session: string, carryFrom: string}} [resume] - The harness session to resume, passed as PIPELINE_RESUME_SESSION, and the outbox its carry came from.
 */

/**
 * @typedef {object} ConsultOptions
 * @property {string} key - What the container name carries to tell calls apart.
 * @property {string} checkout - The host checkout mounted as the working directory.
 * @property {string} out - The host directory mounted as the call's outbox.
 * @property {string | null} session - The harness session to resume; a fresh call when null.
 * @property {string} model - The model.
 * @property {number} [now] - The milliseconds the name carries; Date.now() when absent.
 */

/**
 * Two digits.
 *
 * @param {number} n - A number below 100.
 * @returns {string} The number, zero padded.
 */
function pad(n) {
    return String(n).padStart(2, "0");
}

/**
 * The docker run arguments that cap a stage container's memory, CPUs and /dev/shm, for each
 * of them the settings set.
 *
 * @param {any} settings - The loop settings from loadConfig.
 * @returns {string[]} The arguments.
 */
export function resourceArgs(settings) {
    const args = [];
    if (settings.memory) {
        args.push("--memory", settings.memory);
    }
    if (settings.cpus > 0) {
        args.push("--cpus", String(settings.cpus));
    }
    if (settings.shmSize) {
        args.push("--shm-size", settings.shmSize);
    }
    return args;
}

/**
 * The docker run arguments of a stage container. Secrets go by name only.
 *
 * @param {any} settings - The loop settings from loadConfig.
 * @param {string} mirror - The host path of the bare mirror, mounted read-only.
 * @param {StartOptions} opts - The stage to start.
 * @returns {string[]} The arguments, without the leading "docker".
 */
export function startArgs(
    settings,
    mirror,
    {issue, stage, outbox, mintUrl, harness, model, tag, now, persona, profile, resume}
) {
    const at = now ?? new Date();
    const name = `factory-${issue}-${stage}-${pad(at.getUTCHours())}${pad(at.getUTCMinutes())}`;
    const args = ["run", "-d", "--name", tag ? `${name}-${tag}` : name];
    args.push("--add-host=host.docker.internal:host-gateway", ...resourceArgs(settings));
    args.push("-v", `${mirror}:/mirror:ro`, "-v", `${outbox}:/outbox`);
    // With a profile no token name is passed: docker would read it from its own
    // environment, and a token takes precedence over the profile login.
    for (const byName of BY_NAME) {
        if (!(profile && PROFILE_REPLACES.includes(byName))) {
            args.push("-e", byName);
        }
    }
    const values = {
        GH_MINT_URL: mintUrl,
        PIPELINE_REPO: settings.repo,
        PIPELINE_HARNESS: harness ?? settings.harnessFor(stage),
        PIPELINE_MODEL: model ?? settings.modelFor(stage),
        PIPELINE_SESSION_BUDGET_USD: String(settings.sessionBudgetUsd),
        PIPELINE_MAX_RESUMES: MAX_RESUMES,
        PIPELINE_ADVISOR_WAIT_MINUTES: String(settings.advisor.waitMinutes),
        GH_BOT_CONFIG_DIR: "/outbox/gh-bot",
        // What stage.sh signs gh-as bodies and commits with (#166).
        ...(persona ? {PIPELINE_PERSONA: persona} : {}),
        ...(resume ? {PIPELINE_RESUME_SESSION: resume.session} : {})
    };
    for (const [key, value] of Object.entries(values)) {
        args.push("-e", `${key}=${value}`);
    }
    if (profile) {
        args.push(...profileArgs(/** @type {string} */ (persona)));
    }
    args.push(settings.image, "/pipeline/stage.sh", String(issue), stage);
    return args;
}

/**
 * The environment of the docker command that starts a stage: the by-name secrets the loop
 * holds (less the tokens a profile replaces), the evidence settings, opts.env and the mint key.
 *
 * @param {any} settings - The loop settings from loadConfig.
 * @param {Record<string, string | undefined>} loopEnv - The loop's environment.
 * @param {StartOptions} opts - The stage to start.
 * @returns {Record<string, string>} The environment.
 */
export function startEnv(settings, loopEnv, opts) {
    const ev = settings.evidence;
    /** @type {Record<string, string>} */
    const env = {};
    // With a profile its login is what the CLI uses; a token would take precedence over it.
    const skip = opts.profile ? PROFILE_REPLACES : [];
    for (const name of BY_NAME) {
        const value = loopEnv[name];
        if (value && !skip.includes(name)) {
            env[name] = value;
        }
    }
    const fromSettings = {
        PIPELINE_EVIDENCE_ACCOUNT: ev.account,
        PIPELINE_EVIDENCE_BUCKET: ev.bucket,
        PIPELINE_EVIDENCE_TOKEN: ev.token,
        PIPELINE_EVIDENCE_URL: ev.url
    };
    for (const [key, value] of Object.entries(fromSettings)) {
        if (value) {
            env[key] = value;
        }
    }
    return {...env, ...opts.env, GH_MINT_KEY: opts.mintKey};
}

/**
 * The docker run arguments of an interactive login under a persona's profile.
 *
 * @param {string} image - The stage image.
 * @param {{persona: string, harness: string}} opts - The persona and the harness to log in.
 * @returns {string[]} The arguments, without the leading "docker".
 */
export function loginArgs(image, {persona, harness}) {
    return [
        "run",
        "-it",
        "--rm",
        "--network",
        "host",
        "--name",
        `factory-login-${persona}`,
        ...profileArgs(persona),
        "-e",
        `PIPELINE_LOGIN_PERSONA=${persona}`,
        "-e",
        `PIPELINE_LOGIN_HARNESS=${harness}`,
        image,
        "/pipeline/login.sh"
    ];
}

/**
 * The docker run arguments and environment of one advisor call: the claude adapter under
 * the architect's profile, or with the fallback tokens when profiles are off.
 *
 * @param {any} settings - The loop settings from loadConfig.
 * @param {Record<string, string | undefined>} loopEnv - The loop's environment.
 * @param {ConsultOptions} opts - The call.
 * @returns {{args: string[], env: Record<string, string>}} The arguments, without the
 *     leading "docker", and the environment of the docker command.
 */
export function consultArgs(settings, loopEnv, {key, checkout, out, session, model, now}) {
    const call = session
        ? ["resume", "--session", session, "--message", "/consult/prompt.md"]
        : ["run", "--prompt", "/consult/prompt.md"];
    const profile = settings.profiles !== "off";
    const env = Object.fromEntries(
        PROFILE_REPLACES.filter(name => !profile && loopEnv[name]).map(name => [
            name,
            String(loopEnv[name])
        ])
    );
    const args = ["run", "--rm", "--name", `factory-advisor-${key}-${now ?? Date.now()}`];
    args.push(...resourceArgs(settings), "-v", `${checkout}:/advisor`, "-v", `${out}:/consult`);
    args.push(...(profile ? profileArgs("architect") : PROFILE_REPLACES.flatMap(n => ["-e", n])));
    // The image's entrypoint is bash; timeout bounds the call to how long bin/advise waits.
    args.push("--entrypoint", "timeout", settings.image);
    args.push(String(Math.ceil(settings.advisor.waitMinutes * 60)));
    args.push("/pipeline/harness/claude", ...call, "--model", model);
    args.push("--allow", "/consult/allow.txt", "--checkout", "/advisor", "--out", "/consult");
    return {args, env};
}
