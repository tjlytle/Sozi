import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {builtModule} from "../support/stubs.js";

const {cliSwitches, processGoneLine} = await builtModule("cli/switches.js");

describe("cliSwitches", () => {
    test("on Linux, keeps shared memory out of /dev/shm and renders at scale 1", () => {
        const switches = cliSwitches("linux");
        assert.deepEqual(switches, [["force-device-scale-factor", "1"], ["disable-dev-shm-usage"]]);
    });

    for (const platform of ["darwin", "win32"]) {
        test(`on ${platform}, only renders at scale 1`, () => {
            assert.deepEqual(cliSwitches(platform), [["force-device-scale-factor", "1"]]);
        });
    }
});

describe("processGoneLine", () => {
    test("names a crashed GPU process and its exit code", () => {
        assert.equal(
            processGoneLine({type: "GPU", reason: "crashed", exitCode: 3}),
            "sozi: GPU process gone: crashed (exit 3)"
        );
    });

    test("names a utility process by its name", () => {
        assert.equal(
            processGoneLine({
                type: "Utility",
                reason: "abnormal-exit",
                exitCode: 1,
                name: "Network Service"
            }),
            "sozi: Utility process gone: abnormal-exit (exit 1, Network Service)"
        );
    });

    test("names a process that ran out of memory", () => {
        assert.equal(
            processGoneLine({type: "GPU", reason: "oom", exitCode: -1}),
            "sozi: GPU process gone: oom (exit -1)"
        );
    });
});
