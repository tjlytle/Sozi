# Writing a presenter panel

The presenter page (`deck-presenter.sozi.html`) is made of panels: the current frame, the
notes, the clock, and so on. You can add your own. Your panel docks, tabs, closes and is
saved in the layout like the built-in ones, and it is listed in the + Add panel menu. The
built-in panels are registered the same way.

This guide covers what you need to write one, and it ends with a complete example. For the
messages between the presentation and the presenter, see
[presenter-protocol.md](presenter-protocol.md).

## How an add-on ships

An add-on is a JavaScript file that is part of the deck, as a custom file. Each custom file has
a target, the page it runs on:

| Target      | Runs on                                          |
| ----------- | ------------------------------------------------ |
| `display`   | the presentation page, `deck.sozi.html` (the default) |
| `presenter` | the presenter page, `deck-presenter.sozi.html`   |
| `both`      | both pages                                       |

A panel is for the presenter page, so its target is `presenter`. To add the file:

- **In the editor:** in the properties panel, under "Custom stylesheets and scripts", add the
  file with the + button, then set its select to "Presenter".
- **By hand:** list it in `customFiles` in the deck's `.sozi.json`. An entry is a plain path for a
  `display` file, or `{"path": ..., "target": ...}` for any other. The path is relative to the
  SVG file.

  ```json
  {
    "customFiles": [{"path": "my-panel.js", "target": "presenter"}]
  }
  ```

Then build the deck. The editor writes both pages each time it saves the deck; from the command
line:

```sh
sozi --cli build deck.svg
```

The build copies the script into the page, after the presenter's own script. Edit the script
and build again to see a change.

## Registering a panel

On the presenter page the API is `window.sozi.presenter`. A panel is one call:

```js
window.sozi.presenter.registerPanel({
    id: "hello",
    title: "Hello",
    render(element) {
        element.textContent = "Hello from my panel";
    }
});
```

Call `registerPanel` at the top level of your script, as it loads, not from a timer or an event
handler. The page applies the speaker's saved layout once, at `load`. A panel registered after
that is still added, but at its default place, not where the speaker left it. A call made before
the page has finished loading waits for it, so you do not need to wait for `load` yourself.

### The fields of a panel

| Field         | Required | What it is |
| ------------- | -------- | ---------- |
| `id`          | yes      | A string that names the panel in the saved layout. Keep it the same from one version of your add-on to the next, or the speaker's layout loses the panel. It must not be one of the built-in ids: `current`, `notes`, `frames`, `connection`, `clock`, `controls`, `previous`, `next`. |
| `title`       | yes      | The text of its tab and of its entry in the + menu. |
| `icon`        | no       | A short string (one glyph) before the title in the menus. By default, the first letter of the title. |
| `description` | no       | One line under the title in the + menu. No line breaks. Empty by default. |
| `render`      | one of `render` or `url` | A function that draws the panel; see below. |
| `url`         | one of `render` or `url` | A page to show in the panel, in an iframe; see below. |
| `defaults`    | no       | Where the panel goes in the default layout; see below. |

A definition that is not valid throws a `TypeError` that names the field. So does an `id` that
is already registered.

### `render` and its cleanup

`render(element)` is called with an empty element when the panel is opened. Add your content to
it. If the panel listens to events or starts a timer, return a function that undoes that. It is
called when the speaker closes the panel. If the speaker opens it again from the + menu,
`render` is called again, on a new element.

```js
render(element) {
    const onFrame = frame => {
        element.textContent = frame.title;
    };
    window.sozi.presenter.on("frameChange", onFrame);
    return () => window.sozi.presenter.off("frameChange", onFrame);
}
```

Without the cleanup, a closed panel keeps listening, and every time it is reopened adds one more
listener.

`render` is also given a second argument, the panel's handle, for what the panel's ⋯ menu
does. A `render` that takes the element only keeps working.

| Member                         | What it does                                                      |
| ------------------------------ | ----------------------------------------------------------------- |
| `maximise()`                   | Fills the workspace with the panel, or brings the layout back if a panel fills it, as Maximise and Restore in the ⋯ menu do. |
| `maximised`                    | `true` while a panel fills the workspace.                         |
| `onMaximisedChange(listener)`  | Calls `listener` each time a panel fills the workspace or stops filling it; returns the function that stops it. Call that in your cleanup. |

```js
render(element, panel) {
    const button = document.createElement("button");
    const label = () => (button.textContent = panel.maximised ? "Restore" : "Maximise");
    button.addEventListener("click", () => panel.maximise());
    label();
    element.append(button);
    return panel.onMaximisedChange(label);
}
```

Put text on the page with `textContent`, not `innerHTML`: a frame title or a message is data,
and `innerHTML` would run any markup it holds. If `render` throws, the panel shows the error
instead of its content, and the other panels are not affected.

### `url`

Instead of `render`, a panel can show a page in an iframe:

```js
window.sozi.presenter.registerPanel({id: "timer-site", title: "Timer", url: "timer.html"});
```

The URL is `http:`, `https:` or relative to the presenter page. Any other scheme throws. A
relative page has to be next to the built presenter page.

### `defaults`: where it docks first

Without `defaults`, a new panel is a tab behind Notes, so it covers nothing. `defaults` places it
elsewhere in the default layout:

```js
defaults: {
    position: {referencePanel: "clock", direction: "below"},
    inactive: false,
    initialHeight: 120
}
```

- `position` places it next to another panel, by id: `direction` is `left`, `right`, `above`,
  `below` or `within` (a tab in the same group).
- `inactive: true` adds it as a tab that is not the one in front.
- `initialHeight` is its height in pixels when it is above or below another panel.

`defaults` is only where the panel goes the first time. Once the speaker has saved a layout, the
saved place wins. A saved layout without your panel puts it in its default place.

## Events and state

`window.sozi.presenter.on(name, handler)` calls `handler` on an event, and `off(name, handler)`
stops it. An unknown name throws.

| Event         | `handler` gets | Example |
| ------------- | -------------- | ------- |
| `frameChange` | the frame: `{index, id, title, notes}`, `index` from 0 | `presenter.on("frameChange", f => console.log(f.title))` |
| `viewport`    | the size of the audience window | `presenter.on("viewport", v => console.log(v))` |
| `status`      | the link to the audience window: `connected`, `reconnecting`, `stale` or `closed` | `presenter.on("status", s => (element.textContent = s))` |
| `timer`       | the talk timer: `{elapsedMs, running, targetMs}` | `presenter.on("timer", t => console.log(t.running))` |
| `message`     | every message from the audience window, after the presenter has read it | `presenter.on("message", m => console.log(m.name))` |

An event fires on a change. To draw the panel before the first change, read
`window.sozi.presenter.state`, which holds what the audience window last reported:

```js
const {frame, frames, frameCount, blank, status, timer} = window.sozi.presenter.state;
```

`frame` is null until the audience window has connected. `timer.elapsedMs` in `state` is the time
counted by now. In a `timer` event it is the time counted when the event was sent, and it does
not change while the timer runs: count from there with your own clock if you show a running time.

## Commands to the audience window

`window.sozi.presenter.display` drives the audience window:

| Command | Example |
| ------- | ------- |
| `next()` | `presenter.display.next()` |
| `previous()` | `presenter.display.previous()` |
| `jumpToFrame(index, transition = true)` | `presenter.display.jumpToFrame(0)` goes to the first frame; `false` skips the transition |
| `blank(on)` | `presenter.display.blank(true)` hides the slide; `false` shows it again |
| `timerAction(action)` | `presenter.display.timerAction("pause")`, or `"start"`, `"reset"` |
| `setTimerTarget(ms)` | `presenter.display.setTimerTarget(20 * 60 * 1000)`; `null` clears it |
| `send(name, payload)` | `presenter.display.send("poll", {question: 1})` |

`send` is for an add-on that has a part on each page. The part on the presentation page (target
`display`) receives it, and can answer:

```js
const {display} = window.sozi;
display.on("custom", (name, payload) => {
    if (name === "poll") {
        display.send("pollOpened", payload);
    }
});
```

The answer reaches the presenter as a `message` event with `name: "custom"`, `type` set to the
name and `data` to the payload.

## A complete example: a frame counter

This panel shows the title of the current frame and how many times that frame has been shown
since the panel was opened, for example "One, shown 2 times".

### 1. Copy your deck

Copy your deck's `.svg` and `.sozi.json` into a new directory. Here they are `deck.svg` and
`deck.sozi.json`.

### 2. Save the script

Save this script beside them as `frame-count.js`:

```js frame-count.js
(() => {
    const {presenter} = window.sozi;

    presenter.registerPanel({
        id: "frame-count",
        title: "Frame count",
        icon: "#",
        description: "How often each frame has been shown",
        render(element) {
            // How many times each frame was shown since the panel opened, by frame index.
            const counts = new Map();
            const text = element.ownerDocument.createElement("p");
            element.append(text);

            const count = frame => {
                if (!frame) {
                    return;
                }
                const times = (counts.get(frame.index) ?? 0) + 1;
                counts.set(frame.index, times);
                const unit = times === 1 ? "time" : "times";
                text.textContent = `${frame.title}, shown ${times} ${unit}`;
            };

            count(presenter.state.frame);
            presenter.on("frameChange", count);
            return () => {
                presenter.off("frameChange", count);
                text.remove();
            };
        }
    });
})();
```

### 3. Add it to the deck

Add the script to the custom files in `deck.sozi.json`, with the presenter as its target. If
`customFiles` is already there, add the entry to its list:

```json deck.sozi.json
{
  "customFiles": [{"path": "frame-count.js", "target": "presenter"}]
}
```

### 4. Build and open

```sh
sozi --cli build deck.svg
```

Open `deck-presenter.sozi.html`. "Frame count" is a tab behind Notes, and it is in the + menu
with its description. Go to the next frame and back: if your first frame is called "One", the
panel reads "One, shown 2 times".

### What to note in the example

- The script is wrapped in a function, so its names do not leak into the page.
- The counts live inside `render`, so closing the panel and opening it again starts from zero.
  To keep counting while the panel is closed, move the `Map` and the listener out of `render`.
- The cleanup calls `off` for the `on`. Without it, a closed panel would go on counting, and
  each reopen would add one more listener.
- `count(presenter.state.frame)` draws the panel as it opens, before the next frame change.
  `state.frame` is null when the audience window has not connected yet; the `frameChange` that
  comes with the connection draws it then.
