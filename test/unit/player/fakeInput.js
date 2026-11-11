/** Fakes for the player's mouse and key tests: an event target, a mouse event and a controller
 * that records what the mouse asks of it.
 *
 * @module
 */

/** Stand-in for an element, the page or the window: it keeps its listeners.
 *
 * @returns {any} - The fake; `fire(type, evt)` hands an event to its listeners.
 */
export function fakeTarget() {
    const listeners = new Map();
    return {
        addEventListener(type, listener) {
            listeners.set(type, [...(listeners.get(type) ?? []), listener]);
        },
        removeEventListener(type, listener) {
            listeners.set(
                type,
                (listeners.get(type) ?? []).filter(l => l !== listener)
            );
        },
        count() {
            return [...listeners.values()].reduce((sum, list) => sum + list.length, 0);
        },
        types() {
            return [...listeners.keys()].filter(type => listeners.get(type).length).sort();
        },
        fire(type, evt) {
            for (const listener of listeners.get(type) ?? []) {
                listener(evt);
            }
            return evt;
        }
    };
}

/** Stand-in for the deck's SVG root, in a document whose root element is `page`.
 *
 * @returns {any} - The fake root; `root.page` is the document's root element.
 */
export function fakeRoot() {
    const root = fakeTarget();
    root.page = fakeTarget();
    root.ownerDocument = {
        documentElement: root.page,
        createElement: () => ({onwheel: null})
    };
    return root;
}

/** A mouse event that records whether it was stopped.
 *
 * @param {object} [fields] - The button, the position and the modifier keys.
 * @returns {any} - The fake event; `stopped` and `prevented` tell what the handler did.
 */
export function mouseEvent(fields = {}) {
    return {
        button: 0,
        clientX: 0,
        clientY: 0,
        altKey: false,
        shiftKey: false,
        ctrlKey: false,
        prevented: false,
        stopped: false,
        preventDefault() {
            this.prevented = true;
        },
        stopPropagation() {
            this.stopped = true;
        },
        ...fields
    };
}

/** Stand-in for a controller: it records its actions and the events it emits.
 *
 * The viewport is at (10, 20) in the window and 400 by 200 pixels, so its centre is at
 * (210, 120) in client coordinates.
 *
 * @param {object} [options] - `editMode`, `dragMode` and the presentation's mouse settings.
 * @returns {any} - The fake; `calls` lists each action and event with its arguments.
 */
export function fakeMouseController(options = {}) {
    const {editMode = false, dragMode = "translate", ...settings} = /** @type {any} */ (options);
    const calls = [];
    const record =
        name =>
        (...args) =>
            calls.push([name, ...args]);
    return {
        calls,
        editMode,
        player: {pause: record("pause")},
        presentation: {
            enableMouseTranslation: true,
            enableMouseZoom: true,
            enableMouseRotation: true,
            enableMouseNavigation: true,
            ...settings
        },
        viewport: {
            x: 10,
            y: 20,
            width: 400,
            height: 200,
            dragMode,
            updateClipCursor: record("updateClipCursor"),
            updateClipMode: record("updateClipMode"),
            clipByMode: record("clipByMode")
        },
        zoom: record("zoom"),
        rotate: record("rotate"),
        translate: record("translate"),
        moveToNext: record("moveToNext"),
        moveToPrevious: record("moveToPrevious"),
        emit: (name, ...args) => calls.push(["emit:" + name, ...args])
    };
}

/** The names of the calls a fake controller recorded, without their arguments.
 *
 * @param {any} controller - The fake controller.
 * @returns {Array<string>} - The names.
 */
export function names(controller) {
    return controller.calls.map(([name]) => name);
}
