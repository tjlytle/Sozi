/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** The `inspect` command of `sozi --cli`.
 *
 * Describes the layers and frames of a presentation. Writes nothing.
 *
 * @module
 */

/** Read the layer ids that the presentation JSON file has properties for.
 *
 * The model has properties for every layer of the SVG, so whether a layer
 * is known to the JSON file can only be told from the file itself.
 * The runner has already checked that the file, if any, parses.
 *
 * @param {string} presentation - The absolute path of the JSON file.
 * @returns {Set<string>} - The layer ids found in the `layerProperties` of any frame.
 */
function jsonLayerIds(presentation) {
    const fs = require("fs");

    const ids = new Set();
    if (!fs.existsSync(presentation)) {
        return ids;
    }
    const data = JSON.parse(fs.readFileSync(presentation, {encoding: "utf-8"}));
    for (const frame of data.frames || []) {
        Object.keys(frame.layerProperties || {}).forEach(id => ids.add(id));
    }
    return ids;
}

/** The layers of a presentation that have SVG groups.
 *
 * The model always has an "auto" layer for the top-level groups without an id;
 * it is left out when there are no such groups.
 *
 * @param {module:model/Presentation.Presentation} presentation - The presentation.
 * @returns {module:model/Presentation.Layer[]} - The layers, in document order.
 */
function svgLayers(presentation) {
    return presentation.layers.filter(layer => layer.svgNodes.length > 0);
}

/** Describe a frame.
 *
 * @param {module:model/Presentation.Frame} frame - The frame to describe.
 * @param {number} index - The index of the frame in the presentation.
 * @returns {object} - The frame properties and, for each layer id, the layer properties and camera.
 */
function describeFrame(frame, index) {
    const presentation = frame.presentation;
    const root = presentation.document.root;

    const layers = {};
    svgLayers(presentation).forEach(layer => {
        const layerIndex = layer.index;
        const lp = frame.layerProperties[layerIndex];
        const cs = frame.cameraStates[layerIndex];
        layers[layer.groupId] = {
            referenceElementId: lp.referenceElementId,
            referenceMissing:   Boolean(lp.referenceElementId) && root.getElementById(lp.referenceElementId) === null,
            outlineElementId:   lp.outlineElementId,
            link:               lp.link,
            camera: {
                cx:      cs.cx,
                cy:      cs.cy,
                width:   cs.width,
                height:  cs.height,
                angle:   cs.angle,
                opacity: cs.opacity,
                clipped: cs.clipped
            }
        };
    });

    return {
        index,
        id:                   frame.frameId,
        title:                frame.title,
        timeoutMs:            frame.timeoutMs,
        timeoutEnable:        frame.timeoutEnable,
        transitionDurationMs: frame.transitionDurationMs,
        showInFrameList:      frame.showInFrameList,
        layers
    };
}

/** Describe a presentation that has been loaded.
 *
 * With `--frame N`, only the frame with 0-based index N, or with frame id N,
 * is described.
 *
 * @param {object} context - The command context.
 * @param {module:Storage.Storage} context.storage - The storage, with the presentation loaded.
 * @param {string} context.presentation - The absolute path of the JSON file.
 * @param {object} context.flags - The command-line flags.
 * @returns {object} - The command result: `{ok, title, aspect, layers, frames}`, or `{ok: false, error}`.
 */
export function inspect({storage, presentation: jsonPath, flags}) {
    const presentation = storage.presentation;

    let frames = presentation.frames.map((frame, index) => ({frame, index}));
    if (flags.frame !== undefined) {
        if (typeof flags.frame !== "string") {
            return {ok: false, error: "--frame requires a frame index or id"};
        }
        const key = flags.frame;
        const byId = frames.filter(({frame}) => frame.frameId === key);
        const byIndex = /^\d+$/.test(key) ? frames.filter(({index}) => index === Number(key)) : [];
        frames = byIndex.length ? byIndex : byId;
        if (!frames.length) {
            return {ok: false, error: `frame not found: ${key}`};
        }
    }

    const inJson = jsonLayerIds(jsonPath);

    return {
        ok:     true,
        title:  presentation.title,
        aspect: {width: presentation.aspectWidth, height: presentation.aspectHeight},
        layers: svgLayers(presentation).map(layer => ({
            id:     layer.groupId,
            label:  layer.label,
            index:  layer.index,
            inJson: inJson.has(layer.groupId)
        })),
        frames: frames.map(({frame, index}) => describeFrame(frame, index))
    };
}
