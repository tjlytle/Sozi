import globals from "globals";
import path from "node:path";
import {fileURLToPath} from "node:url";
import js from "@eslint/js";
import {FlatCompat} from "@eslint/eslintrc";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";
import jsxA11y from "eslint-plugin-jsx-a11y";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

// See docs/software-factory/code-standard.md. Zero warnings: every rule here is an
// error, and the check script runs with --max-warnings 0.

// Section 1.2: rules that catch bugs.
const bugRules = {
    "no-unused-vars": ["error"],
    "no-prototype-builtins": ["error"],
    eqeqeq: ["error", "always"],
    "no-var": ["error"],
    "prefer-const": ["error"],
    curly: ["error", "all"],
    "no-implicit-globals": ["error"],
    "no-param-reassign": ["error"]
};

// Where things live. A surface is anything that talks to the deck through the API.
const DECK = ["src/js/player/**", "src/js/player.{js,ts}", "src/js/model/**", "src/js/svg/**"];
const SURFACES = ["src/js/presenter/**", "src/js/presenter.{js,ts}", "src/js/surfaces/**"];
const PUBLISHERS = [
    "src/js/player.js",
    "src/js/player.ts",
    "src/js/presenter.js",
    "src/js/presenter.ts"
];
const ENTRY_POINTS = [
    "src/js/editor.js",
    "src/js/player.js",
    "src/js/presenter.js",
    "src/js/index-electron.js",
    "src/js/cli/index.js",
    "src/js/exporter/exporter-preload.js"
];
const ELECTRON_GLUE = ["src/js/**/*-electron.js", "src/js/backend/Electron.js"];
const PROTOCOL = ["src/js/protocol/**"];
const SANITIZER = ["src/js/html/**"];

// Syntax bans, one per section, composed per scope below. ESLint flat config replaces a
// rule's whole configuration when a later block sets it again, so every scope that
// needs `no-restricted-syntax` lists the full set it wants.
const BAN = {
    // 2.3: the published API is the only global; only the publishers assign window.*
    windowAssign: {
        selector: "AssignmentExpression[left.object.name='window']",
        message: "Only player.js and presenter.js publish on window (code-standard.md 2.3)"
    },
    // 2.4: event names come from the emitter's exported table, never a bare string.
    eventString: {
        selector:
            "CallExpression[callee.property.name=/^(on|once|off|emit|addListener|removeListener|prependListener)$/] > Literal.arguments:first-child",
        message:
            "Event names come from the emitter's exported table, not a string (code-standard.md 2.4)"
    },
    // 2.5: the protocol module is the one place that sends messages.
    postMessage: {
        selector: "CallExpression[callee.property.name='postMessage']",
        message: "Messages are built and sent by src/js/protocol/ only (code-standard.md 2.5)"
    },
    // 3.3: JavaScript writes inline styles only for geometry it computed, never appearance.
    styleAppearance: {
        selector:
            "AssignmentExpression[left.object.property.name='style'][left.property.name!=/^(width|height|minWidth|minHeight|maxWidth|maxHeight|top|left|right|bottom|inset|transform|translate|scale|rotate)$/]",
        message:
            "Inline styles only for computed geometry (width, height, offsets, transform); appearance lives in CSS (code-standard.md 3.3)"
    },
    // 2.6: HTML from data is parsed only in the sanitizer module.
    jsxHtml: {
        selector: "JSXAttribute[name.name='dangerouslySetInnerHTML']",
        message: "Only src/js/html/ parses HTML from data (code-standard.md 2.6)"
    }
};
// 2.7: a blocking dialog freezes the page mid-talk; failures go to the notice panel.
const DIALOGS = ["alert", "confirm", "prompt"].map(name => ({
    name,
    message: "No blocking dialogs; report through the notice panel (code-standard.md 2.7)"
}));
// 2.2: function modules take the DOM as a parameter instead of reaching for it.
const DOM_GLOBALS = ["window", "document", "navigator"].map(name => ({
    name,
    message: "Function modules do not touch the DOM (code-standard.md 2.2); take it as a parameter"
}));
const ALL_BANS = [
    BAN.windowAssign,
    BAN.eventString,
    BAN.postMessage,
    BAN.jsxHtml,
    BAN.styleAppearance
];
const syntax = bans => ({"no-restricted-syntax": ["error", ...bans]});
const without = (...omit) => ALL_BANS.filter(b => !omit.includes(b));

export default [
    ...compat.extends("eslint:recommended", "plugin:jsdoc/recommended"),
    {
        plugins: {import: importPlugin},
        languageOptions: {
            globals: {
                ...globals.browser,
                ...globals.node
            },
            ecmaVersion: 2022,
            sourceType: "module"
        },
        settings: {
            jsdoc: {
                tagNamePreference: {
                    augments: "extends"
                }
            }
        },
        rules: {
            ...bugRules,
            // 2.1: named exports only, no import cycles.
            "import/no-default-export": ["error"],
            "import/no-cycle": ["error"],
            // 2.3: the deck never depends on a surface, and a surface never imports deck
            // internals; the protocol module is the only thing both sides share.
            "import/no-restricted-paths": [
                "error",
                {
                    zones: [
                        {
                            target: DECK,
                            from: SURFACES,
                            message: "The deck never depends on a surface (code-standard.md 2.3)"
                        },
                        {
                            target: SURFACES,
                            from: DECK,
                            message:
                                "A surface reaches the deck only through the API and the protocol (code-standard.md 2.3)"
                        }
                    ]
                }
            ],
            "no-restricted-globals": ["error", ...DIALOGS],
            "jsdoc/require-jsdoc": [
                "error",
                {
                    publicOnly: true,
                    checkSetters: false,
                    require: {
                        ClassDeclaration: true,
                        MethodDefinition: true
                    }
                }
            ],
            "jsdoc/multiline-blocks": ["error", {noZeroLineText: false}],
            "jsdoc/tag-lines": ["off"]
        }
    },
    // Sections 2.3 to 3.3 shape the product code. Tests and scripts drive third-party
    // APIs (page.on, locator.innerHTML()) and are not held to these bans.
    {
        files: ["src/**"],
        rules: {
            // 2.6: HTML from data is parsed only in the sanitizer module.
            "no-restricted-properties": [
                "error",
                ...["innerHTML", "outerHTML", "insertAdjacentHTML"].map(property => ({
                    property,
                    message:
                        "Only src/js/html/ parses HTML from data; use textContent or a <template> (code-standard.md 2.6)"
                })),
                {
                    object: "document",
                    property: "write",
                    message: "Only src/js/html/ parses HTML from data (code-standard.md 2.6)"
                }
            ],
            ...syntax(ALL_BANS)
        }
    },
    // 2.2: function modules (lowercase files) do not touch the DOM, so they run under
    // node. Entry points are the exception: they are where the DOM is handed in.
    {
        files: ["src/js/**/[a-z]*.js", "src/js/**/[a-z]*.ts"],
        ignores: ENTRY_POINTS,
        rules: {"no-restricted-globals": ["error", ...DIALOGS, ...DOM_GLOBALS]}
    },
    // 2.3: the two publishing modules may assign window.sozi / window.sozi.presenter.
    {files: PUBLISHERS, rules: syntax(without(BAN.windowAssign))},
    // 2.4: Electron and node glue subscribes to events whose names are not ours.
    {files: ELECTRON_GLUE, rules: syntax(without(BAN.eventString))},
    // 2.5: the protocol module is the one place that may call postMessage.
    {files: PROTOCOL, rules: syntax(without(BAN.postMessage))},
    // 2.6: the sanitizer module is the one place that may parse HTML.
    {files: SANITIZER, rules: {"no-restricted-properties": "off", ...syntax(without(BAN.jsxHtml))}},
    // Tool config files must export a default: that is the shape ESLint and gulp read.
    {
        files: ["config/*.mjs", "gulpfile.js", "*.config.{js,mjs}"],
        rules: {"import/no-default-export": "off"}
    },
    // TypeScript files: the types are in the code, so the JSDoc type rules do not apply;
    // the description sentence on every export still does (2.8).
    ...tseslint.configs.recommended.map(c => ({...c, files: ["**/*.ts", "**/*.tsx"]})),
    {
        files: ["**/*.ts", "**/*.tsx"],
        languageOptions: {
            parserOptions: {projectService: true, tsconfigRootDir: path.join(__dirname, "..")}
        },
        rules: {
            ...bugRules,
            // 2.7: a promise nobody awaits or catches is a failure nobody sees.
            "@typescript-eslint/no-floating-promises": ["error"],
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": ["error"],
            "jsdoc/require-jsdoc": [
                "error",
                {
                    publicOnly: true,
                    require: {
                        FunctionDeclaration: true,
                        ClassDeclaration: true,
                        MethodDefinition: true
                    }
                }
            ],
            "jsdoc/require-param": "off",
            "jsdoc/require-param-type": "off",
            "jsdoc/require-returns": "off",
            "jsdoc/require-returns-type": "off"
        }
    },
    // 2.8: surfaces are accessible; jsx-a11y checks labels, roles and keyboard handlers
    // on every JSX element.
    {
        files: ["**/*.tsx", "**/*.jsx"],
        plugins: {"jsx-a11y": jsxA11y},
        languageOptions: {parserOptions: {ecmaFeatures: {jsx: true}}},
        rules: {...jsxA11y.flatConfigs.recommended.rules}
    }
];
