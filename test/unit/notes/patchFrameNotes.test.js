import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {patchFrameNotes} from "../../../src/js/notes/patchFrameNotes.js";

/** Patch a file's text and check the result still says what the patch meant.
 *
 * @param {string} text - The file's text.
 * @param {Array<[number, string]>} notes - The frame indexes and their new notes.
 * @returns {string} - The patched text.
 */
function patched(text, notes) {
    const result = patchFrameNotes(text, new Map(notes));
    const frames = JSON.parse(result).frames;
    for (const [index, html] of notes) {
        assert.equal(frames[index].notes, html);
    }
    return result;
}

describe("patchFrameNotes", () => {
    test("replaces only the value, in any formatting", () => {
        const text = `{\r\n\t"frames" : [\r\n\t\t{ "frameId":"a",  "notes"\t:\t"old" , "x":1 }\r\n\t]\r\n}\r\n`;
        assert.equal(
            patched(text, [[0, "new"]]),
            `{\r\n\t"frames" : [\r\n\t\t{ "frameId":"a",  "notes"\t:\t"new" , "x":1 }\r\n\t]\r\n}\r\n`
        );
    });

    test("leaves the other frames as they are, whatever they omit", () => {
        const text = `{"frames":[{"frameId":"a"},{"notes":"b"},  {"notes":"c"}]}`;
        assert.equal(
            patched(text, [[1, "new"]]),
            `{"frames":[{"frameId":"a"},{"notes":"new"},  {"notes":"c"}]}`
        );
    });

    test("patches several frames, in whichever order they are given", () => {
        const text = `{"frames":[{"notes":"a"},{"notes":"b"},{"notes":"c"}]}`;
        assert.equal(
            patched(text, [
                [2, "the third"],
                [0, "the first, which is longer than it was"]
            ]),
            `{"frames":[{"notes":"the first, which is longer than it was"},{"notes":"b"},{"notes":"the third"}]}`
        );
    });

    test("encodes the new notes as a JSON string", () => {
        const text = `{"frames":[{"notes":""}]}`;
        assert.equal(
            patched(text, [[0, `<a href="x">\\</a>\n`]]),
            `{"frames":[{"notes":"<a href=\\"x\\">\\\\</a>\\n"}]}`
        );
    });

    test("adds a missing field in the style of the frame's last field", () => {
        assert.equal(
            patched(`{"frames": [\n    {\n      "frameId" : "a",\n      "x" : 1\n    }\n]}`, [
                [0, "new"]
            ]),
            `{"frames": [\n    {\n      "frameId" : "a",\n      "x" : 1,\n      "notes" : "new"\n    }\n]}`
        );
        assert.equal(
            patched(`{"frames":[{"frameId":"a"}]}`, [[0, "new"]]),
            `{"frames":[{"frameId":"a","notes":"new"}]}`
        );
    });

    test("adds the field to an empty frame", () => {
        assert.equal(patched(`{"frames":[ {} ]}`, [[0, "new"]]), `{"frames":[ {"notes": "new"} ]}`);
    });

    test("is not fooled by what strings and other fields hold", () => {
        const text = `{
            "note\\"s": "\\"frames\\": [{\\"notes\\": \\"no\\"}]",
            "other": {"frames": [{"notes": "nested"}], "list": [1, [2, {"a": null}], "]}"]},
            "frames": [
                {"meta": {"notes": "inner"}, "title": "{[\\\\", "n": -1.5e3, "t": true, "notes": "old"}
            ],
            "after": false
        }`;
        assert.equal(patched(text, [[0, "new"]]), text.replace(`"old"`, `"new"`));
    });

    test("reads an escaped key as its text, and a repeated key as JSON.parse does", () => {
        assert.equal(
            patched(`{"fram\\u0065s":[{"not\\u0065s":"old"}]}`, [[0, "new"]]),
            `{"fram\\u0065s":[{"not\\u0065s":"new"}]}`
        );
        assert.equal(
            patched(`{"frames":[{"notes":"first","notes":"last"}]}`, [[0, "new"]]),
            `{"frames":[{"notes":"first","notes":"new"}]}`
        );
    });

    test("replaces a value that is not a string", () => {
        assert.equal(
            patched(`{"frames":[{"notes":null,"x":1}]}`, [[0, "new"]]),
            `{"frames":[{"notes":"new","x":1}]}`
        );
    });

    test("with nothing to patch, gives the text back", () => {
        const text = `{ "frames" : [ {"notes":"a"} ] }\n`;
        assert.equal(patched(text, []), text);
    });
});
