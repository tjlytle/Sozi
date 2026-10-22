// DOM collection types for JSDoc. The JSDoc linter knows browser globals and the
// TypeScript utility types but not lib.dom's generic collection names, so files
// import them from here: `@type {import("../types/dom").ElementList<HTMLAnchorElement>}`.

/** The live-free list that `querySelectorAll` returns for a given element type. */
export type ElementList<T extends Element> = NodeListOf<T>;
