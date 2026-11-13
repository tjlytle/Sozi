// test/cli/decode.test.js
// The PNG and zip decoders read what the CLI writes; these cases build their inputs in
// memory, so they need no Electron and no fixture.
const {test, describe, before, after} = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const zlib = require("node:zlib");
const {decodePng, checkPng, checkBasicPng, darkInCorner, zipEntries} = require("./decode.ts");

const ORANGE = [0xcc, 0x66, 0x33];

/** One PNG chunk: length, type, data and CRC.
 *
 * @param {string} type - The four-letter chunk type.
 * @param {Buffer} data - The chunk data.
 * @returns {Buffer} - The chunk.
 */
function chunk(type, data) {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(zlib.crc32(body));
    return Buffer.concat([length, body, crc]);
}

/** The PNG predictor of a filter type, from the left, up and up-left bytes.
 *
 * @param {number} filter - The filter type, 0 to 4.
 * @param {number} a - The byte to the left.
 * @param {number} b - The byte above.
 * @param {number} c - The byte above and to the left.
 * @returns {number} - The predicted byte.
 */
function predict(filter, a, b, c) {
    const p = a + b - c;
    const [pa, pb, pc] = [Math.abs(p - a), Math.abs(p - b), Math.abs(p - c)];
    const paeth = pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
    return [0, a, b, (a + b) >> 1, paeth][filter];
}

/** Encode an 8-bit PNG, filtering each scanline with the given filter type.
 *
 * @param {number[][][]} rows - The pixels, row by row, each `[r, g, b]` or `[r, g, b, a]`.
 * @param {object} [opts] - Options.
 * @param {number[]} [opts.filters] - The filter type of each row (default: all 0).
 * @param {Partial<Record<number, number>>} [opts.ihdr] - IHDR bytes to override, by offset.
 * @returns {Buffer} - The PNG file.
 */
function encodePng(rows, {filters = [], ihdr: overrides = {}} = {}) {
    const width = rows[0].length;
    const channels = rows[0][0].length;
    const stride = width * channels;
    const bytes = rows.map(row => row.flat());
    const raw = bytes.map((line, y) => {
        const filter = filters[y] || 0;
        const out = [filter];
        for (let i = 0; i < stride; i++) {
            const a = i >= channels ? line[i - channels] : 0;
            const b = y > 0 ? bytes[y - 1][i] : 0;
            const c = i >= channels && y > 0 ? bytes[y - 1][i - channels] : 0;
            out.push((line[i] - predict(filter, a, b, c)) & 0xff);
        }
        return out;
    });
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(rows.length, 4);
    ihdr[8] = 8;
    ihdr[9] = channels === 4 ? 6 : 2;
    Object.entries(overrides).forEach(([offset, value]) => (ihdr[Number(offset)] = value));
    return Buffer.concat([
        Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
        chunk("IHDR", ihdr),
        chunk("IDAT", zlib.deflateSync(Buffer.from(raw.flat()))),
        chunk("IEND", Buffer.alloc(0))
    ]);
}

/** An image of one colour.
 *
 * @param {number} width - The width in pixels.
 * @param {number} height - The height in pixels.
 * @param {number[]} colour - The colour, `[r, g, b]`.
 * @returns {number[][][]} - The rows of pixels.
 */
function filled(width, height, colour) {
    return Array.from({length: height}, () => Array.from({length: width}, () => [...colour]));
}

// Five rows of three pixels, values chosen so that every branch of the paeth predictor runs.
const RGB = [
    [
        [10, 200, 30],
        [40, 50, 250],
        [255, 0, 128]
    ],
    [
        [12, 190, 35],
        [90, 60, 240],
        [250, 5, 120]
    ],
    [
        [200, 10, 20],
        [30, 220, 40],
        [70, 80, 90]
    ],
    [
        [0, 255, 0],
        [128, 128, 128],
        [1, 2, 3]
    ],
    [
        [60, 61, 62],
        [250, 251, 252],
        [33, 100, 7]
    ]
];

describe("decodePng", () => {
    test("reads an RGB image with one scanline per filter type", () => {
        const png = decodePng(encodePng(RGB, {filters: [0, 1, 2, 3, 4]}));
        assert.deepEqual({width: png.width, height: png.height}, {width: 3, height: 5});
        RGB.forEach((row, y) => row.forEach((rgb, x) => assert.deepEqual(png.pixel(x, y), rgb)));
    });

    test("reads an RGBA image and drops the alpha channel", () => {
        const rgba = RGB.map((row, y) => row.map(([r, g, b], x) => [r, g, b, 40 * x + y]));
        const png = decodePng(encodePng(rgba, {filters: [4, 3, 2, 1, 0]}));
        RGB.forEach((row, y) => row.forEach((rgb, x) => assert.deepEqual(png.pixel(x, y), rgb)));
    });

    test("throws on a bad signature", () => {
        const buf = encodePng(RGB);
        buf[1] = 0;
        assert.throws(() => decodePng(buf), /PNG signature/);
    });

    test("throws on a 16-bit image", () => {
        assert.throws(() => decodePng(encodePng(RGB, {ihdr: {8: 16}})), /bit depth/);
    });

    test("throws on an interlaced image", () => {
        assert.throws(() => decodePng(encodePng(RGB, {ihdr: {12: 1}})), /interlace/);
    });

    test("throws on a palette image", () => {
        assert.throws(() => decodePng(encodePng(RGB, {ihdr: {9: 3}})), /color type 3/);
    });
});

describe("PNG file checks", () => {
    /** @type {string} */
    let dir;
    before(() => (dir = fs.mkdtempSync(path.join(os.tmpdir(), "sozi-decode-test-"))));
    after(() => fs.rmSync(dir, {recursive: true, force: true}));

    /** Write a PNG of the given rows into the test directory.
     *
     * @param {string} name - The file name.
     * @param {number[][][]} rows - The pixels.
     * @returns {string} - The path of the file.
     */
    function write(name, rows) {
        const file = path.join(dir, name);
        fs.writeFileSync(file, encodePng(rows));
        return file;
    }

    test("checkPng counts the sampled colours", () => {
        const rows = filled(8, 8, ORANGE);
        rows[4][4] = [0, 0, 0];
        rows[5][5] = [1, 1, 1]; // Not sampled: only every fourth row and column is.
        const {png, colours} = checkPng(write("two.png", rows), 8, 8);
        assert.equal(colours, 2);
        assert.deepEqual(png.pixel(4, 4), [0, 0, 0]);
    });

    test("checkPng throws on a uniform image", () => {
        const file = write("uniform.png", filled(8, 8, ORANGE));
        assert.throws(() => checkPng(file, 8, 8), /uniform/);
    });

    test("checkPng and checkBasicPng throw on a size mismatch", () => {
        const rows = filled(8, 8, ORANGE);
        rows[0][0] = [0, 0, 0];
        const file = write("size.png", rows);
        assert.throws(() => checkPng(file, 8, 4));
        assert.throws(() => checkBasicPng(file, 4, 8));
    });

    test("checkPng and checkBasicPng throw on a missing file", () => {
        const file = path.join(dir, "missing.png");
        assert.throws(() => checkPng(file, 8, 8), /exists/);
        assert.throws(() => checkBasicPng(file, 8, 8), /exists/);
    });

    test("checkBasicPng accepts an orange image", () => {
        const png = checkBasicPng(write("orange.png", filled(8, 8, ORANGE)), 8, 8);
        assert.deepEqual(png.pixel(7, 7), ORANGE);
    });

    test("checkBasicPng throws on a pixel that is not orange", () => {
        const rows = filled(8, 8, ORANGE);
        rows[4][0] = [0xcc, 0x66, 0x50];
        const file = write("not-orange.png", rows);
        assert.throws(() => checkBasicPng(file, 8, 8), /at 0,4/);
    });

    test("darkInCorner counts the dark pixels of the top left 100 by 40", () => {
        const rows = filled(120, 50, ORANGE);
        rows[1][1] = [0, 0, 0];
        rows[39][99] = [99, 99, 99];
        rows[2][2] = [100, 0, 0]; // Not dark: 100 on one channel.
        rows[1][100] = [0, 0, 0]; // Outside the corner.
        rows[40][1] = [0, 0, 0]; // Outside the corner.
        assert.equal(darkInCorner(write("corner.png", rows)), 2);
    });
});

/** A zip file holding the given entries.
 *
 * @param {{name: string, data: Buffer, deflate: boolean}[]} entries - The entries.
 * @returns {Buffer} - The zip file.
 */
function encodeZip(entries) {
    const locals = [];
    const centrals = [];
    let offset = 0;
    for (const {name, data, deflate} of entries) {
        const nameBytes = Buffer.from(name, "utf8");
        const stored = deflate ? zlib.deflateRawSync(data) : data;
        const local = Buffer.alloc(30);
        local.writeUInt32LE(0x04034b50, 0);
        local.writeUInt16LE(deflate ? 8 : 0, 8);
        local.writeUInt32LE(stored.length, 18);
        local.writeUInt32LE(data.length, 22);
        local.writeUInt16LE(nameBytes.length, 26);
        const central = Buffer.alloc(46);
        central.writeUInt32LE(0x02014b50, 0);
        central.writeUInt16LE(deflate ? 8 : 0, 10);
        central.writeUInt32LE(stored.length, 20);
        central.writeUInt32LE(data.length, 24);
        central.writeUInt16LE(nameBytes.length, 28);
        central.writeUInt32LE(offset, 42);
        locals.push(local, nameBytes, stored);
        centrals.push(central, nameBytes);
        offset += 30 + nameBytes.length + stored.length;
    }
    const directory = Buffer.concat(centrals);
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(entries.length, 8);
    eocd.writeUInt16LE(entries.length, 10);
    eocd.writeUInt32LE(directory.length, 12);
    eocd.writeUInt32LE(offset, 16);
    return Buffer.concat([...locals, directory, eocd]);
}

describe("zipEntries", () => {
    test("reads a stored entry and a deflated entry", () => {
        const zip = encodeZip([
            {name: "a.txt", data: Buffer.from("hello"), deflate: false},
            {name: "dir/b.txt", data: Buffer.from("world ".repeat(20)), deflate: true}
        ]);
        const entries = zipEntries(zip);
        assert.deepEqual(
            entries.map(e => e.name),
            ["a.txt", "dir/b.txt"]
        );
        assert.equal(entries[0].data().toString(), "hello");
        assert.equal(entries[1].data().toString(), "world ".repeat(20));
    });

    test("throws without an end of central directory record", () => {
        assert.throws(() => zipEntries(Buffer.from("not a zip file")), /end of central directory/);
    });
});
