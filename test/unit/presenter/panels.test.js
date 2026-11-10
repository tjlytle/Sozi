import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {readPanel, urlPanelRender} from "../../../src/js/presenter/panels.js";

const render = () => () => {};

/** Stand-in for the element a panel draws into; it records what is appended.
 *
 * @returns {any} - The fake element.
 */
function fakeElement() {
    const appended = [];
    return {
        appended,
        textContent: "",
        append(child) {
            appended.push(child);
        },
        ownerDocument: {
            createElement: tagName => ({
                tagName,
                remove() {
                    this.removed = true;
                }
            })
        }
    };
}

describe("panels", () => {
    test("every refusal names its field", () => {
        const refused = /** @type {any[][]} */ ([
            [{title: "T", render}, /id/],
            [{id: "", title: "T", render}, /id/],
            [{id: "a", render}, /title/],
            [{id: "a", title: "", render}, /title/],
            [{id: "a", title: "T"}, /render.*url/],
            [{id: "a", title: "T", render, url: "x.html"}, /render.*url/],
            [{id: "a", title: "T", render: "nope"}, /render/],
            [{id: "a", title: "T", url: 3}, /url/],
            [{id: "a", title: "T", render, icon: 3}, /icon/],
            [null, /id/]
        ]);
        for (const [def, message] of refused) {
            assert.throws(() => readPanel(def), {name: "TypeError", message});
        }
    });

    test("a panel without defaults is a tab behind Notes, and takes an icon from its title", () => {
        const {id, title, icon, position, inactive} = readPanel({id: "a", title: "Add", render});
        assert.deepEqual([id, title, icon], ["a", "Add", "A"]);
        assert.deepEqual(position, {referencePanel: "notes", direction: "within"});
        assert.equal(inactive, true);
    });

    test("a panel's own defaults and icon are kept", () => {
        const position = {referencePanel: "current", direction: "right"};
        const panel = readPanel({
            id: "a",
            title: "Add",
            icon: "★",
            render,
            defaults: {position, initialHeight: 50}
        });
        assert.equal(panel.icon, "★");
        assert.deepEqual(panel.position, position);
        assert.equal(panel.initialHeight, 50);
        assert.equal(panel.inactive, undefined);
    });

    test("a render that returns nothing still gives a cleanup", () => {
        const panel = readPanel({id: "a", title: "T", render: () => undefined});
        assert.equal(typeof panel.render(fakeElement()), "function");
    });

    test("a render that throws says so in its panel and does not stop the others", t => {
        t.mock.method(console, "error", () => {});
        const panel = readPanel({
            id: "a",
            title: "Add",
            render() {
                throw new Error("boom");
            }
        });
        const element = fakeElement();
        const cleanup = panel.render(element);
        assert.match(element.textContent, /Add.*boom/);
        assert.equal(typeof cleanup, "function");
    });

    test("a url panel draws an iframe and removes it", () => {
        const panel = readPanel({id: "a", title: "Page", url: "page.html"});
        const element = fakeElement();
        const cleanup = panel.render(element);
        const [iframe] = element.appended;
        assert.equal(iframe.tagName, "iframe");
        assert.equal(iframe.src, "page.html");
        assert.equal(iframe.title, "Page");
        cleanup();
        assert.equal(iframe.removed, true);
    });

    test("http, https and relative urls are accepted", () => {
        for (const url of ["http://a.example/", "https://a.example/x", "x/y.html", "/z", "//a/b"]) {
            assert.equal(typeof urlPanelRender(url, "T"), "function", url);
        }
    });

    test("any other scheme is refused", () => {
        for (const url of [
            "javascript:alert(1)",
            " JavaScript:alert(1)",
            "java\nscript:alert(1)",
            "data:text/html,x",
            "file:///etc/passwd"
        ]) {
            assert.throws(() => urlPanelRender(url, "T"), {name: "TypeError", message: /url/}, url);
        }
    });
});
