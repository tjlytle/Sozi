/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// Electron main script for the exporter tests: calls an export function of
// the built exporter module in the main process and prints one JSON line:
// {ok, result | error, elapsedMs, windows} where `windows` is the number of
// windows still open after the export.
//
// Usage: electron export-main.js <exporter module> <JSON {fn, presentation, html, opts} | @file>

const {app, BrowserWindow} = require("electron");

const [modulePath, argsJSON] = process.argv.slice(-2);

// Closing the export window must not quit the application.
app.on("window-all-closed", () => {});
app.commandLine.appendSwitch("disable-gpu-sandbox");

app.on("ready", async () => {
    const start = Date.now();
    let report;
    try {
        const json = argsJSON.startsWith("@") ? require("fs").readFileSync(argsJSON.slice(1), "utf8") : argsJSON;
        const {fn, presentation, html, opts} = JSON.parse(json);
        const exporter = require(modulePath);
        const result = await exporter[fn](presentation, html, opts);
        report = {ok: true, result};
    }
    catch (err) {
        report = {ok: false, error: String(err && err.message || err)};
    }
    report.elapsedMs = Date.now() - start;
    report.windows = BrowserWindow.getAllWindows().length;
    process.stdout.write(JSON.stringify(report) + "\n", () => app.exit(0));
});
