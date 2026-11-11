// test/pipeline/sandbox-world.js: the fakes the sandbox tests share.
import path from "node:path";
import {createSandbox} from "../../pipeline/lib/sandbox.js";
import {loadConfig} from "../../pipeline/lib/config.js";

/** The repository root, for the tests that read the factory's Dockerfile. */
export const REPO = path.resolve(import.meta.dirname, "..", "..");

/**
 * The loop's settings with the memory, CPU and shm limits the sandbox tests expect.
 *
 * @returns {ReturnType<typeof loadConfig>} - The settings.
 */
export function sandboxSettings() {
    return loadConfig({
        root: "/nonexistent",
        env: {PIPELINE_MEMORY: "6g", PIPELINE_CPUS: "2", PIPELINE_SHM_SIZE: "2g"}
    });
}

/**
 * A sandbox whose runner records commands and answers from a table.
 *
 * @param {(cmd: string[]) => {code: number, stdout?: string, stderr?: string}} answer - The reply per command.
 * @param {string} [root] - The repository root.
 * @returns {{sb: ReturnType<typeof createSandbox>, calls: {cmd: string[], opts: any}[]}} - The sandbox and its calls.
 */
export function recording(answer, root = "/repo") {
    /** @type {{cmd: string[], opts: any}[]} */
    const calls = [];
    const run = async (/** @type {string[]} */ cmd, /** @type {any} */ opts) => {
        calls.push({cmd, opts});
        const a = answer(cmd);
        return {code: a.code, stdout: a.stdout ?? "", stderr: a.stderr ?? ""};
    };
    return {sb: createSandbox({settings: sandboxSettings(), root, run}), calls};
}
