/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Decoders for the files the CLI writes: the PNG images of render and export, and the zip
// files (pptx, odp) of export. They need no Electron, so a test that only reads a file
// does not load the run helpers of helpers.js.

import assert from "node:assert/strict";
import {existsSync, readFileSync} from "node:fs";
import {inflateRawSync, inflateSync} from "node:zlib";

/** A decoded PNG image; `pixel(x, y)` gives `[r, g, b]`. */
export type DecodedPng = {width: number; height: number; pixel(x: number, y: number): number[]};

/** One entry of a zip file; `data()` gives its uncompressed content. */
export type ZipEntry = {name: string; data(): Buffer};

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

/** The number of channels of each PNG colour type the decoder reads: RGB and RGBA. */
const CHANNELS: Partial<Record<number, number>> = {2: 3, 6: 4};

/** The paeth predictor of PNG filter type 4: whichever of the left, up and up-left bytes
 * is closest to `a + b - c`.
 */
function paeth(a: number, b: number, c: number): number {
    const p = a + b - c;
    const pa = Math.abs(p - a);
    const pb = Math.abs(p - b);
    const pc = Math.abs(p - c);
    if (pa <= pb && pa <= pc) {
        return a;
    }
    return pb <= pc ? b : c;
}

/** Undo the PNG scanline filters: each row of `raw` starts with its filter type byte.
 *
 * @returns The pixel bytes, `width * channels` per row, without the filter bytes.
 */
function unfilter(raw: Buffer, width: number, height: number, channels: number): Buffer {
    const stride = width * channels;
    const pixels = Buffer.alloc(stride * height);
    for (let y = 0; y < height; y++) {
        const filter = raw[y * (stride + 1)];
        for (let i = 0; i < stride; i++) {
            const x = raw[y * (stride + 1) + 1 + i];
            const a = i >= channels ? pixels[y * stride + i - channels] : 0;
            const b = y > 0 ? pixels[(y - 1) * stride + i] : 0;
            const c = i >= channels && y > 0 ? pixels[(y - 1) * stride + i - channels] : 0;
            pixels[y * stride + i] = (x + [0, a, b, (a + b) >> 1, paeth(a, b, c)][filter]) & 0xff;
        }
    }
    return pixels;
}

/** Decode an 8-bit, non-interlaced RGB or RGBA PNG (what Chrome writes).
 *
 * @throws {Error} An assertion error when the signature is wrong, or the image is not 8-bit,
 *  non-interlaced RGB or RGBA.
 */
export function decodePng(buf: Buffer): DecodedPng {
    assert.ok(buf.subarray(0, 8).equals(PNG_SIGNATURE), "PNG signature");
    let width = 0;
    let height = 0;
    let channels = 0;
    const idat = [];
    for (let o = 8; o < buf.length;) {
        const length = buf.readUInt32BE(o);
        const type = buf.toString("ascii", o + 4, o + 8);
        const data = buf.subarray(o + 8, o + 8 + length);
        if (type === "IHDR") {
            width = data.readUInt32BE(0);
            height = data.readUInt32BE(4);
            assert.equal(data[8], 8, "PNG bit depth");
            assert.equal(data[12], 0, "PNG interlace");
            channels = CHANNELS[data[9]] ?? 0;
            assert.ok(channels, `PNG color type ${data[9]}`);
        } else if (type === "IDAT") {
            idat.push(data);
        }
        o += 12 + length;
    }
    const pixels = unfilter(inflateSync(Buffer.concat(idat)), width, height, channels);
    const stride = width * channels;
    return {
        width,
        height,
        pixel: (x, y) => [
            ...pixels.subarray(y * stride + x * channels, y * stride + x * channels + 3)
        ]
    };
}

/** Decode a PNG file and check that it exists and has the expected size. */
function readPng(file: string, width: number, height: number): DecodedPng {
    assert.ok(existsSync(file), `${file} exists`);
    const png = decodePng(readFileSync(file));
    assert.deepEqual({width: png.width, height: png.height}, {width, height});
    return png;
}

/** Decode a PNG file and check its size, and that its pixels are not all the same colour.
 *
 * Every fourth row and column is sampled.
 *
 * @returns The decoded image and the number of distinct colours among the sampled pixels.
 */
export function checkPng(
    file: string,
    width: number,
    height: number
): {png: DecodedPng; colours: number} {
    const png = readPng(file, width, height);
    const colours = new Set<string>();
    for (let y = 0; y < height; y += 4) {
        for (let x = 0; x < width; x += 4) {
            colours.add(png.pixel(x, y).join(","));
        }
    }
    assert.ok(colours.size > 1, `${file} is uniform: ${[...colours]}`);
    return {png, colours: colours.size};
}

/** Decode a PNG file of the basic fixture and check its size, and that it shows the frame.
 *
 * The frames of the basic fixture are filled by the orange rectangle r2 (#cc6633), and
 * the frame number of the player is hidden by default: every sampled pixel (every fourth
 * row and column) is orange.
 */
export function checkBasicPng(file: string, width: number, height: number): DecodedPng {
    const png = readPng(file, width, height);
    for (let y = 0; y < height; y += 4) {
        for (let x = 0; x < width; x += 4) {
            const [r, g, b] = png.pixel(x, y);
            assert.ok(
                Math.abs(r - 0xcc) < 8 && Math.abs(g - 0x66) < 8 && Math.abs(b - 0x33) < 8,
                `${file} at ${x},${y}: ${[r, g, b]}`
            );
        }
    }
    return png;
}

/** The number of dark pixels in the top left corner of a PNG file, where the player draws
 * the frame number.
 *
 * The frame number is a dark box; the frames of the basic fixture are orange there.
 *
 * @returns The number of pixels darker than 100 on each channel in the top left 100 by 40
 *  pixels.
 */
export function darkInCorner(file: string): number {
    const png = decodePng(readFileSync(file));
    let count = 0;
    for (let y = 0; y < Math.min(40, png.height); y++) {
        for (let x = 0; x < Math.min(100, png.width); x++) {
            const [r, g, b] = png.pixel(x, y);
            count += r < 100 && g < 100 && b < 100 ? 1 : 0;
        }
    }
    return count;
}

/** The entries of a zip file, from its central directory.
 *
 * @throws {Error} An assertion error when the file has no end of central directory record, or an
 *  entry of the directory has the wrong signature.
 */
export function zipEntries(buf: Buffer): ZipEntry[] {
    const eocd = buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    assert.ok(eocd >= 0, "zip end of central directory");
    const count = buf.readUInt16LE(eocd + 10);
    let o = buf.readUInt32LE(eocd + 16);
    const entries: ZipEntry[] = [];
    for (let i = 0; i < count; i++) {
        assert.equal(buf.readUInt32LE(o), 0x02014b50, "zip central directory entry");
        const method = buf.readUInt16LE(o + 10);
        const compressedSize = buf.readUInt32LE(o + 20);
        const nameLength = buf.readUInt16LE(o + 28);
        const extraLength = buf.readUInt16LE(o + 30);
        const commentLength = buf.readUInt16LE(o + 32);
        const local = buf.readUInt32LE(o + 42);
        entries.push({
            name: buf.toString("utf8", o + 46, o + 46 + nameLength),
            data() {
                const start =
                    local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
                const raw = buf.subarray(start, start + compressedSize);
                return method === 8 ? inflateRawSync(raw) : raw;
            }
        });
        o += 46 + nameLength + extraLength + commentLength;
    }
    return entries;
}
