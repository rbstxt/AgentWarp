import {copyFile} from 'node:fs/promises';
await copyFile(new URL('../dist/agentwarp-client.js', import.meta.url), new URL('../../bridge/client/agentwarp-client.js', import.meta.url));
