/* Package the desktop application with electron-builder. */

const util = require("util");
const fs = require("fs");
const exec = util.promisify(require("child_process").exec);
const builder = require("electron-builder");
const {copyFile} = require("./files.js");
const {soziVersion} = require("./version.js");

/** Where the packages and the extras archives go. */
const distDir = "build/dist";

/** The electron-builder configuration of every platform. */
const builderOpts = {
    appId: "fr.baierouge.sozi",
    productName: "Sozi",
    directories: {
        app: "build/electron",
        output: distDir
    },
    files: ["**/*"],
    linux: {
        target: [
            "AppImage"
            // "rpm",
            // "deb",
            // "pacman"
        ],
        icon: "resources/icons/256x256.png",
        category: "Graphics;Office",
        mimeTypes: ["image/svg+xml"]
    },
    deb: {
        fpm: ["--deb-recommends=ffmpeg", "--deb-suggests=inkscape"]
    },
    rpm: {
        fpm: ["--rpm-rpmbuild-define=_build_id_links none"]
    },
    win: {
        target: "nsis",
        icon: "resources/icons/sozi.ico",
        signAndEditExecutable: true
    },
    nsis: {
        oneClick: false,
        allowToChangeInstallationDirectory: true
    },
    mac: {
        // Compression to tar.xz is performed in task electronMacOSCompressTask:
        // * DMG and pkg targets are not available when building in Linux.
        // * tar.xz target does not preserve symbolic links.
        // * zip target is fast but very inefficient.
        // * dir target does not execute afterPack hook.
        target: "zip",
        icon: "resources/icons/sozi.icns",
        category: "public.app-category.graphics-design"
    },
    afterPack(context) {
        return Promise.all(
            context.targets.map(target => {
                const platform = context.electronPlatformName;

                // In linux targets, electron-builder sets icon size to 0.
                // See issue https://github.com/electron-userland/electron-builder/issues/5294
                // Fix based on https://github.com/alephium/alephium-wallet/pull/41
                if (platform === "linux") {
                    target.helper.iconPromise.value = target.helper.iconPromise.value.then(icons =>
                        icons.map(icon => ({...icon, size: icon.size === 0 ? 256 : icon.size}))
                    );
                }

                // Copy FFMPEG to the current packaged application.
                const arch = builder.Arch[context.arch];
                const ffmpegBin = platform === "win32" ? "ffmpeg.exe" : "ffmpeg";
                const ffmpegSrc = `resources/ffmpeg/${platform}-${arch}/${ffmpegBin}`;
                const ffmpegDest =
                    platform === "darwin"
                        ? `${context.appOutDir}/Sozi.app/Contents/Resources/${ffmpegBin}`
                        : `${context.appOutDir}/resources/${ffmpegBin}`;
                return fs.existsSync(ffmpegSrc) ? copyFile(ffmpegSrc, ffmpegDest) : false;
            })
        );
    }
};

/**
 * Package the Linux AppImage.
 *
 * @returns {Promise<string[]>} Resolves with the files electron-builder wrote.
 */
function electronLinuxPackageTask() {
    return builder.build({
        targets: builder.Platform.LINUX.createTarget(),
        config: builderOpts,
        publish: "never"
    });
}

/**
 * Package the Windows installer.
 *
 * @returns {Promise<string[]>} Resolves with the files electron-builder wrote.
 */
function electronWindowsPackageTask() {
    return builder.build({
        targets: builder.Platform.WINDOWS.createTarget(),
        config: builderOpts,
        publish: "never"
    });
}

/**
 * Package the macOS application.
 *
 * @returns {Promise<string[]>} Resolves with the files electron-builder wrote.
 */
function electronMacOSPackageTask() {
    return builder.build({
        targets: builder.Platform.MAC.createTarget(),
        config: builderOpts,
        publish: "never"
    });
}

/**
 * Compress the macOS application to tar.xz, which keeps its symbolic links.
 *
 * @returns {Promise<object>} Resolves when the archive is written.
 */
function electronMacOSCompressTask() {
    return exec(`tar cJf ../Sozi-${soziVersion()}-mac.tar.xz Sozi.app`, {
        cwd: `${distDir}/mac`,
        stdio: "ignore"
    });
}

module.exports = {
    distDir,
    builderOpts,
    electronLinuxPackageTask,
    electronWindowsPackageTask,
    electronMacOSPackageTask,
    electronMacOSCompressTask
};
