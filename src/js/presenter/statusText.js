/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

import {TransportStatus} from "../protocol/LocalTransport.js";

/** The words for each status of a transport.
 *
 * @readonly
 */
const STATUS_TEXT = Object.freeze({
    [TransportStatus.connected]: "Connected",
    [TransportStatus.reconnecting]: "Reconnecting",
    [TransportStatus.stale]: "Stale",
    [TransportStatus.closed]: "Closed"
});

/** Name a status of a transport the way every surface names it.
 *
 * @param {string} status - One of `TransportStatus`.
 * @returns {string} The words for the status, or the status itself when it is unknown.
 */
export function statusText(status) {
    return Object.hasOwn(STATUS_TEXT, status) ? STATUS_TEXT[status] : status;
}
