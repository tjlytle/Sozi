import {app, BrowserWindow, ipcMain} from "electron";
import * as remoteMain from "@electron/remote/main";
import settings from "electron-app-settings";
import {DEFAULT_SIZE, DEFAULT_TIMEOUT_S, parseArgs, parseSize, sizeError} from "./cli/args";
import {COMMAND_FLAGS} from "./cli";
import {cliSwitches, processGoneLine} from "./cli/switches";

remoteMain.initialize();

// Keep a global reference of the window object, if you don't, the window will
// be closed automatically when the JavaScript object is garbage collected.
let mainWindow;

const webPreferences = {
    nodeIntegration: true,
    contextIsolation: false,
    sandbox: false,
    spellcheck: false
};

function createWindow() {
    // This sets the initial window size.
    // If Sozi has been opened before, the size and location will be
    // loaded from local storage in backend/Electron.js.
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences
    });

    remoteMain.enable(mainWindow.webContents);

    mainWindow.setMenuBarVisibility(false);

    if (process.env.SOZI_DEVTOOLS) {
        mainWindow.webContents.openDevTools();
    }

    mainWindow.loadURL(`file://${__dirname}/../index.html`);

    mainWindow.on("leave-html-full-screen", () => {
        mainWindow.setMenuBarVisibility(false);
    });

    // Emitted when the window is closed.
    mainWindow.on("closed", () => {
        // Dereference the window object, usually you would store windows
        // in an array if your app supports multi windows, this is the time
        // when you should delete the corresponding element.
        mainWindow = null;
    });
}

// Workaround for launching error "GPU process isn't usable. Goodbye."
// See issue https://github.com/sozi-projects/Sozi/issues/603
app.commandLine.appendSwitch("disable-gpu-sandbox");

// Color correct rendering (on by default).
if (!settings.has("enableColorCorrectRendering")) {
    settings.set("enableColorCorrectRendering", true);
}

if (!settings.get("enableColorCorrectRendering")) {
    app.commandLine.appendSwitch("disable-color-correct-rendering");
}

// Hardware acceleration (on by default).
if (!settings.has("enableHardwareAcceleration")) {
    settings.set("enableHardwareAcceleration", true);
}

if (!settings.get("enableHardwareAcceleration")) {
    app.disableHardwareAcceleration();
}

// Command-line mode: run a command in a hidden window, print one JSON
// document on stdout and exit. All exits go through cliExit(), and
// app.exit() because Electron ignores process.exitCode.
const cliArgs = parseArgs(process.argv, COMMAND_FLAGS);

const CLI_USAGE =
    "sozi --cli <inspect|build|set|render|export> [options] <file.svg>; " +
    "sozi --cli notes <export|import> <file.sozi.json> [file.md]";

let cliExiting = false;

/** Print the result of the command line and exit; only the first call has an effect.
 *
 * @param {number} code - The exit code.
 * @param {object} result - The fields of the result; missing base fields get default values.
 */
function cliExit(code, result) {
    if (cliExiting) {
        return;
    }
    cliExiting = true;
    const base = {
        ok: false,
        command: cliArgs.command,
        svg: null,
        presentation: null,
        warnings: [],
        errors: [],
        error: null
    };
    process.stdout.write(JSON.stringify(Object.assign(base, result)) + "\n", () => app.exit(code));
}

/** Append the Chromium switches of command-line mode, and report lost helper processes. */
function setUpCliChromium() {
    // These override the same switches given on the command line.
    for (const [name, value] of cliSwitches(process.platform)) {
        app.commandLine.appendSwitch(name, value);
    }

    // Chromium restarts or falls back from a lost GPU or utility process, so the command
    // may still succeed: say so on stderr, so that a run that ends without JSON shows why.
    app.on("child-process-gone", (event, details) => {
        if (details.reason !== "clean-exit") {
            process.stderr.write(processGoneLine(details) + "\n");
        }
    });
}

function cliMain() {
    // Stdout holds the JSON result only, which cliExit() writes directly. Libraries log
    // there too (electron-app-settings prints "changed" whenever another Sozi process
    // rewrites the shared settings file), so send their lines to stderr.
    console.log = console.info = console.debug = console.error;

    setUpCliChromium();

    if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        cliExit(2, {error: "no display; run under xvfb-run"});
        return;
    }

    if (cliArgs.command === null || cliArgs.flags.help) {
        cliExit(2, {
            error: cliArgs.command === null ? "missing command" : "help requested",
            usage: CLI_USAGE
        });
        return;
    }

    // A value-taking flag given without a value is parsed as true.
    for (const name of ["size", "timeout"]) {
        if (Object.hasOwn(cliArgs.flags, name) && typeof cliArgs.flags[name] !== "string") {
            cliExit(2, {error: `missing value for --${name}`});
            return;
        }
    }

    const size = parseSize(cliArgs.flags.size || DEFAULT_SIZE);
    if (!size) {
        cliExit(2, {error: sizeError(cliArgs.flags.size)});
        return;
    }

    const timeout = Number(cliArgs.flags.timeout || DEFAULT_TIMEOUT_S);
    if (!(timeout > 0)) {
        cliExit(2, {
            error: `invalid --timeout: ${cliArgs.flags.timeout}; expected a number of seconds`
        });
        return;
    }
    // setTimeout fires at once beyond 2^31 - 1 ms (about 24.8 days).
    setTimeout(
        () => cliExit(1, {error: `timed out after ${timeout} s`}),
        Math.min(timeout * 1000, 2 ** 31 - 1)
    );

    process.on("uncaughtException", err => {
        process.stderr.write(`${err.stack || err}\n`);
        cliExit(1, {error: String(err)});
    });

    ipcMain.on("sozi-cli:result", (event, {code, json}) => {
        cliExit(code, JSON.parse(json));
    });

    ipcMain.on("sozi-cli:log", (event, line) => {
        process.stderr.write(line + "\n");
    });

    app.on("ready", () => {
        // The renderer cannot rely on its own process.cwd(), so pass ours.
        const options = Object.assign({cwd: process.cwd()}, cliArgs);
        mainWindow = new BrowserWindow({
            show: false,
            width: size.width,
            height: size.height,
            webPreferences: Object.assign(
                {
                    backgroundThrottling: false,
                    additionalArguments: ["--sozi-cli=" + JSON.stringify(options)]
                },
                webPreferences
            )
        });

        remoteMain.enable(mainWindow.webContents);

        mainWindow.webContents.on("render-process-gone", (event, details) => {
            cliExit(1, {error: `renderer process gone: ${details.reason}`});
        });

        mainWindow.webContents.on(
            "did-fail-load",
            (event, errorCode, errorDescription, validatedURL, isMainFrame) => {
                if (isMainFrame) {
                    cliExit(1, {
                        error: `editor failed to load: ${errorDescription} (${errorCode}) ${validatedURL}`
                    });
                }
            }
        );

        mainWindow.loadURL(`file://${__dirname}/../index.html`);
    });
}

if (cliArgs.cli) {
    cliMain();
} else {
    // This method will be called when Electron has finished
    // initialization and is ready to create browser windows.
    // Some APIs can only be used after this event occurs.
    app.on("ready", createWindow);
}

// Quit when all windows are closed.
app.on("window-all-closed", () => {
    // On OS X it is common for applications and their menu bar
    // to stay active until the user quits explicitly with Cmd + Q
    if (process.platform !== "darwin") {
        app.quit();
    }
});

app.on("activate", () => {
    // On OS X it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (mainWindow === null && !cliArgs.cli) {
        createWindow();
    }
});
