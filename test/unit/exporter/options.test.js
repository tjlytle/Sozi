/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {withDefaults, progress} from "../../../src/js/exporter/options.js";

describe("withDefaults", () => {
    test("fills every option the caller left out", () => {
        const opts = withDefaults(undefined);
        assert.equal(opts.outPath, null);
        assert.equal(opts.ffmpegPath, null);
        assert.equal(opts.transparent, false);
        assert.equal(opts.frameNumber, false);
        assert.equal(opts.timeoutMs, 30000);
        assert.equal(opts.ffmpegTimeoutMs, null);
        assert.equal(opts.onProgress, null);
    });
    test("keeps the options the caller gave", () => {
        const opts = withDefaults({outPath: "talk.pdf", timeoutMs: 5000, hidden: false});
        assert.equal(opts.outPath, "talk.pdf");
        assert.equal(opts.timeoutMs, 5000);
        assert.equal(opts.hidden, false);
    });
    test("hides the window unless SOZI_EXPORT_SHOW is set", () => {
        const saved = process.env.SOZI_EXPORT_SHOW;
        try {
            delete process.env.SOZI_EXPORT_SHOW;
            assert.equal(withDefaults({}).hidden, true);
            process.env.SOZI_EXPORT_SHOW = "1";
            assert.equal(withDefaults({}).hidden, false);
        } finally {
            if (saved === undefined) {
                delete process.env.SOZI_EXPORT_SHOW;
            } else {
                process.env.SOZI_EXPORT_SHOW = saved;
            }
        }
    });
});

describe("progress", () => {
    test("reports the steps done and the total to the callback", () => {
        const calls = [];
        progress({onProgress: p => calls.push(p)}, 2, 5);
        assert.deepEqual(calls, [{done: 2, total: 5}]);
    });
    test("ignores a missing callback", () => {
        assert.doesNotThrow(() => progress({onProgress: null}, 1, 1));
    });
    test("ignores a callback that throws", () => {
        const onProgress = () => {
            throw new Error("broken");
        };
        assert.doesNotThrow(() => progress({onProgress}, 1, 1));
    });
});
