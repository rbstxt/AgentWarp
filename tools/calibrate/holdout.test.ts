import {test} from 'node:test';
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const reports = (['en', 'ja'] as const).map(locale => ({locale, report: JSON.parse(execFileSync(process.execPath, ['tools/calibrate/holdout-report.ts'], {cwd: root, encoding: 'utf8', env: {...process.env, CALIBRATE_LOCALE: locale}}))}));

test('held-out rendered script dimensions', () => {
    for (const {locale, report} of reports) {
    const {total} = report;
    assert.ok(total.n >= 300, `only ${total.n} scripts compared`);
    assert.ok(total.heightExact / total.n >= 0.98, `height exact ${total.heightExact}/${total.n}`);
    assert.ok(total.widthMean < 2, `width mean ${total.widthMean}`);
    assert.ok(total.widthMax < 10, `${locale} width maximum ${total.widthMax}`);
    }
});

test('every held-out script has usable editor measurements', () => {
    for (const {report} of reports) {
        assert.deepEqual(report.missing, [], 'unmatched scripts');
        assert.deepEqual(report.invalid, [], 'invalid editor measurements');
        assert.deepEqual(report.quirks, ['raw-json-L6.measured.json player Yt{7~R5HQLmO$dUww)Gx: root absent from editor']);
    }
});
