import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {MessageNames, readMessage} from "../../../src/js/protocol/messages.js";
import {thumbnailMessage, thumbnailRequestMessage} from "../../../src/js/protocol/thumbnails.js";

const JPEG = "data:image/jpeg;base64,AAAA";

describe("thumbnail messages", () => {
    test("each builder names its fields", () => {
        assert.deepEqual(thumbnailRequestMessage(2, 320), {
            name: MessageNames.thumbnailRequest,
            index: 2,
            width: 320
        });
        assert.deepEqual(thumbnailMessage(2, JPEG), {
            name: MessageNames.thumbnail,
            index: 2,
            url: JPEG
        });
    });

    test("every built message reads back unchanged", () => {
        for (const message of [
            thumbnailRequestMessage(3, 320),
            thumbnailMessage(3, JPEG),
            thumbnailMessage(3, "")
        ]) {
            assert.deepEqual(readMessage(message), message);
        }
    });

    test("a thumbnailRequest needs an index and a positive integer width", () => {
        for (const fields of [
            {index: -1, width: 320},
            {index: "1", width: 320},
            {width: 320},
            {index: 1},
            {index: 1, width: 0},
            {index: 1, width: -320},
            {index: 1, width: 1.5},
            {index: 1, width: "320"}
        ]) {
            assert.equal(
                readMessage({name: "thumbnailRequest", ...fields}),
                null,
                JSON.stringify(fields)
            );
        }
    });

    test("a thumbnail's url can only be empty or a JPEG data URL", () => {
        for (const url of [
            "javascript:alert(1)",
            "https://example.com/a.jpg",
            "data:text/html;base64,AAAA",
            "data:image/svg+xml;base64,AAAA",
            "data:image/jpeg,AAAA",
            " data:image/jpeg;base64,AAAA",
            3,
            null,
            undefined
        ]) {
            assert.equal(readMessage({name: "thumbnail", index: 0, url}), null, String(url));
        }
    });

    test("a thumbnail needs an index", () => {
        assert.equal(readMessage({name: "thumbnail", index: -1, url: JPEG}), null);
        assert.equal(readMessage({name: "thumbnail", url: ""}), null);
    });
});
