import {test} from "node:test";
import assert from "node:assert/strict";
import {exampleFiles} from "../../features/support/docExample.js";

const FENCE = "```";

test("two blocks that name a file give two files", () => {
    const markdown = [
        `${FENCE}js a.js`,
        "one();",
        FENCE,
        "",
        `${FENCE}css b.css`,
        "p {}",
        FENCE,
        ""
    ].join("\n");
    assert.deepEqual(exampleFiles(markdown).files, {"a.js": "one();\n", "b.css": "p {}\n"});
});

test("a block with no file name is skipped", () => {
    const markdown = [`${FENCE}js`, "skipped();", FENCE, `${FENCE}sh`, "sozi", FENCE].join("\n");
    assert.deepEqual(exampleFiles(markdown), {files: {}, presentation: {}});
});

test("the deck.sozi.json block is parsed into the presentation", () => {
    const keys = {customFiles: [{path: "a.js", target: "presenter"}]};
    const markdown = [`${FENCE}json deck.sozi.json`, JSON.stringify(keys), FENCE].join("\n");
    const example = exampleFiles(markdown);
    assert.deepEqual(example.presentation, keys);
    assert.deepEqual(example.files, {});
});

test("a malformed deck.sozi.json block throws, naming the block", () => {
    const markdown = [`${FENCE}json deck.sozi.json`, "{customFiles: [", FENCE].join("\n");
    assert.throws(() => exampleFiles(markdown), /deck\.sozi\.json/);
});
