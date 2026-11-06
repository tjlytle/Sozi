# Presenter protocol

The display (the audience window that plays the deck) and a presenter surface talk through
`postMessage`. Every message is built, validated and sent by `src/js/protocol/`
(standard 2.5):

| Module                              | What it holds                                                     |
| ----------------------------------- | ----------------------------------------------------------------- |
| `src/js/protocol/messages.js`       | The names, a builder per message and `readMessage`.               |
| `src/js/protocol/viewport.js`       | The `viewport` message.                                           |
| `src/js/protocol/layoutPresets.js`  | The layout presets a deck carries: their names and their shape.   |
| `src/js/protocol/LocalTransport.js` | The transport between two windows of one browser.                 |
| `src/js/protocol/TransportSet.js`   | Several transports acting as one.                                 |
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
| `key`         | display → surface | `key`, `modifiers`                                        |
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
| `layouts`    | object of presets, by name      | The deck's layout presets, in the deck's order.   |

A surface's `hello` carries `role` only. The display says `hello` when it has loaded, and
answers every surface `hello` with a fresh one, so a surface that loads or reloads after the
display gets the whole state in one message and needs no replay. A display ignores another
display's `hello`: a deck that is not in a presenter is bound to its own window, and `role`
keeps it from answering itself.

`layouts` is new. A `hello` without it reads as no presets, so a newer surface can join an
older deck, and a surface that does not know it ignores it. A bad preset is dropped, never
the whole `hello`.

A preset's name starts with a letter and holds only letters, digits, `-` and `_`: a numeric
key would jump to the front of a JSON object, and the order decides which preset wins. A
preset is:

```json
{"match": "phone", "layout": {"version": 1, "dock": {}, "rail": [{"id": "next", "group": "2"}]}}
```

`match` is `"phone"` (a page up to 600 CSS pixels wide), `"laptop"` (wider than that) or
`{"minWidth": n}` (at least n pixels). `dock` is the dock as dockview's `toJSON` writes it,
and `rail` the panels waiting on the rail. A surface takes the first preset that matches and
that it can use, unless the device has saved a layout of its own for that width.

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
link clicks are reported as `followLink`; otherwise its links are disabled. Every key
pressed in it is reported as `key`. A preview reports nothing else about itself but its
`hello`.

### `followLink`

Follow the link element with this `id`, as if it was clicked. The current preview sends
it to the presenter, which sends it on to the display.

### `key`

A key was pressed in a preview. `key` is the key as `KeyboardEvent.key` names it, a
non-empty string; `modifiers` is `{shift, alt, ctrl, meta}`, four booleans. Decks opened
from a file have opaque origins, so the presenter cannot listen inside its preview frames;
this message lets the presentation keys work while a preview has the focus. The presenter
turns it into `next`, `previous`, `jumpToFrame` or `blank` for the display, exactly as a
key pressed on its own page, and ignores any other key.

### `custom`

A message of an add-on's own: `type` is a non-empty string, `data` anything
`postMessage` can clone. The display emits it as `DisplayChannelEvents.custom` and sends
one with `sendCustom(type, data)`. Add-ons use them through the [API](#api).

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

A `TransportSet` holds several. The display broadcasts on all of them and answers a `hello`
on the one it came from. A surface sends each command to its primary alone, the most
recently added `connected` one, because `next` sent on two links to one display would move
two frames. Both hear from every member. The set's `status` is the best of its members'.

An add-on's transport has what `LocalTransport` has:

| Member                  | What it does                                                        |
| ----------------------- | ------------------------------------------------------------------- |
| `status`                | `connected`, `reconnecting`, `stale` or `closed`.                   |
| `send(message)`         | Sends a message; returns false if it could not.                     |
| `onMessage(handler)`    | Calls `handler(data)` for each message; returns a function that stops. |
| `on` / `off`            | Add and remove a listener for `statusChange`, which carries the status. |
| `dispose()`             | Closes it.                                                          |

## API

A deck's custom CSS or JS file has a target: `display` (the default), `presenter` or
`both`. In the presentation file a `display` file is the plain string it always was, and
any other is `{path, target}`. Each page inlines its files after its own script, so a
custom script runs before `load`. Both APIs exist by then, and a call made before `load`
waits for it, in the order it came.

### `window.sozi.presenter`, on the presenter page

| Member                                            | What it does                                     |
| ------------------------------------------------- | ------------------------------------------------ |
| `registerPanel({id, title, icon, render, defaults})` | Adds a panel. `render(element)` draws it, once, and may return its cleanup. |
| `registerPanel({id, title, icon, url, defaults})` | Adds a panel that embeds a page: `http:`, `https:` or relative. |
| `on(name, handler)` / `off(name, handler)`        | `frameChange` (the frame), `viewport` (the size), `status`, and `message` (every valid message). |
| `state`                                           | `{frame, frameCount, viewport, blank, status}`, for a panel that registers late. |
| `display.jumpToFrame(index)`, `next()`, `previous()`, `blank(on)` | Commands, to the primary transport.     |
| `display.send(name, payload)`                     | A `custom` message, to the primary transport.    |
| `registerTransport(transport)`                    | Adds a transport, after the audience window's, and says `hello` on it. |

A bad panel throws a `TypeError` naming the field; so does an id already taken. The built-in
panels go through `registerPanel` too, first, so their ids (`current`, `notes`, `connection`,
`controls`, `previous`, `next`) can be named in a panel's place. `icon` is the text of its
button on the rail, by default the title's first letter. `defaults` is its place in the
default layout, `{position, inactive, initialHeight}`, with `position` as dockview's
`addPanel` takes it. Without `defaults` the panel is a tab behind Notes.

A panel is remembered in the saved layout with the others. A saved layout must name exactly
the panels of the page, so adding or removing a panel starts from the default layout again,
and a panel registered after `load` is not there yet when the next load reads the layout:
register at the top level of the script.

### `window.sozi.display`, on the presentation page

| Member                                     | What it does                                               |
| ------------------------------------------ | ---------------------------------------------------------- |
| `registerTransport(transport)`             | Adds a transport and says `hello` on it.                   |
| `send(name, payload)`                      | A `custom` message, on every transport.                    |
| `on("custom", handler)` / `off`            | Calls `handler(type, data)` for a `custom` message from a surface. |
| `registerPairing({render})`                | What `Q` shows; a second one replaces the first.           |

`Q` calls `render(element, display)` and shows the overlay; `Escape` or `Q` again hides it
and empties the element. With no pairing registered, `Q` does nothing.

A presenter's three previews are the same page in iframes, so a `display` script runs in
them too. In a preview `Q` does nothing, and the script's own transports and `send` still
work.

`window.sozi.presentation`, `viewport`, `player` and `playerController` are undefined until
`load`.

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
