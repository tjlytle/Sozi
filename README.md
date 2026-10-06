
![Github Downloads (latest)](https://img.shields.io/github/downloads/sozi-projects/Sozi/latest/total.svg?style=flat-square)
![Github Downloads (total)](https://img.shields.io/github/downloads/sozi-projects/Sozi/total.svg?style=flat-square)

Sozi is a presentation tool for SVG documents.

It is free software distributed under the terms of the
[Mozilla Public License 2.0](https://www.mozilla.org/MPL/2.0/).

More details can be found on the official web site: <http://sozi.baierouge.fr>

Building and installing Sozi from sources
=========================================

Get the source files
--------------------

Clone the repository:

    git clone git://github.com/sozi-projects/Sozi.git


Install the build tools and dependencies
----------------------------------------

The following instructions work successfully in Ubuntu 22.04.

Install [Node.js](http://nodejs.org/) and Gulp.
The build script for Sozi is known to work with Node.js 14 from [Nodesource](https://github.com/nodesource/distributions).

    sudo apt install nodejs
    sudo npm install --global gulp-cli

From the root of the source tree, run:

    npm install

If you plan to build a Windows executable, also install *wine*.
In Debian/Ubuntu and their derivatives, you can type the following commands.

    dpkg --add-architecture i386
    sudo apt update
    sudo apt install wine wine32

If you plan to build Debian packages, install the following additional packages:

    sudo apt install devscripts debhelper

If you plan to build Redhat packages, install the following additional packages:

    sudo apt install rpm

If you plan to build Archlinux packages, install the following additional packages:

    sudo apt install libarchive-tools

The `zip` compression tool must also be installed:

    sudo apt install zip

Get the binaries for ffmpeg (optional, but video export will not work without them).
Download and unzip the FFMPEG executables to the following folders:

* Linux 32-bit: `resources/ffmpeg/linux-ia32`
* Linux 64-bit: `resources/ffmpeg/linux-x64`
* Windows 32-bit: `resources/ffmpeg/win32-ia32`
* Windows 64-bit: `resources/ffmpeg/win32-x64`
* MacOS X 64-bit: `resources/ffmpeg/darwin-x64`

Build
-----

To build and run the desktop application without packaging it,
run the following commands from the root of the source tree.
At startup, Sozi will show an error notification that can be ignored.

```
gulp
npm start
```

To build and package the desktop application for all platforms, do:

```
gulp all
```

After a successful build, you will get a `build/dist` folder that contains the
generated application archives for each platform.

Command line
------------

Sozi can run without its editor window to inspect a presentation, to
build its HTML files or to change its properties, for scripts and continuous
integration.
Each run prints exactly one JSON document on the standard output;
logs go to the standard error. Every document has the fields `ok`, `command`,
`svg`, `presentation`, `warnings`, `errors` and `error` (`null` on success);
messages are always in English.

```
sozi --cli inspect [--frame N] [--out-dir DIR] [--presentation P.sozi.json] deck.svg
sozi --cli build [--write-json] [--title TITLE] [--out-dir DIR] [--presentation P.sozi.json] deck.svg
sozi --cli set [--title TITLE] [--out-dir DIR] [--presentation P.sozi.json] deck.svg
```

The file argument may also be a presentation file, e.g.
`sozi --cli build talk.sozi.json` (see
[Several presentations from one SVG](#several-presentations-from-one-svg)).

When running from the source tree, replace `sozi` with
`node_modules/.bin/electron build/electron` (after `gulp`).

* `--cli inspect` loads `deck.svg` and `deck.sozi.json` and reports the
  title (with `titleSource`, see below, and `svgTitle`, the title of the SVG
  document or `""`), the aspect ratio, the layers of the SVG (with `inJson` telling whether
  the JSON file has properties for each layer), `svgSource` (`"json"` when the
  `svg` key of the presentation file named the SVG, `"flag"` with
  `--presentation`, else `"default"`), `outputDir` and `outputSource` (see
  [Output directory](#output-directory)) and, for each frame, its
  properties and, for each layer, the reference element (`referenceMissing` is
  true when the element is not in the SVG), the outline element, the link
  flag and the camera. It writes no file.
* `--frame N` restricts the frames reported by `inspect` to one frame, given by
  its 0-based index or its frame id.
* `--cli build` writes `deck.sozi.html` and `deck-presenter.sozi.html`, and
  reports the files written (in `files`, with their real paths) and the number of frames.
  It warns when the SVG is newer than an existing `deck.sozi.html`.
  It writes `deck.sozi.json` only when the file does not exist or when loading
  or `--title` changed the presentation, because a load/save round trip is not byte-stable.
* `--write-json` makes `build` always rewrite `deck.sozi.json`.
* `--cli set` changes properties of the presentation and writes
  `deck.sozi.json` (no HTML file). It reports in `changed` the old and new
  value of each property that changed, e.g.
  `"changed": {"title": {"from": "", "to": "My Talk"}}`, and in `files` the
  files written. It writes `deck.sozi.json` only when the file does not exist
  or when loading or an option changed the presentation, so setting a
  property to its current value usually writes nothing. At least one option is required.
* `--title TITLE` (for `build` and `set`) sets the explicit title of the
  presentation in `deck.sozi.json`; `build` then writes the JSON file and the
  HTML files with the new title. `--title ""` (or `--title=`) removes the
  explicit title. Use `--title=TITLE` for a title that starts with `--`.
* `--out-dir DIR` (for `build`, `set` and `inspect`) is the directory of the
  HTML files; see [Output directory](#output-directory).
* `--presentation P.sozi.json` (for every command, with an SVG file argument)
  names the presentation file instead of `deck.sozi.json`; see below.
* `--size WxH` sets the size of the hidden window (default `1280x720`).
* `--timeout S` stops the command after `S` seconds (default `120`) with exit code 1.

Options go after the command. An unknown option, an option without its value
or an extra file argument is a usage error.

The title of a presentation, used in the HTML files, in the browser tab of
the player and in the editor window, is the first of:

1. the explicit title stored in `deck.sozi.json` (set with `--title` or in the
   presentation properties of the editor) — `titleSource` `"json"`;
2. the title of the SVG document — `titleSource` `"svg"`; in Inkscape, set it
   under *Document Properties > Metadata > Title*;
3. `Untitled` — `titleSource` `"default"`.

The title of the SVG document is never copied into `deck.sozi.json`.

The file name must have an extension: by default, the presentation file is the SVG file
name with its extension replaced by `.sozi.json`.

### Several presentations from one SVG

A presentation file can have any name ending in `.sozi.json`, so one SVG
document can have several presentations, e.g. a short and a long talk or one
per language. Only a file ending in `.sozi.json` is a presentation file: another
`.json` file is refused, even beside an SVG of the same name (exit code 1 on the
command line, an error in the editor), and nothing is written. The editor's file
chooser lists every `.json` file because it cannot filter on a double extension.
Name the presentation file with `--presentation`; if it does not
exist, it is created from the SVG like `deck.sozi.json` on the first open:

```
sozi --cli build --presentation talk-es.sozi.json deck.svg
sozi --cli build --presentation es/spanish.sozi.json deck.svg
```

The output names follow the presentation file, not the SVG, and the HTML files
are written beside it: `talk-es.sozi.json` gives `talk-es.sozi.html` and
`talk-es-presenter.sozi.html`. `deck.sozi.html` is not written.

A presentation file records its SVG document in the key `svg`, a path relative
to the directory of the presentation file, e.g. `"svg": "../deck.svg"` in
`es/spanish.sozi.json`. Without the key, the SVG document is `<base>.svg`
beside the presentation file, so `deck.sozi.json` never gets one. A
presentation file can then be opened directly, on the command line
(`sozi --cli inspect es/spanish.sozi.json`) and in the editor
(`sozi es/spanish.sozi.json`, or choose it in the file chooser).
Opening a presentation file with another SVG document (e.g.
`--presentation talk.sozi.json other.svg`, or opening `deck.svg` when
`deck.sozi.json` names another SVG) rewrites its `svg` key, with the warning
`svg key changed from X to Y` (an info notification in the editor).

In the editor, images, media and custom CSS and JavaScript files keep their
paths relative to the SVG document. When the HTML is written in another
directory than the SVG (a presentation file in a subdirectory, or an
[output directory](#output-directory)), the relative image and media hrefs
of the generated HTML are rewritten to resolve from the HTML.

A presentation file that is not JSON or has no `frames` array
(`not a presentation file: <path>: <reason>`), a `.json` file argument that does
not end in `.sozi.json`, a presentation file without an `svg` key and without
`<base>.svg` beside it, or whose `svg` key names a missing file, is an error (exit code 1);
`--presentation` naming a directory or a file that does not end in `.sozi.json`, or given with a
presentation file argument, is a usage error (exit code 2).

### Output directory

By default the HTML files are written beside the presentation file. To write
them in another directory, e.g. a web site:

```
sozi --cli build --out-dir site/talk deck.svg        # this build only
sozi --cli set --out-dir site/talk deck.svg          # store it in deck.sozi.json
sozi --cli build deck.svg                            # then every build uses it
sozi --cli set --out-dir "" deck.svg                 # back to beside the presentation
```

* `--out-dir DIR` is relative to the working directory. With `build`, it
  applies to this run only and does not change the presentation file; it
  overrides the stored directory.
* `set --out-dir DIR` stores the directory in the key `outputDir` of the
  presentation file, as a path relative to the directory of the presentation
  file with forward slashes, e.g. `"outputDir": "site/talk"` or `"../site"` in
  `es/spanish.sozi.json`. `--out-dir ""` removes the key. Nothing else adds
  the key, so existing presentation files are unchanged. The editor also writes its HTML files to the
  stored directory when it saves.
* Both HTML files go to the output directory, which is created if missing.
  The presentation file stays beside the SVG or where `--presentation` put it,
  and the SVG document is not copied.
* In the generated HTML, the relative hrefs of images and media (`href` and
  `xlink:href` of `<image>` elements, `sozi:src` of video and audio) are
  rewritten so that they resolve from the output directory, e.g.
  `img/dot.png` becomes `../../img/dot.png` in `site/talk`. Absolute paths,
  URLs with a scheme (`http:`, `data:`, ...) and `#` fragments are kept.
  Custom CSS and JavaScript files are inlined in the HTML, but `url(...)`
  references inside custom CSS are **not** rewritten: use absolute URLs there,
  or copy the files they point to next to the HTML.
* `inspect` reports `outputDir`, the absolute directory that `build` would
  use, and `outputSource`: `"flag"` for `--out-dir`, `"json"` for the stored
  key, or `"default"` with `outputDir` `null` (beside the presentation file).
* An output directory that is (or is inside) an existing file is a usage
  error (exit code 2), and nothing is written.

### Exit codes

| Code | Meaning                                                                                       |
|:-----|:----------------------------------------------------------------------------------------------|
| `0`  | Success (`"ok": true`).                                                                       |
| `1`  | The command failed: missing or invalid file, unparsable JSON, missing SVG of a presentation file, unknown frame, write error, timeout, crash. |
| `2`  | Usage or environment error: unknown command or option, missing file argument or option value, extra argument, `set` without an option, invalid `--presentation`, output directory that is a file, no display. |

Sozi is an Electron application, so it needs a display even in command-line
mode. Without one (`DISPLAY` and `WAYLAND_DISPLAY` unset) it exits with code 2.
On a headless machine, use a virtual X server such as `xvfb-run`.
`xvfb-run` sends the standard error of the command to its standard output,
which would mix Chromium messages into the JSON; redirect the standard error
inside the command:

```
xvfb-run -a sh -c "sozi --cli build deck.svg 2>/dev/null"
xvfb-run -a sh -c "sozi --cli inspect deck.svg 2>err.log"
```

Close the deck in the Sozi editor before running a command on it: the editor
watches and saves the same files, so it would reload or overwrite what
`build` writes.

Helping debug Sozi
==================

While Sozi is running, press `F12` to open the developer tools.
Check the *Console* tab for error messages.

Some environment variables will enable debugging features in Sozi.
When running Sozi from the command line, you can add one
or more variable assignments like this:

```
SOME_VAR=1 SOME_OTHER_VAR=1 sozi my-presentation.svg
```

Where `SOME_VAR` and `SOME_OTHER_VAR` are variable names from the
first column of this table:

| Variable                               | Effect                                                                                                                                   |
|:---------------------------------------|:-----------------------------------------------------------------------------------------------------------------------------------------|
| `ELECTRON_ENABLE_LOGGING`              | Display JavaScript console messages in the current terminal window.                                                                      |
| `SOZI_DEVTOOLS`                        | Open the developer tools immediately. This can be useful if `F12` has no effect or when you want to debug events that happen at startup. |

