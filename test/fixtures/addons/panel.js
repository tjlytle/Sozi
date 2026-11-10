/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

// A presenter add-on: an "Add-on" panel that shows the frame and pings the display. The
// data-addon-panel attribute is how the steps find what the panel drew.

(() => {
    const {presenter} = /** @type {any} */ (window).sozi;

    presenter.registerPanel({
        id: "addon",
        title: "Add-on",
        render(element) {
            const doc = element.ownerDocument;
            const root = doc.createElement("div");
            root.dataset.addonPanel = "Add-on";
            const text = doc.createElement("p");
            const ping = doc.createElement("button");
            ping.type = "button";
            ping.textContent = "Ping";
            ping.addEventListener("click", () => presenter.display.send("ping", {}));
            root.append(text, ping);
            element.append(root);

            const showFrame = frame => {
                text.textContent = frame ? `frame ${frame.index + 1}` : "";
            };
            const onMessage = message => {
                if (message.name === "hello" && message.role === "display") {
                    showFrame(message.frame);
                } else if (message.name === "custom" && message.type === "pong") {
                    text.textContent = "pong";
                }
            };

            showFrame(presenter.state.frame);
            presenter.on("frameChange", showFrame);
            presenter.on("message", onMessage);
            return () => {
                presenter.off("frameChange", showFrame);
                presenter.off("message", onMessage);
                root.remove();
            };
        }
    });
})();
