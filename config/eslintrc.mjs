import globals from "globals";
import path from "node:path";
import {fileURLToPath} from "node:url";
import js from "@eslint/js";
import {FlatCompat} from "@eslint/eslintrc";
import tseslint from "typescript-eslint";
import importPlugin from "eslint-plugin-import";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

// See docs/software-factory/code-standard.md, section 1.2. Zero warnings: every rule
// here is an error, and the check script runs with --max-warnings 0.
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
            // Section 2.1: named exports only, and no import cycles.
            "import/no-default-export": ["error"],
            "import/no-cycle": ["error"],
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
    // Tool config files must export a default: that is the shape ESLint and gulp read.
    {
        files: ["config/*.mjs", "gulpfile.js", "*.config.{js,mjs}"],
        rules: {"import/no-default-export": "off"}
    },
    // TypeScript files: the types are in the code, so the JSDoc rules do not apply.
    ...tseslint.configs.recommended.map(c => ({...c, files: ["**/*.ts"]})),
    {
        files: ["**/*.ts"],
        rules: {
            ...bugRules,
            "no-unused-vars": "off",
            "@typescript-eslint/no-unused-vars": ["error"],
            "jsdoc/require-jsdoc": "off",
            "jsdoc/require-param-type": "off",
            "jsdoc/require-returns-type": "off"
        }
    }
];
