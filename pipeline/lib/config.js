/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Settings of the factory loop. Precedence, highest first: the environment,
// var/pipeline/env (secrets, git-ignored), pipeline/config (policy, committed), defaults.

import fs from "node:fs";
import path from "node:path";

const DEFAULT_MODEL = "claude-opus-5-5";

const DEFAULTS = {
    PIPELINE_PARALLEL: "2",
    PIPELINE_SESSION_MINUTES: "45",
    PIPELINE_SYNC_MINUTES: "10",
    PIPELINE_RATE_LIMIT_BACKOFF_MINUTES: "30",
    PIPELINE_MAX_TRIES: "3",
    PIPELINE_SOFT_TOKENS: "0",
    PIPELINE_HARD_TOKENS: "0",
    PIPELINE_SESSION_BUDGET_USD: "0",
    PIPELINE_MERGE: "auto",
    PIPELINE_PLANS: "auto",
    PIPELINE_FINDINGS: "obvious",
    PIPELINE_REPO: "tjlytle/Sozi",
    PIPELINE_HUMAN: "tjlytle",
    PIPELINE_HARNESS: "claude",
    PIPELINE_MODEL: DEFAULT_MODEL,
    PIPELINE_MODEL_PLAN: "claude-fable-5-1",
    PIPELINE_IMAGE: "sozi-factory",
    PIPELINE_NOTION_PARENT: "",
    PIPELINE_EVIDENCE_ACCOUNT: "",
    PIPELINE_EVIDENCE_BUCKET: "",
    PIPELINE_EVIDENCE_TOKEN: "",
    PIPELINE_EVIDENCE_URL: "",
    PIPELINE_MINT_PORT: "0",
    PIPELINE_MEMORY: "",
    PIPELINE_CPUS: "0"
};

const CHOICES = {
    PIPELINE_MERGE: ["auto", "review"],
    PIPELINE_PLANS: ["auto", "review"],
    PIPELINE_FINDINGS: ["obvious", "triage"]
};

const NUMBERS = [
    "PIPELINE_PARALLEL",
    "PIPELINE_SESSION_MINUTES",
    "PIPELINE_SYNC_MINUTES",
    "PIPELINE_RATE_LIMIT_BACKOFF_MINUTES",
    "PIPELINE_MAX_TRIES",
    "PIPELINE_SOFT_TOKENS",
    "PIPELINE_HARD_TOKENS",
    "PIPELINE_SESSION_BUDGET_USD",
    "PIPELINE_MINT_PORT",
    "PIPELINE_CPUS"
];

/** Parses KEY=value lines; blank lines and lines starting with # are ignored.
 *
 * @param {string} text - The file contents.
 * @returns {Record<string, string>} - The values by key.
 */
export function parseConfigText(text) {
    const out = {};
    for (const line of text.split("\n")) {
        const trimmed = line.trim();
        const eq = trimmed.indexOf("=");
        if (trimmed === "" || trimmed.startsWith("#") || eq < 1) {
            continue;
        }
        out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return out;
}

/** Reads and parses a settings file, or returns no values when it does not exist.
 *
 * @param {string} file - The path.
 * @returns {Record<string, string>} - The values by key.
 */
function readConfigFile(file) {
    try {
        return parseConfigText(fs.readFileSync(file, "utf8"));
    } catch (error) {
        if (error.code === "ENOENT") {
            return {};
        }
        throw error;
    }
}

/** Loads the settings.
 *
 * @param {object} options - The sources.
 * @param {string} options.root - The repository root, where the settings files live.
 * @param {Record<string, string | undefined>} options.env - The environment.
 * @param {Record<string, string>[]} [options.files] - Parsed settings files, lowest precedence first; read from root when absent.
 * @returns {object} - The settings.
 * @throws {Error} - When a value is invalid; the message names the key.
 */
export function loadConfig({root, env, files}) {
    const layers = files ?? [
        readConfigFile(path.join(root, "pipeline", "config")),
        readConfigFile(path.join(root, "var", "pipeline", "env"))
    ];
    const raw = Object.assign({}, DEFAULTS, ...layers);
    for (const [key, value] of Object.entries(env)) {
        if (key.startsWith("PIPELINE_") && value !== undefined) {
            raw[key] = value;
        }
    }
    for (const [key, allowed] of Object.entries(CHOICES)) {
        if (!allowed.includes(raw[key])) {
            throw new Error(`${key} must be one of ${allowed.join("|")}, not "${raw[key]}"`);
        }
    }
    for (const key of NUMBERS) {
        if (!/^\d+$/.test(raw[key])) {
            throw new Error(`${key} must be an integer of at least 0, not "${raw[key]}"`);
        }
    }

    const num = key => Number(raw[key]);
    const perStage = (prefix, stage, fallback) =>
        raw[`${prefix}_${stage.toUpperCase()}`] ?? fallback;
    return {
        parallel: num("PIPELINE_PARALLEL"),
        sessionMinutes: num("PIPELINE_SESSION_MINUTES"),
        syncMinutes: num("PIPELINE_SYNC_MINUTES"),
        rateLimitBackoffMinutes: num("PIPELINE_RATE_LIMIT_BACKOFF_MINUTES"),
        maxTries: num("PIPELINE_MAX_TRIES"),
        softTokens: num("PIPELINE_SOFT_TOKENS"),
        hardTokens: num("PIPELINE_HARD_TOKENS"),
        sessionBudgetUsd: num("PIPELINE_SESSION_BUDGET_USD"),
        merge: raw.PIPELINE_MERGE,
        plans: raw.PIPELINE_PLANS,
        findings: raw.PIPELINE_FINDINGS,
        repo: raw.PIPELINE_REPO,
        human: raw.PIPELINE_HUMAN,
        harness: raw.PIPELINE_HARNESS,
        /** The harness for a stage.
         *
         * @param {string} stage - The stage name.
         * @returns {string} - The harness.
         */
        harnessFor: stage => perStage("PIPELINE_HARNESS", stage, raw.PIPELINE_HARNESS),
        /** The model for a stage; tests defaults to the QA model.
         *
         * @param {string} stage - The stage name.
         * @returns {string} - The model.
         */
        modelFor: stage => {
            const fallback =
                stage === "tests"
                    ? perStage("PIPELINE_MODEL", "qa", raw.PIPELINE_MODEL)
                    : raw.PIPELINE_MODEL;
            return perStage("PIPELINE_MODEL", stage, fallback);
        },
        image: raw.PIPELINE_IMAGE,
        notionParent: raw.PIPELINE_NOTION_PARENT,
        evidence: {
            account: raw.PIPELINE_EVIDENCE_ACCOUNT,
            bucket: raw.PIPELINE_EVIDENCE_BUCKET,
            token: raw.PIPELINE_EVIDENCE_TOKEN,
            url: raw.PIPELINE_EVIDENCE_URL
        },
        mintPort: num("PIPELINE_MINT_PORT"),
        memory: raw.PIPELINE_MEMORY,
        cpus: num("PIPELINE_CPUS")
    };
}
