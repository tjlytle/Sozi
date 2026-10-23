# Presenter protocol

The display (the audience window that plays the deck) and a presenter surface talk through
`postMessage`. Every message is built, validated and sent by `src/js/protocol/`
(standard 2.5). This document lists the messages defined there so far; #28 completes it.

## `viewport`

Sent by the display to the presenter window. It tells the presenter how big the audience
window is, so the previews can take the same shape.

| Field        | Type   | Meaning                                       |
| ------------ | ------ | --------------------------------------------- |
| `name`       | string | Always `"viewport"`.                          |
| `width`      | number | Inner width of the display, in CSS pixels.    |
| `height`     | number | Inner height of the display, in CSS pixels.   |
| `pixelRatio` | number | Device pixels per CSS pixel on the display.   |

The display sends it when a presenter connects (in answer to `notifyOnFrameChange`) and
again every time the display window is resized. Preview frames never send it.

The receiver accepts the message only from the display window, and only when all three
numbers are positive and finite; a minimised window reports a zero size and is ignored.
`pixelRatio` is not used for the shape.

Module: `src/js/protocol/viewport.js` (`viewportMessage`, `readViewport`, `postViewport`).
