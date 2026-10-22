// The build generates locales.js from locales/*.po (gulpfile.js, the locales task) as a
// CommonJS module; this declares its shape so i18n.js type-checks against the source tree.

/** Jed locale data for each language tag that has a translation. */
declare const locales: Record<string, object>;
export = locales;
