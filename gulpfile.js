/* The build: each concern lives in a module under gulp/; this file puts them together. */

const {series, parallel} = require("gulp");
const {translationsTask} = require("./gulp/i18n.js");
const {nodePackageTask} = require("./gulp/manifest.js");
const bundle = require("./gulp/bundle.js");
const {makeTemplateTask} = require("./gulp/templates.js");
const {shellBuildTask} = require("./gulp/shell.js");
const {
    electronLinuxPackageTask,
    electronWindowsPackageTask,
    electronMacOSPackageTask,
    electronMacOSCompressTask
} = require("./gulp/package.js");
const {extrasMediaCompressTask} = require("./gulp/extras.js");
const {jsdocTask} = require("./gulp/jsdoc.js");

const electronTemplatesTask = parallel(
    makeTemplateTask("electron", "player"),
    makeTemplateTask("electron", "presenter")
);

const browserTemplatesTask = parallel(
    makeTemplateTask("browser", "player"),
    makeTemplateTask("browser", "presenter")
);

const electronBuildTask = parallel(
    bundle.electronCssCopyTask,
    bundle.electronIndexRenameTask,
    series(
        nodePackageTask("electron", {main: "src/js/index-electron.js"}),
        translationsTask("electron"),
        bundle.electronTranspileTask,
        bundle.electronBackendIndexRenameTask,
        bundle.electronExporterRenameTask
    ),
    series(
        translationsTask("browser"),
        bundle.browserTranspileTask,
        bundle.playerBrowserifyTask,
        electronTemplatesTask
    )
);

const browserBuildTask = parallel(
    bundle.browserCssCopyTask,
    bundle.browserFaviconCopyTask,
    bundle.browserIndexRenameTask,
    series(
        nodePackageTask("browser"),
        translationsTask("browser"),
        bundle.browserTranspileTask,
        parallel(
            series(
                bundle.browserBackendIndexRenameTask,
                bundle.browserExporterRenameTask,
                bundle.browserEditorBrowserifyTask
            ),
            series(bundle.playerBrowserifyTask, browserTemplatesTask)
        )
    )
);

const electronDistTask = series(
    electronBuildTask,
    parallel(
        electronLinuxPackageTask,
        electronWindowsPackageTask,
        series(electronMacOSPackageTask, electronMacOSCompressTask)
    )
);

exports.browserBuild = browserBuildTask;
exports.electronBuild = electronBuildTask;

exports.shell = shellBuildTask;
exports.default = series(electronBuildTask, shellBuildTask);

exports.package = electronDistTask;

// The Linux AppImage alone, for CI: the Windows target needs Wine.
exports.packageLinux = series(electronBuildTask, electronLinuxPackageTask);

exports.extras = extrasMediaCompressTask;

exports.all = parallel(electronDistTask, extrasMediaCompressTask);

exports.jsdoc = jsdocTask;
