// Globals of the Google API client and picker scripts (https://apis.google.com/js/client.js),
// which the browser build loads with a script tag for the Google Drive backend. No typings
// are installed for them; this declares the subset that backend/GoogleDrive.js uses.

/** A Drive v2 file resource, as far as the backend reads it. */
interface DriveFile {
    id: string;
    title: string;
    mimeType: string;
    downloadUrl: string;
    parents: object[];
}

/** A Drive API response that may carry an error instead of a result. */
interface DriveResult {
    error?: {message: string};
}

/** A pending Drive API request. */
interface DriveRequest<T> {
    execute(callback: (response: T) => void): void;
}

/** A Picker builder, configured by chained calls. */
interface PickerBuilder {
    addView(view: object): PickerBuilder;
    setOAuthToken(token: string): PickerBuilder;
    setCallback(
        callback: (data: {[key: string]: unknown; docs: {id: string}[]}) => void
    ): PickerBuilder;
    build(): {setVisible(visible: boolean): void};
}

declare global {
    /** The Google API client loader. */
    const gapi: {
        load(library: string, options: {callback: () => void}): void;
        auth: {
            authorize(
                params: {client_id: string; scope: string; immediate: boolean},
                callback: (result: {error?: unknown; access_token: string} | null) => void
            ): void;
        };
        client: {
            setApiKey(key: string): void;
            load(api: string, version: string): void;
            request(args: {
                path: string;
                method: string;
                params: object;
                headers: object;
                body: string;
            }): DriveRequest<DriveFile & DriveResult>;
            drive: {
                files: {
                    get(args: {fileId: string}): DriveRequest<DriveFile & DriveResult>;
                    list(args: {q: string}): DriveRequest<{items?: DriveFile[]}>;
                };
            };
        };
    };

    /** The Google Picker namespace. */
    const google: {
        picker: {
            View: new (viewId: string) => {setMimeTypes(mimeTypes: string): void};
            ViewId: {DOCS: string};
            PickerBuilder: new () => PickerBuilder;
            Response: {ACTION: string};
            Action: {PICKED: string};
        };
    };
}

export {};
