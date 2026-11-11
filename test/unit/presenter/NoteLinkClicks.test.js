import {test} from "node:test";
import assert from "node:assert/strict";
import {NoteLinkClicks} from "../../../src/js/presenter/NoteLinkClicks.js";

/** A body with a real event registry and a small link attribute fake.
 * @param {string} href - The link address.
 * @returns {object} The link and body fakes.
 */
function fixture(href) {
    const attributes = new Map([["href", href]]);
    const classes = new Set();
    const link = {
        getAttribute: name => attributes.get(name),
        setAttribute: (name, value) => attributes.set(name, value),
        classList: {add: name => classes.add(name)}
    };
    const listeners = new Map();
    const body = {
        addEventListener: (name, listener) => listeners.set(name, listener),
        removeEventListener: (name, listener) => {
            assert.equal(listeners.get(name), listener);
            listeners.delete(name);
        },
        querySelectorAll: () => [link]
    };
    const jumps = [];
    let frames = [{id: "frame2", index: 1, title: "Two", notes: ""}];
    // Cast: the fake implements only the DOM methods this class needs.
    const element = /** @type {HTMLElement} */ (/** @type {unknown} */ (body));
    const links = new NoteLinkClicks(element, {
        frames: () => frames,
        jumpToFrame: (...args) => jumps.push(args)
    });
    return {
        attributes,
        classes,
        body,
        links,
        jumps,
        listeners,
        setFrames: value => {
            frames = value;
        },
        click: (shiftKey = false) => {
            let prevented = false;
            listeners.get("click")?.({
                target: {closest: () => link},
                shiftKey,
                preventDefault: () => {
                    prevented = true;
                }
            });
            return prevented;
        }
    };
}

test("mark annotates missing frames", () => {
    const f = fixture("#missing");
    f.links.mark(f.body);
    assert.ok(f.classes.has("sozi-notes__link--broken"));
    assert.equal(f.attributes.get("aria-disabled"), "true");
    assert.equal(f.attributes.get("title"), 'No frame "missing" in this deck');
    assert.equal(f.click(), true);
    assert.deepEqual(f.jumps, []);
    f.links.dispose();
});

test("external links open safely in a new tab and clicks are left alone", () => {
    const f = fixture("https://example.org/");
    f.links.mark(f.body);
    assert.equal(f.attributes.get("target"), "_blank");
    assert.equal(f.attributes.get("rel"), "noopener noreferrer");
    assert.equal(f.click(), false);
    assert.deepEqual(f.jumps, []);
    f.links.dispose();
});

for (const shift of [false, true]) {
    test(`frame click prevents navigation and transition is ${!shift}`, () => {
        const f = fixture("#frame2");
        assert.equal(f.click(shift), true);
        assert.deepEqual(f.jumps, [[1, !shift]]);
        f.links.dispose();
        assert.equal(f.listeners.size, 0);
        assert.equal(f.click(), false);
        assert.equal(f.jumps.length, 1);
    });
}

test("links use the latest frames from the getter", () => {
    const f = fixture("#frame2");
    f.setFrames([{id: "frame2", index: 7, title: "Two", notes: ""}]);
    f.click();
    assert.deepEqual(f.jumps, [[7, true]]);
    f.links.dispose();
});
