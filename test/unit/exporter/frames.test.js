/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {
    selectFrames,
    videoTimeline,
    timelineImageCount,
    exportSettings
} from "../../../src/js/exporter/frames.js";

describe("selectFrames", () => {
    test("an empty include selects every frame", () => {
        assert.deepEqual(selectFrames(4, "", ""), [0, 1, 2, 3]);
    });
    test("all and none are keywords", () => {
        assert.deepEqual(selectFrames(3, "all", "none"), [0, 1, 2]);
        assert.deepEqual(selectFrames(3, "all", "all"), []);
    });
    test("frame numbers are 1-based", () => {
        assert.deepEqual(selectFrames(5, "1,3", ""), [0, 2]);
    });
    test("a range includes both ends", () => {
        assert.deepEqual(selectFrames(6, "2:4", ""), [1, 2, 3]);
    });
    test("a range with an open end runs to the last frame", () => {
        assert.deepEqual(selectFrames(5, "3:", ""), [2, 3, 4]);
        assert.deepEqual(selectFrames(5, ":2", ""), [0, 1]);
    });
    test("a three-part range steps from the first to the second", () => {
        assert.deepEqual(selectFrames(9, "1:3:9", ""), [0, 2, 4, 6, 8]);
    });
    test("excluded frames are removed from the included ones", () => {
        assert.deepEqual(selectFrames(5, "", "2,4"), [0, 2, 4]);
    });
    test("frames out of range and unreadable intervals are ignored", () => {
        assert.deepEqual(selectFrames(3, "0,2,7,x", ""), [1]);
    });
});

describe("videoTimeline", () => {
    const frame = (timeoutMs, timeoutEnable, transitionDurationMs) => ({
        timeoutMs,
        timeoutEnable,
        transitionDurationMs
    });

    test("each frame is held for its timeout, at least one image", () => {
        const timeline = videoTimeline([frame(0, true, 0), frame(250, false, 0)], 10);
        assert.deepEqual(timeline[0], {type: "hold", frame: 0, count: 1});
        assert.deepEqual(timeline[2], {type: "hold", frame: 1, count: 3});
    });
    test("a transition has one image per time step, by progress", () => {
        const timeline = videoTimeline([frame(0, true, 0), frame(0, false, 400)], 10);
        assert.deepEqual(timeline[1], {
            type: "transition",
            from: 0,
            to: 1,
            progress: [0, 0.25, 0.5, 0.75]
        });
    });
    test("the video ends at the last frame when its timeout is off", () => {
        const timeline = videoTimeline([frame(0, true, 0), frame(0, false, 0)], 10);
        assert.equal(timeline.length, 3);
        assert.deepEqual(timeline.at(-1), {type: "hold", frame: 1, count: 1});
    });
    test("the video loops back to the first frame when the last timeout is on", () => {
        const timeline = videoTimeline([frame(0, true, 200), frame(0, true, 0)], 10);
        assert.deepEqual(timeline.at(-1), {
            type: "transition",
            from: 1,
            to: 0,
            progress: [0, 0.5]
        });
    });
});

describe("timelineImageCount", () => {
    test("counts the held images and the transition images", () => {
        const timeline = [
            {type: "hold", frame: 0, count: 3},
            {type: "transition", from: 0, to: 1, progress: [0, 0.5]},
            {type: "hold", frame: 1, count: 1}
        ];
        assert.equal(timelineImageCount(timeline), 6);
    });
});

describe("exportSettings", () => {
    test("copies the export settings and the frame timings only", () => {
        const presentation = {
            title: "not copied",
            exportToPDFPageSize: "A4",
            exportToVideoFrameRate: 25,
            frames: [{timeoutMs: 1, timeoutEnable: true, transitionDurationMs: 2, title: "x"}]
        };
        const settings = exportSettings(presentation);
        assert.equal(settings.title, undefined);
        assert.equal(settings.exportToPDFPageSize, "A4");
        assert.equal(settings.exportToVideoFrameRate, 25);
        assert.ok(Object.hasOwn(settings, "exportToPPTXSlideSize"));
        assert.deepEqual(settings.frames, [
            {timeoutMs: 1, timeoutEnable: true, transitionDurationMs: 2}
        ]);
    });
});
