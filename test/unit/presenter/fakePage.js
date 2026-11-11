// Stand-ins for the parts of a page that the workspace's unit tests reach.

/**
 * An element with what the workspace and its bar use of one.
 *
 * @param {object} doc - The page it belongs to.
 * @returns {object} The element.
 */
export function fakeElement(doc) {
    const classes = new Set();
    return {
        ownerDocument: doc,
        dataset: {},
        children: [],
        classes,
        classList: {
            toggle: (name, on) => (on ? classes.add(name) : classes.delete(name))
        },
        append() {},
        replaceChildren(...children) {
            this.children = children;
        },
        setAttribute() {},
        addEventListener() {},
        removeEventListener() {},
        remove() {}
    };
}

/**
 * A window opened on `about:blank`, with what a panel's window uses of it.
 *
 * @returns {object} The window; `hide` closes it as the speaker does.
 */
export function fakeWindow() {
    const listeners = new Map();
    const doc = {
        title: "",
        head: {append() {}},
        body: {replaceChildren() {}},
        createElement: () => fakeElement(doc)
    };
    return {
        innerWidth: 300,
        innerHeight: 200,
        document: doc,
        addEventListener: (name, listener) => listeners.set(name, listener),
        removeEventListener: name => listeners.delete(name),
        close() {},
        hide: () => listeners.get("pagehide")()
    };
}
