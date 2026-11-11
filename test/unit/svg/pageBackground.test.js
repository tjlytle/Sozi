import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {pageBackground} from "../../../src/js/svg/pageBackground.js";

describe("pageBackground", () => {
    test("six-digit hex with a leading # gives its rgba colour", () => {
        assert.equal(pageBackground("#ff8000", "0.5"), "rgba(255, 128, 0, 0.5)");
    });
    test("six-digit hex without # gives the same colour", () => {
        assert.equal(pageBackground("ff8000", "0.5"), "rgba(255, 128, 0, 0.5)");
    });
    test("three-digit hex is the short form of six-digit hex", () => {
        assert.equal(pageBackground("#f80", "1"), "rgba(255, 136, 0, 1)");
    });
    test("upper case hex gives the same colour as lower case", () => {
        assert.equal(pageBackground("#FF8000", "0.5"), "rgba(255, 128, 0, 0.5)");
    });
    for (const pageColor of ["white", "rgb(1,2,3)", "", "#ff80"]) {
        test(`a page colour of ${JSON.stringify(pageColor)} gives no background`, () => {
            assert.equal(pageBackground(pageColor, "1"), null);
        });
    }
    test("an opacity that is not a number counts as 0", () => {
        assert.equal(pageBackground("#ffffff", "abc"), "rgba(255, 255, 255, 0)");
    });
    test("an opacity below 0 is clamped to 0", () => {
        assert.equal(pageBackground("#ffffff", "-1"), "rgba(255, 255, 255, 0)");
    });
    test("an opacity above 1 is clamped to 1", () => {
        assert.equal(pageBackground("#ffffff", "2"), "rgba(255, 255, 255, 1)");
    });
});
