import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {DisplayCommands} from "../../../src/js/player/DisplayCommands.js";
import {fakeController, fakeHost, fakePlayer, frames} from "./fakeDeck.js";

const JPEG = "data:image/jpeg;base64,AAAA";

/** Build the commands on fakes.
 *
 * @param {object} [options] - What differs from a deck that is not a preview.
 * @param {() => Promise<string>} [options.render] - What a thumbnail render gives.
 * @returns {any} - The commands, their fakes, and `state`, whose `preview` `isPreview` reads.
 */
function commandsOnFakes({render = async () => JPEG} = {}) {
    const player = fakePlayer();
    const controller = fakeController(player);
    const links = new Map();
    const renders = [];
    const state = {preview: false};
    const commands = new DisplayCommands({
        player,
        controller,
        presentation: {document: {root: {getElementById: id => links.get(id) ?? null}}},
        host: fakeHost(),
        isPreview: () => state.preview,
        renderThumbnail: (index, width) => {
            renders.push([index, width]);
            return render();
        }
    });
    return {commands, player, controller, links, renders, state};
}

describe("DisplayCommands", () => {
    test("hands each move to the controller", () => {
        const {commands, controller, player} = commandsOnFakes();
        commands.next(true);
        commands.next(false);
        commands.previous(true);
        commands.previous(false);
        commands.jumpToFrame(1, true);
        commands.jumpToFrame(0, false);
        assert.deepEqual(controller.calls, [
            ["moveToNext"],
            ["jumpToNext"],
            ["moveToPrevious"],
            ["jumpToPrevious"],
            ["moveToFrame", 1],
            ["jumpToFrame", 0]
        ]);
        assert.deepEqual(player.calls, []);
    });

    test("blank toggles the screen only when it changes it", () => {
        const {commands, controller, player} = commandsOnFakes();
        commands.blank(false);
        commands.blank(true);
        commands.blank(true);
        assert.deepEqual(controller.calls, [["toggleBlankScreen"]]);
        assert.equal(player.blankScreenIsVisible, true);
    });

    test("a preview drives the player itself", () => {
        const {commands, controller, player, state} = commandsOnFakes();
        state.preview = true;
        commands.jumpToFrame(1, false);
        commands.jumpToFrame(0, true);
        commands.blank(true);
        commands.blank(false);
        commands.next(false);
        commands.previous(true);
        assert.deepEqual(controller.calls, []);
        assert.deepEqual(player.calls, [
            ["jumpToFrame", 1],
            ["moveToFrame", 0],
            ["enableBlankScreen"],
            ["disableBlankScreen"],
            ["jumpToFrame", frames[1]],
            ["moveToFrame", frames[1]]
        ]);
    });

    test("isPreview is read on every call: a deck that becomes a preview drives the player", () => {
        const {commands, controller, player, state} = commandsOnFakes();
        commands.next(true);
        state.preview = true;
        commands.next(true);
        assert.deepEqual(controller.calls, [["moveToNext"]]);
        assert.deepEqual(player.calls, [["moveToFrame", frames[1]]]);
    });

    test("followLink clicks the link with that id", () => {
        const {commands, links} = commandsOnFakes();
        const clicks = [];
        links.set("a1", {dispatchEvent: evt => clicks.push(evt.type)});
        commands.followLink("a1");
        commands.followLink("missing");
        assert.deepEqual(clicks, ["click"]);
    });

    test("moveCamera zooms and pans the display in its own pixels", () => {
        const {commands, controller} = commandsOnFakes();
        commands.moveCamera({x: -0.1, y: 0.2, zoom: 2, atX: 0.25, atY: 0.75});
        assert.deepEqual(controller.calls, [
            ["zoom", 2, 0.25 * 1200, 0.75 * 400],
            ["translate", -0.1 * 1200, 0.2 * 400]
        ]);
    });

    test("a moveCamera that only pans, or only zooms, makes that move alone", () => {
        const {commands, controller} = commandsOnFakes();
        commands.moveCamera({x: 0.5, y: 0, zoom: 1, atX: 0, atY: 0});
        commands.moveCamera({x: 0, y: 0, zoom: 1.05, atX: 0.5, atY: 0.5});
        assert.deepEqual(controller.calls, [
            ["translate", 600, 0],
            ["zoom", 1.05, 600, 200]
        ]);
    });

    test("resetCamera moves back to the current frame", () => {
        const {commands, player, controller} = commandsOnFakes();
        commands.resetCamera();
        assert.deepEqual(player.calls, [["moveToFrame", frames[0]]]);
        assert.deepEqual(controller.calls, []);
    });

    test("a preview shows a view on its own frame, then the view, in its own pixels", () => {
        const {commands, player, controller, state} = commandsOnFakes();
        state.preview = true;
        commands.showView({offFrame: true, zoom: 1.5, x: 0.1, y: -0.2});
        assert.deepEqual(player.calls, [["jumpToFrame", frames[0]]]);
        assert.deepEqual(controller.viewport.calls, [
            ["zoom", 1.5, 0, 0],
            ["translate", 0.1 * 1200, -0.2 * 400]
        ]);
        assert.deepEqual(controller.calls, []);
    });

    test("showView outside preview mode is ignored", () => {
        const {commands, player, controller} = commandsOnFakes();
        commands.showView({offFrame: true, zoom: 1.5, x: 0.1, y: -0.2});
        assert.deepEqual(player.calls, []);
        assert.deepEqual(controller.viewport.calls, []);
    });

    test("thumbnail renders the frame at that width", async () => {
        const {commands, renders} = commandsOnFakes();
        assert.equal(await commands.thumbnail(1, 320), JPEG);
        assert.deepEqual(renders, [[1, 320]]);
    });

    test("a render that rejects gives an empty url", async t => {
        const warn = t.mock.method(console, "warn", () => {});
        const {commands} = commandsOnFakes({
            render: async () => {
                throw new Error("tainted");
            }
        });
        assert.equal(await commands.thumbnail(1, 320), "");
        assert.equal(warn.mock.callCount(), 1);
    });
});
