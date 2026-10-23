// test/pipeline/settings-watch.test.js: the settings reread between passes, and the pass's reload hook.
import {test, describe} from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {loadConfig} from "../../pipeline/lib/config.js";
import {SettingsWatch} from "../../pipeline/lib/settings-watch.js";
import {issue, world} from "./pass-world.js";

/**
 * A temporary root with a pipeline/config and a var/pipeline/env.
 *
 * @param {string} config - The pipeline/config text.
 * @param {string} envFile - The var/pipeline/env text.
 * @returns {{root: string, write: (text: string, mtime: number) => void}} - The root, and a writer for the env file that sets its mtime in seconds.
 */
function tempRoot(config, envFile) {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "settings-"));
    fs.mkdirSync(path.join(root, "pipeline"));
    fs.mkdirSync(path.join(root, "var", "pipeline"), {recursive: true});
    fs.writeFileSync(path.join(root, "pipeline", "config"), config);
    const file = path.join(root, "var", "pipeline", "env");
    const write = (/** @type {string} */ text, /** @type {number} */ mtime) => {
        fs.writeFileSync(file, text);
        fs.utimesSync(file, mtime, mtime);
    };
    write(envFile, 1000);
    return {root, write};
}

/**
 * A watch over a temporary root, with its settings, run environment and log.
 *
 * @param {string} envFile - The var/pipeline/env text.
 * @param {{env?: Record<string, string>, stat?: (file: string) => number | null}} [options] - The environment and a stat fake.
 * @returns {any} - The watch and what it changes.
 */
function watched(envFile, {env = {}, stat} = {}) {
    const {root, write} = tempRoot("PIPELINE_SYNC_MINUTES=10\n", envFile);
    const settings = loadConfig({root, env});
    const runEnv = {...settings.secrets, ...env};
    /** @type {string[]} */
    const logs = [];
    const watch = new SettingsWatch({
        root,
        env,
        settings,
        runEnv,
        log: line => logs.push(line),
        stat
    });
    return {watch, settings, runEnv, logs, write};
}

describe("SettingsWatch", () => {
    test("a parallel change from 2 to 4 between passes starts two more sessions", async () => {
        const issues = [25, 26, 27, 28, 29, 30].map(n => issue(n, ["stage:todo"]));
        const {root, write} = tempRoot("PIPELINE_PER_PERSONA=6\n", "PIPELINE_PARALLEL=2\n");
        const w = world({
            issues,
            configRoot: root,
            reload: () => watch.refresh()
        });
        const watch = new SettingsWatch({
            root,
            env: {},
            settings: w.settings,
            runEnv: {},
            log: line => w.logs.push(line)
        });
        assert.equal(w.settings.parallel, 2);
        assert.deepEqual((await w.p.pass()).started, [25, 26]);
        write("PIPELINE_PARALLEL=4\n", 2000);
        assert.deepEqual((await w.p.pass()).started, [27, 28]);
        assert.equal(
            Object.values(w.state.issues).filter((/** @type {any} */ r) => r.session).length,
            4
        );
        assert.deepEqual(
            w.logs.filter((/** @type {string} */ l) => l.startsWith("setting")),
            ["setting PIPELINE_PARALLEL: 2 -> 4"]
        );
    });
    test("a file whose mtime did not change is not reread", () => {
        /** @type {string[]} */
        const stats = [];
        const stat = (/** @type {string} */ file) => {
            stats.push(file);
            return 1;
        };
        const {watch, settings, logs, write} = watched("PIPELINE_PARALLEL=2\n", {stat});
        write("PIPELINE_PARALLEL=4\n", 2000);
        watch.refresh();
        watch.refresh();
        assert.equal(settings.parallel, 2);
        assert.deepEqual(logs, []);
        assert.equal(stats.length, 6);
    });
    test("a broken value keeps the old settings, logs once, and the next good edit applies", () => {
        const {watch, settings, logs, write} = watched("PIPELINE_PARALLEL=2\n");
        write("PIPELINE_PARALLEL=lots\n", 2000);
        watch.refresh();
        watch.refresh();
        assert.equal(settings.parallel, 2);
        assert.equal(logs.length, 1);
        assert.match(logs[0], /^settings not reloaded: PIPELINE_PARALLEL/);
        write("PIPELINE_PARALLEL=3\n", 3000);
        watch.refresh();
        assert.equal(settings.parallel, 3);
        assert.deepEqual(logs.slice(1), ["setting PIPELINE_PARALLEL: 2 -> 3"]);
    });
    test("the environment beats a file change, and nothing is logged", () => {
        const {watch, settings, logs, write} = watched("PIPELINE_PARALLEL=2\n", {
            env: {PIPELINE_PARALLEL: "1"}
        });
        write("PIPELINE_PARALLEL=4\n", 2000);
        watch.refresh();
        assert.equal(settings.parallel, 1);
        assert.deepEqual(logs, []);
    });
    test("the repository and the mint port keep their start values", () => {
        const {watch, settings, logs, write} = watched("");
        write("PIPELINE_REPO=a/b\nPIPELINE_MINT_PORT=9000\nPIPELINE_PARALLEL=3\n", 2000);
        watch.refresh();
        assert.equal(settings.repo, "tjlytle/Sozi");
        assert.equal(settings.mintPort, 0);
        assert.equal(settings.parallel, 3);
        assert.equal(logs.length, 3);
        watch.refresh();
        assert.equal(logs.length, 3);
    });
    test("a changed secret reaches runEnv and the log names it without its value", () => {
        const {watch, runEnv, logs, write} = watched("CLAUDE_CODE_OAUTH_TOKEN=old\n");
        write("CLAUDE_CODE_OAUTH_TOKEN=new\n", 2000);
        watch.refresh();
        assert.equal(runEnv.CLAUDE_CODE_OAUTH_TOKEN, "new");
        assert.deepEqual(logs, ["secret CLAUDE_CODE_OAUTH_TOKEN changed"]);
    });
    test("a removed secret leaves runEnv unless the environment sets it", () => {
        const {watch, runEnv, settings, write} = watched("NOTION_TOKEN=n\nGH_TOKEN=g\n", {
            env: {GH_TOKEN: "from-shell"}
        });
        assert.equal(runEnv.GH_TOKEN, "from-shell");
        write("", 2000);
        watch.refresh();
        assert.equal("NOTION_TOKEN" in runEnv, false);
        assert.equal(runEnv.GH_TOKEN, "from-shell");
        assert.deepEqual(settings.secrets, {});
    });
    test("a secret the environment sets is not logged when the file changes it", () => {
        const {watch, runEnv, logs, write} = watched("GH_TOKEN=g\n", {
            env: {GH_TOKEN: "from-shell"}
        });
        write("GH_TOKEN=h\n", 2000);
        watch.refresh();
        assert.equal(runEnv.GH_TOKEN, "from-shell");
        assert.deepEqual(logs, []);
    });
    test("dispose leaves the settings as they are", () => {
        const {watch, settings} = watched("PIPELINE_PARALLEL=2\n");
        watch.dispose();
        assert.equal(settings.parallel, 2);
    });
});
