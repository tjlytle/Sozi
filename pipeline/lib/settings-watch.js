/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Rereads pipeline/config and var/pipeline/env between passes when either changed, and
// lays the new values over the running loop's settings and environment in place.

import fs from "node:fs";
import path from "node:path";
import {changedSettings, loadConfig} from "./config.js";

/**
 * The modification time of a file, or null when it does not exist.
 *
 * @param {string} file - The path.
 * @returns {number | null} - The mtime in milliseconds.
 */
function mtimeOf(file) {
    return fs.statSync(file, {throwIfNoEntry: false})?.mtimeMs ?? null;
}

/**
 * The secrets the environment does not override, which are the ones a file change reaches.
 *
 * @param {Record<string, string>} secrets - The secrets from the files.
 * @param {Record<string, string | undefined>} env - The environment.
 * @returns {Record<string, string>} - The secrets left.
 */
function unshadowed(secrets, env) {
    return Object.fromEntries(Object.entries(secrets).filter(([key]) => env[key] === undefined));
}

/** Watches the two settings files and applies a change at the start of a pass. */
export class SettingsWatch {
    /**
     * @param {object} options - What the watch works with.
     * @param {string} options.root - The repository root, where the settings files live.
     * @param {Record<string, string | undefined>} options.env - The environment loadConfig got, the --harness override included.
     * @param {any} options.settings - The settings from loadConfig, updated in place.
     * @param {Record<string, string | undefined>} options.runEnv - The sessions' environment, updated in place.
     * @param {(line: string) => void} options.log - The log.
     * @param {(file: string) => number | null} [options.stat] - The mtime of a file; null when it is missing.
     */
    constructor({root, env, settings, runEnv, log, stat = mtimeOf}) {
        this.root = root;
        this.env = env;
        this.settings = settings;
        this.runEnv = runEnv;
        this.log = log;
        this.stat = stat;
        this.files = [
            path.join(root, "pipeline", "config"),
            path.join(root, "var", "pipeline", "env")
        ];
        this.stamps = this.files.map(file => this.stat(file));
    }

    /** Rereads the files when either one's mtime changed; keeps the old settings and logs the
     * error once when the new ones do not load.
     */
    refresh() {
        const stamps = this.files.map(file => this.stat(file));
        if (stamps.every((stamp, i) => stamp === this.stamps[i])) {
            return;
        }
        this.stamps = stamps;
        let fresh;
        try {
            fresh = loadConfig({root: this.root, env: this.env});
        } catch (error) {
            this.log(
                `settings not reloaded: ${error instanceof Error ? error.message : String(error)}`
            );
            return;
        }
        const old = this.settings;
        const view = (/** @type {any} */ s) => ({
            values: s.values,
            secrets: unshadowed(s.secrets, this.env)
        });
        for (const line of changedSettings(view(old), view(fresh))) {
            this.log(line);
        }
        for (const key of Object.keys(old.secrets)) {
            if (!(key in fresh.secrets) && this.env[key] === undefined) {
                delete this.runEnv[key];
            }
        }
        Object.assign(this.runEnv, unshadowed(fresh.secrets, this.env));
        Object.assign(old, fresh, {repo: old.repo, mintPort: old.mintPort});
    }

    /** Nothing to release: the watch holds no timer or listener. */
    dispose() {}
}
