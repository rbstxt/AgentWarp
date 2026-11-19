import { pathToFileURL } from 'node:url';

/**
 * An absolute file path as an ESM specifier. `import()` takes URLs, and a Windows path (`C:\…`) parses
 * as the URL scheme `c:` (ERR_UNSUPPORTED_ESM_URL_SCHEME), so it has to be a file:// URL.
 * `windows` overrides the host's path rules (tests).
 */
export function fileUrl(path: string, windows?: boolean): string {
    return (windows === undefined ? pathToFileURL(path) : pathToFileURL(path, { windows })).href;
}

/** `import()` of an absolute file path, on Windows too. */
export function importFile(path: string): Promise<any> {
    return import(fileUrl(path));
}
