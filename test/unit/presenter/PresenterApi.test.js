import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {EventEmitter} from "node:events";
import {DisplayMirror, DisplayMirrorEvents} from "../../../src/js/presenter/DisplayMirror.js";
import {PresenterApi, PresenterEvents} from "../../../src/js/presenter/PresenterApi.js";
import {TransportEvents, TransportStatus} from "../../../src/js/protocol/LocalTransport.js";
import {TransportSet} from "../../../src/js/protocol/TransportSet.js";
import {
    Roles,
    blankMessage,
    customMessage,
    frameChangeMessage,
    helloMessage,
    jumpToFrameMessage,
    nextMessage,
    previousMessage
} from "../../../src/js/protocol/messages.js";

const FRAME = {index: 1, id: "f2", title: "Two", notes: "second"};
const VIEWPORT = {width: 800, height: 600, pixelRatio: 2};
const panel = {id: "a", title: "A", render: () => () => {}};

/** Stand-in for a transport: it records what is sent and delivers what a test posts.
 *
 * @returns {any} - The fake transport.
 */
function fakeTransport() {
    const transport = /** @type {any} */ (new EventEmitter());
    return Object.assign(transport, {
        status: TransportStatus.connected,
        sent: [],
        handlers: new Set(),
        send(message) {
            transport.sent.push(message);
            return true;
        },
        onMessage(handler) {
            transport.handlers.add(handler);
            return () => transport.handlers.delete(handler);
        },
        deliver(data) {
            for (const handler of transport.handlers) {
                handler(data);
            }
        },
        dispose() {}
    });
}

/** Stand-in for the workspace: it records the panels added.
 *
 * @returns {any} - The fake workspace.
 */
function fakeWorkspace() {
    return {
        added: [],
        addPanel(spec) {
            this.added.push(spec.id);
        }
    };
}

/** An API on a real mirror and set, mounted on a fake workspace, with one transport.
 *
 * @returns {any} - The API and its parts.
 */
function mountedApi() {
    const mirror = new DisplayMirror();
    const transports = new TransportSet();
    const api = new PresenterApi({mirror, transports});
    const workspace = fakeWorkspace();
    api.mount(workspace);
    const transport = fakeTransport();
    api.registerTransport(transport);
    transport.sent.length = 0;
    return {api, mirror, transports, workspace, transport};
}

describe("PresenterApi", () => {
    test("state mirrors what any transport reports, for a panel that comes late", () => {
        const {api, transport} = mountedApi();
        assert.deepEqual(api.state, {
            frame: null,
            frames: [],
            frameCount: 0,
            deckId: "",
            version: "",
            viewport: null,
            blank: false,
            status: TransportStatus.connected
        });
        transport.deliver(
            helloMessage(Roles.display, {
                deckId: "d",
                version: "v1",
                frameCount: 2,
                viewport: VIEWPORT,
                frame: FRAME,
                frames: [FRAME],
                blank: true
            })
        );
        assert.deepEqual(api.state, {
            frame: FRAME,
            frames: [FRAME],
            frameCount: 2,
            deckId: "d",
            version: "v1",
            viewport: VIEWPORT,
            blank: true,
            status: TransportStatus.connected
        });
        const other = fakeTransport();
        api.registerTransport(other);
        other.deliver(blankMessage(false));
        assert.equal(api.state.blank, false);
    });

    test("frame changes, sizes and status are events, and every message is one too", () => {
        const {api, transport} = mountedApi();
        const heard = [];
        api.on(PresenterEvents.frameChange, frame => heard.push(["frame", frame]));
        api.on(PresenterEvents.viewport, viewport => heard.push(["viewport", viewport]));
        api.on(PresenterEvents.status, status => heard.push(["status", status]));
        api.on(PresenterEvents.message, message => heard.push(["message", message.name]));

        transport.deliver(frameChangeMessage(FRAME));
        transport.deliver({name: "viewport", ...VIEWPORT});
        transport.deliver(customMessage("pong", {}));
        transport.status = TransportStatus.closed;
        transport.emit(TransportEvents.statusChange, TransportStatus.closed);

        assert.deepEqual(heard, [
            ["frame", FRAME],
            ["message", "frameChange"],
            ["viewport", VIEWPORT],
            ["message", "viewport"],
            ["message", "custom"],
            ["status", TransportStatus.closed]
        ]);
    });

    test("a malformed message changes nothing and reaches no listener", () => {
        const {api, transport} = mountedApi();
        let heard = 0;
        api.on(PresenterEvents.message, () => heard++);
        transport.deliver({name: "frameChange", index: "one"});
        transport.deliver({name: "nothing"});
        assert.equal(heard, 0);
        assert.equal(api.state.frame, null);
    });

    test("off stops a handler, and an unknown event is refused", () => {
        const {api, transport} = mountedApi();
        let heard = 0;
        const handler = () => heard++;
        api.on(PresenterEvents.message, handler);
        api.off(PresenterEvents.message, handler);
        transport.deliver(customMessage("x", 1));
        assert.equal(heard, 0);
        assert.throws(() => api.on("nothing", handler), {name: "TypeError", message: /nothing/});
    });

    test("display.jumpToFrame takes the transition as its second argument", () => {
        const {api, transport} = mountedApi();
        api.display.jumpToFrame(1, false);
        assert.deepEqual(transport.sent, [jumpToFrameMessage(1, false)]);
    });

    test("display builds protocol messages and is frozen", () => {
        const {api, transport} = mountedApi();
        api.display.jumpToFrame(1);
        api.display.next();
        api.display.previous();
        api.display.blank(true);
        api.display.send("ping", {a: 1});
        assert.deepEqual(transport.sent, [
            jumpToFrameMessage(1),
            nextMessage(),
            previousMessage(),
            blankMessage(true),
            customMessage("ping", {a: 1})
        ]);
        assert.equal(Object.isFrozen(api.display), true);
    });

    test("commands go to the primary alone, the transport added last", () => {
        const {api, transport} = mountedApi();
        const added = fakeTransport();
        api.registerTransport(added);
        added.sent.length = 0;
        api.display.next();
        assert.deepEqual(transport.sent, []);
        assert.deepEqual(added.sent, [nextMessage()]);
    });

    test("a transport registered is greeted, so that the display answers on it", () => {
        const {api} = mountedApi();
        const added = fakeTransport();
        api.registerTransport(added);
        assert.deepEqual(added.sent, [helloMessage(Roles.surface)]);
    });

    test("panels, transports and commands wait for mount, in the order they came", () => {
        const transports = new TransportSet();
        const api = new PresenterApi({mirror: new DisplayMirror(), transports});
        const added = fakeTransport();
        api.registerPanel(panel);
        api.registerTransport(added);
        api.display.next();
        api.registerPanel({...panel, id: "b"});
        assert.deepEqual(added.sent, []);

        const workspace = fakeWorkspace();
        const first = fakeTransport();
        transports.add(first);
        api.mount(workspace);
        assert.deepEqual(workspace.added, ["a", "b"]);
        assert.deepEqual(added.sent, [helloMessage(Roles.surface), nextMessage()]);
        assert.deepEqual(first.sent, []);

        api.registerPanel({...panel, id: "c"});
        assert.deepEqual(workspace.added, ["a", "b", "c"]);
    });

    test("a bad panel and a second panel with an id are refused at once", () => {
        const {api} = mountedApi();
        assert.throws(() => api.registerPanel({id: "a"}), {name: "TypeError"});
        api.registerPanel(panel);
        assert.throws(() => api.registerPanel(panel), {name: "TypeError", message: /"a"/});
    });

    test("link is null on the local page", () => {
        assert.equal(mountedApi().api.link, null);
    });

    test("link is frozen once set, and can be set only once", () => {
        const {api} = mountedApi();
        api.link = {deck: "https://a.example/d.sozi.html", session: "s1", params: {key: "k"}};
        assert.equal(api.link.session, "s1");
        assert.equal(api.link.params.key, "k");
        assert.throws(() => (api.link.session = "s2"), TypeError);
        assert.throws(() => (api.link.params.key = "other"), TypeError);
        assert.throws(() => (api.link = {deck: "", session: "", params: {}}), TypeError);
        assert.equal(api.link.session, "s1");
    });

    test("dispose removes every listener it added", () => {
        const {api, mirror, transports, transport} = mountedApi();
        api.on(PresenterEvents.message, () => assert.fail("heard after dispose"));
        api.dispose();
        assert.equal(mirror.listenerCount(DisplayMirrorEvents.change), 0);
        assert.equal(transports.listenerCount(TransportEvents.statusChange), 0);
        transport.deliver(customMessage("x", 1));
        assert.equal(api.state.frame, null);
    });
});
