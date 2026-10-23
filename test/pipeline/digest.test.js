import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {spawnSync} from "node:child_process";
import path from "node:path";
import {
    pageRequest,
    entryBlocks,
    finishBlocks,
    notion,
    main,
    runs,
    pageId
} from "../../bin/digest.js";

const script = path.resolve("bin/digest.js");
const ISSUE = "https://github.com/tjlytle/Sozi/issues/25";
const ID = "40224c434db480e5878de8c853a800c4";
const PAGE = "1234567890abcdef1234567890abcdef";

/** A fake fetch that records its calls and answers with a JSON body.
 *
 * @param {object} [reply] - The parsed body to return.
 * @param {{ok?: boolean, status?: number, text?: string}} [options] - Override the reply.
 * @returns {{calls: {url: string, init: any}[], fetch: any}} - The recorder and the function.
 */
function fake(reply = {}, {ok = true, status = 200, text = ""} = {}) {
    const calls = [];
    return {
        calls,
        fetch: async (/** @type {string} */ url, /** @type {any} */ init) => {
            calls.push({url, init});
            return {ok, status, json: async () => reply, text: async () => text};
        }
    };
}

/** Run main with a fake fetch and captured output.
 *
 * @param {string[]} argv - The arguments.
 * @param {Record<string, string>} env - The environment.
 * @param {object} [reply] - The fake reply.
 * @returns {Promise<{code: number, out: string, err: string, calls: {url: string, init: any}[]}>} - What happened.
 */
async function run(argv, env, reply) {
    const {calls, fetch} = fake(reply);
    let out = "";
    let err = "";
    const code = await main(argv, {
        env,
        fetch,
        out: s => (out += s),
        err: s => (err += s)
    });
    return {code, out, err, calls};
}

describe("digest", () => {
    test("a run page under the parent", () => {
        const b = pageRequest({title: "Factory run 2026-10-21 19:02", parent: "abc"});
        assert.equal(b.parent.page_id, "abc");
        assert.equal(b.properties.title.title[0].text.content, "Factory run 2026-10-21 19:02");
        assert.equal(b.children[0].type, "paragraph");
    });
    test("an entry is a to-do with a link to the issue and an optional image", () => {
        const blocks = entryBlocks({
            issue: 25,
            text: "Resize the window; previews follow",
            url: ISSUE,
            image: "https://ev/x.png"
        });
        assert.equal(blocks[0].type, "to_do");
        assert.equal(blocks[0].to_do.checked, false);
        assert.equal(blocks[0].to_do.rich_text[0].text.content, "#25");
        assert.equal(blocks[0].to_do.rich_text[0].text.link.url, ISSUE);
        assert.equal(
            blocks[0].to_do.rich_text[1].text.content,
            " Resize the window; previews follow"
        );
        assert.equal(blocks[1].type, "image");
        assert.equal(blocks[1].image.external.url, "https://ev/x.png");
        assert.equal(entryBlocks({issue: 25, text: "x", url: "u"}).length, 1);
    });
    test("finish adds the summary and the build links", () => {
        const blocks = finishBlocks({
            summary: "3 merged, 1 triage",
            build: "https://b",
            presenter: "https://p"
        });
        assert.equal(blocks[0].type, "callout");
        assert.deepEqual(
            blocks.slice(1).map(b => b.bookmark.url),
            ["https://b", "https://p"]
        );
        assert.deepEqual(
            finishBlocks({summary: "s", presenter: "https://p"})
                .slice(1)
                .map(b => b.bookmark.url),
            ["https://p"]
        );
    });

    test("notion sends the headers and the JSON body and returns the reply", async () => {
        const {calls, fetch} = fake({id: "x"});
        const reply = await notion("POST", "/pages", {a: 1}, {token: "tok", fetch});
        assert.deepEqual(reply, {id: "x"});
        assert.equal(calls[0].url, "https://api.notion.com/v1/pages");
        assert.equal(calls[0].init.method, "POST");
        assert.equal(calls[0].init.headers.Authorization, "Bearer tok");
        assert.equal(calls[0].init.headers["Notion-Version"], "2022-06-28");
        assert.equal(calls[0].init.headers["Content-Type"], "application/json");
        assert.deepEqual(JSON.parse(calls[0].init.body), {a: 1});
    });
    test("a non-ok reply throws with the status and without the token", async () => {
        const {fetch} = fake({}, {ok: false, status: 401, text: "bad token sekrit"});
        await assert.rejects(
            notion("GET", "/x", undefined, {token: "sekrit", fetch}),
            (/** @type {Error} */ error) =>
                /401/.test(error.message) && !error.message.includes("sekrit")
        );
    });

    test("start creates the page and prints its id", async () => {
        const r = await run(
            ["start", "--title", "T"],
            {NOTION_TOKEN: "t", PIPELINE_NOTION_PARENT: ID},
            {id: "new-id"}
        );
        assert.equal(r.code, 0);
        assert.equal(r.out.trim(), "new-id");
        assert.equal(r.calls[0].url, "https://api.notion.com/v1/pages");
        assert.deepEqual(JSON.parse(r.calls[0].init.body), pageRequest({title: "T", parent: ID}));
    });
    test("add patches the entry blocks onto the page", async () => {
        const r = await run(
            ["add", "--issue", "25", "--text", "Do it", "--url", ISSUE, "--image", "https://i"],
            {NOTION_TOKEN: "t", PIPELINE_NOTION_PAGE: PAGE}
        );
        assert.equal(r.code, 0);
        assert.equal(r.out, "");
        assert.equal(r.calls[0].init.method, "PATCH");
        assert.equal(r.calls[0].url, `https://api.notion.com/v1/blocks/${PAGE}/children`);
        assert.deepEqual(JSON.parse(r.calls[0].init.body), {
            children: entryBlocks({issue: "25", text: "Do it", url: ISSUE, image: "https://i"})
        });
    });
    test("finish patches the summary blocks onto the page", async () => {
        const r = await run(
            ["finish", "--summary", "done", "--build", "https://b", "--page", PAGE],
            {NOTION_TOKEN: "t"}
        );
        assert.equal(r.code, 0);
        assert.equal(r.calls[0].url, `https://api.notion.com/v1/blocks/${PAGE}/children`);
        assert.deepEqual(JSON.parse(r.calls[0].init.body), {
            children: finishBlocks({summary: "done", build: "https://b"})
        });
    });
    test("a missing token or option exits 1 naming it", async () => {
        const noToken = await run(["start", "--title", "T", "--parent", ID], {});
        assert.equal(noToken.code, 1);
        assert.match(noToken.err, /NOTION_TOKEN/);
        const noTitle = await run(["start", "--parent", ID], {NOTION_TOKEN: "t"});
        assert.equal(noTitle.code, 1);
        assert.match(noTitle.err, /--title/);
        assert.equal(noTitle.calls.length, 0);
        const noPage = await run(["finish", "--summary", "s"], {NOTION_TOKEN: "t"});
        assert.equal(noPage.code, 1);
        assert.match(noPage.err, /PIPELINE_NOTION_PAGE|--page/);
    });
    test("an unknown subcommand prints usage and exits 2", async () => {
        const r = await run(["bogus"], {NOTION_TOKEN: "t"});
        assert.equal(r.code, 2);
        assert.match(r.err, /usage/);
    });
    test("long text splits into runs of at most 2000 characters, the first carrying the link", () => {
        const text = "x".repeat(4500);
        const parts = runs(text, {link: "https://l"});
        assert.equal(parts.length, 3);
        assert.ok(parts.every(r => r.text.content.length <= 2000));
        assert.equal(parts.map(r => r.text.content).join(""), text);
        assert.equal(parts[0].text.link.url, "https://l");
        assert.equal(parts[1].text.link, undefined);
    });
    test("a 2500 character --text is split on the wire", async () => {
        const text = "y".repeat(2500);
        const r = await run(["add", "--issue", "1", "--text", text, "--url", ISSUE], {
            NOTION_TOKEN: "t",
            PIPELINE_NOTION_PAGE: PAGE
        });
        const rich = JSON.parse(r.calls[0].init.body).children[0].to_do.rich_text;
        assert.ok(rich.every((/** @type {any} */ x) => x.text.content.length <= 2000));
        assert.equal(rich.map((/** @type {any} */ x) => x.text.content).join(""), `#1 ${text}`);
    });
    test("start with no page id in the reply exits 1", async () => {
        const r = await run(["start", "--title", "T", "--parent", ID], {NOTION_TOKEN: "t"}, {});
        assert.equal(r.code, 1);
        assert.match(r.err, /no page id/);
        assert.equal(r.out, "");
    });
    test("add sends exactly this JSON", async () => {
        const r = await run(
            ["add", "--issue", "25", "--text", "Do it", "--url", ISSUE, "--image", "https://i"],
            {NOTION_TOKEN: "t", PIPELINE_NOTION_PAGE: PAGE}
        );
        assert.deepEqual(JSON.parse(r.calls[0].init.body), {
            children: [
                {
                    object: "block",
                    type: "to_do",
                    to_do: {
                        rich_text: [
                            {text: {content: "#25", link: {url: ISSUE}}},
                            {text: {content: " Do it"}}
                        ],
                        checked: false
                    }
                },
                {
                    object: "block",
                    type: "image",
                    image: {type: "external", external: {url: "https://i"}}
                }
            ]
        });
    });
    test("finish sends exactly this JSON", async () => {
        const r = await run(
            [
                "finish",
                "--summary",
                "done",
                "--build",
                "https://b",
                "--presenter",
                "https://p",
                "--page",
                PAGE
            ],
            {NOTION_TOKEN: "t"}
        );
        assert.deepEqual(JSON.parse(r.calls[0].init.body), {
            children: [
                {
                    object: "block",
                    type: "callout",
                    callout: {rich_text: [{text: {content: "done"}}], icon: {emoji: "\u2705"}}
                },
                {object: "block", type: "bookmark", bookmark: {url: "https://b"}},
                {object: "block", type: "bookmark", bookmark: {url: "https://p"}}
            ]
        });
    });
    test("empty --image, --build and --presenter add no block", async () => {
        const add = await run(["add", "--issue", "1", "--text", "x", "--url", "u", "--image", ""], {
            NOTION_TOKEN: "t",
            PIPELINE_NOTION_PAGE: PAGE
        });
        assert.equal(JSON.parse(add.calls[0].init.body).children.length, 1);
        const fin = await run(["finish", "--summary", "s", "--build", "", "--presenter", ""], {
            NOTION_TOKEN: "t",
            PIPELINE_NOTION_PAGE: PAGE
        });
        assert.equal(JSON.parse(fin.calls[0].init.body).children.length, 1);
    });
    test("a non-numeric --issue or a page id with no 32 hex digits exits 1", async () => {
        const env = {NOTION_TOKEN: "t", PIPELINE_NOTION_PAGE: PAGE};
        const issue = await run(["add", "--issue", "2a", "--text", "x", "--url", "u"], env);
        assert.equal(issue.code, 1);
        assert.match(issue.err, /--issue/);
        for (const page of ["a/b", "a?b", "Sozi"]) {
            const r = await run(["finish", "--summary", "s", "--page", page], {NOTION_TOKEN: "t"});
            assert.equal(r.code, 1);
            assert.match(r.err, /--page or PIPELINE_NOTION_PAGE has no Notion page id/);
            assert.equal(r.calls.length, 0);
        }
    });
    test("pageId takes the id from a URL, a slug, the bare hex or a dashed UUID", () => {
        for (const value of [
            `https://www.notion.so/Sozi-${ID}`,
            `Sozi-${ID}`,
            ID,
            "40224c43-4db4-80e5-878d-e8c853a800c4"
        ]) {
            assert.equal(pageId(value, "--parent"), ID, value);
        }
    });
    test("pageId ignores the query and fragment, a hex title and upper case", () => {
        assert.equal(pageId(`https://www.notion.so/Sozi-${ID}?v=${PAGE}`, "x"), ID);
        assert.equal(pageId(`https://www.notion.so/Sozi-${ID}?pvs=4`, "x"), ID);
        assert.equal(pageId(`https://www.notion.so/Sozi-${ID}#block`, "x"), ID);
        assert.equal(pageId(`Deadbeef-${ID}`, "x"), ID);
        assert.equal(pageId(ID.toUpperCase(), "x"), ID);
    });
    test("pageId throws naming the setting when there is no id", () => {
        for (const value of ["Sozi", ID.slice(1)]) {
            assert.throws(() => pageId(value, "--parent or PIPELINE_NOTION_PARENT"), {
                message: `--parent or PIPELINE_NOTION_PARENT has no Notion page id: ${JSON.stringify(value)}`
            });
        }
    });
    test("start sends the bare id of a slug parent", async () => {
        const r = await run(
            ["start", "--title", "T"],
            {NOTION_TOKEN: "t", PIPELINE_NOTION_PARENT: `Sozi-${ID}`},
            {id: "new-id"}
        );
        assert.equal(r.code, 0);
        assert.equal(JSON.parse(r.calls[0].init.body).parent.page_id, ID);
    });
    test("finish patches the id of a page URL", async () => {
        const r = await run(
            ["finish", "--summary", "s", "--page", `https://www.notion.so/Run-${PAGE}?pvs=4`],
            {NOTION_TOKEN: "t"}
        );
        assert.equal(r.code, 0);
        assert.equal(r.calls[0].url, `https://api.notion.com/v1/blocks/${PAGE}/children`);
    });
    test("start with a parent that has no id exits 1 before any request", async () => {
        const r = await run(["start", "--title", "T", "--parent", "Sozi"], {NOTION_TOKEN: "t"});
        assert.equal(r.code, 1);
        assert.match(r.err, /--parent or PIPELINE_NOTION_PARENT has no Notion page id: "Sozi"/);
        assert.equal(r.calls.length, 0);
    });
    test("the script exits 2 on an unknown subcommand", () => {
        const r = spawnSync(process.execPath, [script, "bogus"], {
            encoding: "utf8",
            env: {PATH: process.env.PATH, NODE_NO_WARNINGS: "1"}
        });
        assert.equal(r.status, 2);
        assert.match(r.stderr, /usage/);
    });
});
