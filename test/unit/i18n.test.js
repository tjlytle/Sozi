import {test, describe} from "node:test";
import assert from "node:assert/strict";
import {builtModule} from "./support/stubs.js";

const {chooseLanguage, init} = await builtModule("i18n.js");

const available = {fr: {}, pt: {}, pt_BR: {}, de: {}};

describe("chooseLanguage", () => {
    test("returns the available key that matches the tag", () => {
        assert.equal(chooseLanguage("fr", [], available), "fr");
    });

    test("falls back from a region to its language", () => {
        assert.equal(chooseLanguage("fr-CA", [], available), "fr");
    });

    test("ignores the separator and the case", () => {
        assert.equal(chooseLanguage("pt_BR", [], available), "pt_BR");
        assert.equal(chooseLanguage("PT-br", [], available), "pt_BR");
    });

    test("auto takes the first system language only", () => {
        assert.equal(chooseLanguage("auto", ["de-AT", "fr"], available), "de");
    });

    test("auto with no system language takes English", () => {
        assert.equal(chooseLanguage("auto", [], {...available, en: {}}), "en");
    });

    test("returns null for an untranslated language", () => {
        assert.equal(chooseLanguage("zu", [], available), null);
    });
});

describe("init", () => {
    test("translates into the chosen language", () => {
        assert.equal(init("fr", []).gettext("Frame"), "Vue");
    });

    test("auto translates into the first system language", () => {
        assert.equal(init("auto", ["de-AT", "fr"]).gettext("Frame"), "Rahmen");
    });

    test("auto with no system language gives the English source text", () => {
        assert.equal(init("auto", []).gettext("Frame"), "Frame");
    });

    test("an untranslated language gives the English source text", () => {
        assert.equal(init("zu", []).gettext("Frame"), "Frame");
    });
});
