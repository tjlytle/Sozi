# Presenter protocol

The display (the audience window that plays the deck) and a presenter surface talk through
`postMessage`. Every message is built, validated and sent by `src/js/protocol/`
(standard 2.5):

| Module                              | What it holds                                                     |
| ----------------------------------- | ----------------------------------------------------------------- |
| `src/js/protocol/messages.js`       | The names, a builder per message and `readMessage`.               |
| `src/js/protocol/viewport.js`       | The `viewport` message.                                           |
| `src/js/protocol/LocalTransport.js` | The transport between two windows of one browser.                 |
| `src/js/protocol/legacy.js`         | The names used before this protocol, mapped onto it (one release). |

The display side is `src/js/player/DisplayChannel.js`; the presenter console
(`src/js/presenter.js`) is the first surface.

## Messages

A message is an object with a `name` and its fields beside it. `readMessage` refuses a
message with an unknown name or a malformed field, and drops fields that are not part of
the message.

| Name          | Direction         | Fields                                                    |
| ------------- | ----------------- | --------------------------------------------------------- |
| `hello`       | both ways         | `role`; from a display, its state (below)                 |
| `frameChange` | display → surface | `index`, `id`, `title`, `notes`                           |
| `viewport`    | display → surface | `width`, `height`, `pixelRatio`                           |
| `blank`       | both ways         | `on`                                                      |
| `next`        | surface → display | `transition`                                              |
| `previous`    | surface → display | `transition`                                              |
| `jumpToFrame` | surface → display | `index`, `transition`                                     |
| `preview`     | surface → display | `current`                                                 |
| `followLink`  | both ways         | `id`                                                      |
| `custom`      | both ways         | `type`, `data`                                            |

### `hello`

| Field        | Type                            | Meaning                                           |
| ------------ | ------------------------------- | ------------------------------------------------- |
| `role`       | `"display"` or `"surface"`      | Who says it.                                      |
| `deckId`     | string                          | The deck's file name without `.sozi.html`.        |
| `frameCount` | integer ≥ 0                     | How many frames the deck has.                     |
| `viewport`   | `{width, height, pixelRatio}` or null | The display's size; null while it is minimised. |
| `frame`      | `{index, id, title, notes}`     | The current frame.                                |
| `blank`      | boolean                         | Is the blank screen shown?                        |

A surface's `hello` carries `role` only. The display says `hello` when it has loaded, and
answers every surface `hello` with a fresh one, so a surface that loads or reloads after the
display gets the whole state in one message and needs no replay. A display ignores another
display's `hello`: a deck that is not in a presenter is bound to its own window, and `role`
keeps it from answering itself.

### `frameChange`

The display has moved to another frame. `index` counts from 0, `id` is the frame's id,
`title` its title and `notes` the presenter's notes as HTML.

### `viewport`

The size of the audience window, so the previews can take the same shape. `width` and
`height` are in CSS pixels, `pixelRatio` is device pixels per CSS pixel. The display sends
it every time its window is resized. The receiver accepts it only when all three numbers
are positive and finite; a minimised window reports a zero size and is ignored.
`pixelRatio` is not used for the shape.

### `blank`

From a surface: show (`on: true`) or hide the blank screen. From the display: the blank
screen was shown or hidden, by any means. Moving to a frame hides it.

### `next`, `previous`, `jumpToFrame`

Go to the next frame, the previous one, or the frame at `index` (from 0). `transition`
defaults to `true`; `false` jumps straight there without the animation (the presenter
sends `false` when Shift is held). The presenter's Home and End send `jumpToFrame` with
0 and `frameCount - 1`.

### `preview`

Sent by the presenter to each of its preview frames. The deck stops its media and its
keyboard and mouse navigation, hides frame numbers, and from then on takes `next`,
`previous`, `jumpToFrame` and `blank` directly on its player. With `current: true` its
link clicks are reported as `followLink`; otherwise its links are disabled. A preview
reports nothing about itself but its `hello`.

### `followLink`

Follow the link element with this `id`, as if it was clicked. The current preview sends
it to the presenter, which sends it on to the display.

### `custom`

A message of an add-on's own: `type` is a non-empty string, `data` anything
`postMessage` can clone. The display emits it as `DisplayChannelEvents.custom` and sends
one with `sendCustom(type, data)`.

## Transport

`LocalTransport(host, target)` links the window the code runs in to one other window. It
hands on only the messages whose `source` is `target`; a message from any other window,
the surface's own included, is ignored. It posts with `"*"` because a deck opened from a
file has an opaque origin.

Its `status` is `connected` until `target` is closed, then `closed`, with a `statusChange`
event. A transport over a network will add `reconnecting` and `stale`; a window in the
same browser is never in either. It looks at `target.closed` on each send and once a second. `dispose()` removes its
listener and its timer.

When `target` is `host` (a deck opened on its own, not by a presenter nor in a frame), the
transport posts nothing and still hands on what the page posts to itself, so code in the
page can drive the deck with `window.postMessage`.

## Legacy names

For one release (removed in the release after 24.11) the display also understands the
names it took before this protocol, and still sends `{name: "loaded", length}` once it has
loaded.

| Old message                                  | Maps to                                 |
| -------------------------------------------- | --------------------------------------- |
| `notifyOnFrameChange`                        | `hello` from a surface, then `frameChange` and `viewport` |
| `{name: "jumpToFrame", args: [frame]}`       | `jumpToFrame {index, transition: false}` |
| `{name: "moveToFrame", args: [frame]}`       | `jumpToFrame {index, transition: true}` |
| `moveToNext` / `jumpToNext`                  | `next` with / without transition        |
| `moveToPrevious` / `jumpToPrevious`          | `previous` with / without transition    |
| `moveToFirst` / `jumpToFirst`                | `jumpToFrame` 0 with / without transition |
| `moveToLast` / `jumpToLast`                  | `jumpToFrame` to the last frame, with / without transition |
| `enableBlankScreen`                          | `blank {on: true}`                      |
| `toggleBlankScreen`                          | `blank` with the opposite of the current state |
| `{name: "setPresenterMode", isCurrent}`      | `preview {current: isCurrent}`          |
| `{name: "click", id}`                        | `followLink {id}`                       |
| `loaded`                                     | nothing (the display sends it, never acts on it) |

An old presenter waits for `frameChange` and `viewport` after `notifyOnFrameChange` and
ignores `hello`, so the display sends both straight after its `hello`, as it used to.
The `frame` in `args` is an index or a frame id; an id is resolved to its index, and one
that names no frame is not mapped. Any other name, including any other controller method,
is logged as `Unsupported message` and ignored.
