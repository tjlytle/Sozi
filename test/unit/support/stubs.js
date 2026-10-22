/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Stand-ins for the browser objects that the unit-tested modules read.

import fs from "node:fs";
import path from "node:path";
import {fileURLToPath, pathToFileURL} from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/** Create an in-memory replacement for `localStorage`.
 *
 * @returns {object} - An object with the `Storage` methods.
 */
export function fakeLocalStorage() {
    /** @type {Map<string, string>} */
    const data = new Map();
    return {
        getItem: key => (data.has(key) ? data.get(key) : null),
        setItem: (key, value) => {
            data.set(key, String(value));
        },
        removeItem: key => {
            data.delete(key);
        },
        clear: () => {
            data.clear();
        },
        get length() {
            return data.size;
        },
        key: index => Array.from(data.keys())[index] ?? null
    };
}

/** Create a manual replacement for `requestAnimationFrame`.
 *
 * Callbacks run only when `tick` is called, with a clock that the test controls.
 *
 * @returns {{install: Function, uninstall: Function, tick: Function}} - Install it on `globalThis`, then advance the clock.
 */
export function fakeRequestAnimationFrame() {
    let now = 0;
    let nextId = 1;
    /** @type {Map<number, Function>} */
    let pending = new Map();
    const saved = {};

    return {
        install() {
            saved.raf = globalThis.requestAnimationFrame;
            saved.caf = globalThis.cancelAnimationFrame;
            globalThis.requestAnimationFrame = callback => {
                pending.set(nextId, callback);
                return nextId++;
            };
            globalThis.cancelAnimationFrame = id => {
                pending.delete(id);
            };
        },
        uninstall() {
            globalThis.requestAnimationFrame = saved.raf;
            globalThis.cancelAnimationFrame = saved.caf;
            pending = new Map();
        },
        tick(ms) {
            now += ms;
            const callbacks = Array.from(pending.values());
            pending = new Map();
            for (const callback of callbacks) {
                callback(now);
            }
        }
    };
}

const identity = {
    a: 1,
    b: 0,
    c: 0,
    d: 1,
    e: 0,
    f: 0,
    inverse() {
        return identity;
    },
    multiply() {
        return identity;
    }
};

/** Create an SVG root element stub, as read by `CameraState`.
 *
 * @param {{x: number, y: number, width: number, height: number}} box - The bounding box of the content.
 * @returns {any} - An object with `getBBox` and `createSVGPoint`.
 */
export function svgRootStub({x, y, width, height}) {
    return {
        getBBox: () => ({x, y, width, height}),
        createSVGPoint: () => ({
            x: 0,
            y: 0,
            matrixTransform() {
                return {x: this.x, y: this.y};
            }
        })
    };
}

/** Create an SVG element stub with the getters that `CameraState` reads.
 *
 * The element is the layer group itself: its parent's parent is the root.
 * The transform from the layer to the element is the identity.
 *
 * @param {{x: number, y: number, width: number, height: number}} box - The bounding box of the element.
 * @param {any} [root] - The SVG root element; a stub by default.
 * @returns {any} - An object with `getBBox`, `getScreenCTM` and `parentNode`.
 */
export function svgElementStub(
    {x, y, width, height},
    root = svgRootStub({x: 0, y: 0, width: 1, height: 1})
) {
    return {
        parentNode: {parentNode: root},
        getBBox: () => ({x, y, width, height}),
        getScreenCTM: () => identity
    };
}

/** Load a module from the Babel output in `build/electron/src/js`.
 *
 * @param {string} relPath - The path of the module relative to `build/electron/src/js`.
 * @returns {Promise<any>} - The module namespace.
 */
export async function builtModule(relPath) {
    const file = path.join(root, "build", "electron", "src", "js", relPath);
    if (!fs.existsSync(file)) {
        throw new Error(
            `${file} is missing: run "npx gulp" to build before running the unit tests`
        );
    }
    return import(pathToFileURL(file).href);
}
