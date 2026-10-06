
import {app, BrowserWindow, ipcMain} from "electron";
import * as remoteMain from "@electron/remote/main";
import settings from "electron-app-settings";
import {parseArgs} from "./cli/args";

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

function createWindow () {
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
// document on stdout and exit. All exits go through app.exit() because
// Electron ignores process.exitCode.
const cliArgs = parseArgs(process.argv);

function cliExit(code, result) {
    process.stdout.write(JSON.stringify(result) + "\n", () => app.exit(code));
}

function cliMain() {
    if (process.platform === "linux" && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
        cliExit(2, {ok: false, error: "no display; run under xvfb-run"});
        return;
    }

    if (cliArgs.command === null || cliArgs.flags.help) {
        cliExit(2, {ok: false, usage: "sozi --cli <inspect|build> [options] <file.svg>"});
        return;
    }

    const size = /^(\d+)x(\d+)$/.exec(cliArgs.flags.size || "1280x720");
    if (!size) {
        cliExit(2, {ok: false, error: `invalid --size: ${cliArgs.flags.size}; expected WxH`});
        return;
    }

    process.on("uncaughtException", err => {
        process.stderr.write(`${err.stack || err}\n`, () => app.exit(1));
    });

    ipcMain.on("sozi-cli:result", (event, {code, json}) => {
        process.stdout.write(json + "\n", () => app.exit(code));
    });

    ipcMain.on("sozi-cli:log", (event, line) => {
        process.stderr.write(line + "\n");
    });

    app.on("ready", () => {
        // The renderer cannot rely on its own process.cwd(), so pass ours.
        const options = Object.assign({cwd: process.cwd()}, cliArgs);
        mainWindow = new BrowserWindow({
            show: false,
            width: Number(size[1]),
            height: Number(size[2]),
            webPreferences: Object.assign({
                backgroundThrottling: false,
                additionalArguments: ["--sozi-cli=" + JSON.stringify(options)]
            }, webPreferences)
        });

        remoteMain.enable(mainWindow.webContents);

        mainWindow.webContents.on("render-process-gone", (event, details) => {
            process.stderr.write(`renderer process gone: ${details.reason}\n`, () => app.exit(1));
        });

        mainWindow.loadURL(`file://${__dirname}/../index.html`);
    });
}

if (cliArgs.cli) {
    cliMain();
}
else {
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
