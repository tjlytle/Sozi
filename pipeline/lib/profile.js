/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// The persona profiles: which persona a stage runs as, the Docker volume that holds that
// persona's logins and settings, and the arguments that mount it into a stage container.

/** The personas, one profile volume each. */
export const PERSONAS = Object.freeze([
    "advocate",
    "architect",
    "builder",
    "qa",
    "reviewer",
    "ops"
]);

/** The persona each stage runs as; the spawn stage takes the persona of its caller. */
const STAGE_PERSONAS = {
    plan: "architect",
    tests: "qa",
    build: "builder",
    review: "reviewer",
    qa: "qa"
};

/** The persona a stage runs as.
 *
 * @param {string} stage - The stage name.
 * @param {string} [spawnPersona] - The persona of a spawn stage.
 * @returns {string} - The persona.
 * @throws {Error} - When the stage has no persona.
 */
export function personaFor(stage, spawnPersona) {
    if (stage === "spawn" && spawnPersona !== undefined) {
        return spawnPersona;
    }
    if (!Object.hasOwn(STAGE_PERSONAS, stage)) {
        throw new Error(`no persona for stage ${stage}`);
    }
    return STAGE_PERSONAS[/** @type {keyof typeof STAGE_PERSONAS} */ (stage)];
}

/** The name of the Docker volume holding a persona's profile.
 *
 * @param {string} persona - The persona name.
 * @returns {string} - The volume name.
 * @throws {Error} - When the persona is unknown.
 */
export function volumeName(persona) {
    if (!PERSONAS.includes(persona)) {
        throw new Error(`unknown persona ${persona}`);
    }
    return `sozi-factory-profile-${persona}`;
}

/** The docker run arguments that mount a persona's profile and point the CLIs at it.
 *
 * @param {string} persona - The persona name.
 * @returns {string[]} - The arguments.
 */
export function profileArgs(persona) {
    return [
        "-v",
        `${volumeName(persona)}:/profile`,
        "-e",
        "CLAUDE_CONFIG_DIR=/profile/claude",
        "-e",
        "CODEX_HOME=/profile/codex",
        "-e",
        "XDG_CONFIG_HOME=/profile/xdg"
    ];
}

/**
 * What a persona profile holds; names and booleans only, never a value.
 *
 * @typedef {object} ProfileInfo
 * @property {{present: boolean, loggedIn: boolean, servers: string[], updated?: string | null}} claude - The Claude Code profile; updated is when its credentials last changed.
 * @property {{present: boolean, loggedIn: boolean}} codex - The Codex profile.
 * @property {boolean} writable - Whether the profile directory is writable.
 */

/** Inspect a persona's profile volume read-only, in the stage image.
 *
 * @param {import("./github.js").Runner} run - The command runner.
 * @param {{image: string, persona: string}} options - The stage image and the persona.
 * @returns {Promise<ProfileInfo | null>} - What the profile holds; null when it has no volume.
 * @throws {Error} - When the inspection output cannot be read.
 */
export async function inspectProfile(run, {image, persona}) {
    const volume = volumeName(persona);
    if ((await run(["docker", "volume", "inspect", volume])).code !== 0) {
        return null;
    }
    const r = await run([
        "docker",
        "run",
        "--rm",
        "-v",
        `${volume}:/profile:ro`,
        image,
        "/pipeline/profile-inspect.sh"
    ]);
    try {
        if (r.code !== 0) {
            throw new Error("inspect exited non-zero");
        }
        return JSON.parse(r.stdout.trim().split("\n").pop() ?? "");
    } catch {
        throw new Error(`profile inspect failed for ${persona}`);
    }
}

/** The MCP servers a profile holds that its persona may not.
 *
 * @param {ProfileInfo} info - The inspected profile.
 * @param {string[]} allowed - The server names the persona may hold.
 * @returns {string[]} - The disallowed server names, sorted.
 */
export function checkAllowlist(info, allowed) {
    return info.claude.servers.filter(s => !allowed.includes(s)).sort();
}
