// The build renames exporter/index-electron.js to exporter/index.js (gulpfile.js,
// electronExporterRenameTask). This re-export lets `import "./exporter"` resolve in the
// source tree to the module the editor and the CLI really load.

export * from "./index-electron.js";
