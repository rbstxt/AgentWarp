// Dynamic imports of absolute paths must go through file:// URLs: on Windows a bare `C:\…` path is
// read as the URL scheme `c:` and the engine crashed with ERR_UNSUPPORTED_ESM_URL_SCHEME as soon as
// it loaded a text format.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fileUrl, importFile } from '../import-file.ts';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

test('a bare Windows path is not an ESM specifier (the original crash)', async () => {
    await assert.rejects(import('C:\\agentwarp\\formats\\ts\\index.ts'), { code: 'ERR_UNSUPPORTED_ESM_URL_SCHEME' });
});

test('fileUrl turns a Windows path into a file:// URL (spaces and Japanese names included)', () => {
    assert.equal(
        fileUrl('C:\\Users\\Jane Doe\\AppData\\Roaming\\agentwarp-desktop\\プロジェクト\\formats\\ts\\index.ts', true),
        'file:///C:/Users/Jane%20Doe/AppData/Roaming/agentwarp-desktop/%E3%83%97%E3%83%AD%E3%82%B8%E3%82%A7%E3%82%AF%E3%83%88/formats/ts/index.ts'
    );
    assert.equal(fileUrl('/opt/agent warp/formats/ts/index.ts', false), 'file:///opt/agent%20warp/formats/ts/index.ts');
});

test('importFile loads a module from a directory with spaces and Japanese characters', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'agentwarp import テスト '));
    try {
        const file = join(dir, 'mod.mjs');
        await writeFile(file, 'export const answer = 42;\n');
        assert.equal((await importFile(file)).answer, 42);
    } finally {
        await rm(dir, { recursive: true, force: true });
    }
});

test('importFile loads the bundled text formats', async () => {
    for (const name of ['ts', 'scratchblocks']) {
        const m = await importFile(join(ROOT, 'formats', name, 'index.ts'));
        assert.ok(Object.keys(m).length > 0, name);
    }
});

test('the CLI and the bridge do not import() raw absolute paths', async () => {
    for (const rel of ['packages/cli', 'packages/bridge']) {
        for (const f of await readdir(join(ROOT, rel))) {
            if (!f.endsWith('.ts')) continue;
            const text = await readFile(join(ROOT, rel, f), 'utf8');
            assert.doesNotMatch(text, /\bimport\(\s*(join|resolve)\(/, `${rel}/${f}: use importFile()`);
        }
    }
});
