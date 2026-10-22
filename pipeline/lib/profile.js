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
