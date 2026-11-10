/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

/** @module */

/** The database's name, version, store and index.
 *
 * @readonly
 */
const DATABASE = Object.freeze({
    name: "sozi-thumbnails",
    version: 1,
    store: "thumbnails",
    deckIndex: "deck"
});

/** Open the database, creating it the first time.
 *
 * @param {IDBFactory} indexedDB - The browser's IndexedDB.
 * @returns {Promise<IDBDatabase>} The database.
 */
function openDatabase(indexedDB) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(DATABASE.name, DATABASE.version);
        request.onupgradeneeded = () => {
            const store = request.result.createObjectStore(DATABASE.store, {
                keyPath: ["deckId", "version", "index"]
            });
            store.createIndex(DATABASE.deckIndex, "deckId");
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
    });
}

/** Read a version of a deck's thumbnails, and delete the deck's other versions.
 *
 * @param {IDBDatabase} db - The database.
 * @param {string} deckId - The deck.
 * @param {string} version - The version to keep.
 * @returns {Promise<Map<number, string>>} The thumbnails, by frame.
 */
function readDeck(db, deckId, version) {
    return new Promise((resolve, reject) => {
        const found = new Map();
        const transaction = db.transaction(DATABASE.store, "readwrite");
        const store = transaction.objectStore(DATABASE.store);
        const cursors = store.index(DATABASE.deckIndex).openCursor(deckId);
        cursors.onsuccess = () => {
            const cursor = cursors.result;
            if (cursor) {
                if (cursor.value.version === version) {
                    found.set(cursor.value.index, cursor.value.url);
                } else {
                    cursor.delete();
                }
                cursor.continue();
            }
        };
        transaction.oncomplete = () => resolve(found);
        transaction.onabort = () => reject(transaction.error);
    });
}

/** Add a thumbnail to the database.
 *
 * @param {IDBDatabase} db - The database.
 * @param {object} record - The record: `deckId`, `version`, `index` and `url`.
 * @returns {Promise<void>} Settled when it is stored.
 */
function writeRecord(db, record) {
    return new Promise((resolve, reject) => {
        const transaction = db.transaction(DATABASE.store, "readwrite");
        transaction.objectStore(DATABASE.store).put(record);
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error);
    });
}

/** The thumbnails of a deck's version, kept across reloads in IndexedDB.
 *
 * A rebuild changes the version, and opening a deck deletes its other versions. Any IndexedDB
 * failure only means that the thumbnails last as long as the page: they are in memory as well.
 */
export class ThumbnailCache {
    /** A cache with nothing open.
     *
     * @param {IDBFactory} [indexedDB] - The browser's IndexedDB, if it has one.
     */
    constructor(indexedDB) {
        this.indexedDB = indexedDB;

        /** The database, null until it opens and after any failure.
         *
         * @type {?IDBDatabase}
         */
        this.db = null;

        /** The deck and version open now.
         *
         * @type {{deckId: string, version: string}}
         */
        this.deck = {deckId: "", version: ""};

        /** The thumbnails of the version open now, by frame.
         *
         * @type {Map<number, string>}
         */
        this.memory = new Map();
    }

    /** Open a deck's version, and read what is kept for it.
     *
     * @param {string} deckId - The deck.
     * @param {string} version - Its version.
     * @returns {Promise<Map<number, string>>} The thumbnails, by frame.
     */
    async open(deckId, version) {
        if (this.deck.deckId !== deckId || this.deck.version !== version) {
            this.memory = new Map();
        }
        this.deck = {deckId, version};
        try {
            if (!this.db) {
                this.db = await openDatabase(/** @type {IDBFactory} */ (this.indexedDB));
            }
            const stored = await readDeck(this.db, deckId, version);
            this.memory = new Map([...stored, ...this.memory]);
        } catch {
            // A private window or a full disk: the thumbnails stay in memory.
            this.db = null;
        }
        return new Map(this.memory);
    }

    /** Keep a thumbnail of the version open now.
     *
     * @param {number} index - The frame's position, from 0.
     * @param {string} url - The thumbnail.
     */
    async put(index, url) {
        this.memory.set(index, url);
        if (this.db) {
            try {
                await writeRecord(this.db, {...this.deck, index, url});
            } catch {
                // As in `open`: the thumbnail is in memory.
                this.db = null;
            }
        }
    }

    /** Close the database. */
    dispose() {
        if (this.db) {
            this.db.close();
        }
        this.db = null;
    }
}
