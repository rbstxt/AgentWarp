import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {cleanUpPlus, placeNew} from '../../packages/core/layout.ts';
import {measureScript} from '../../packages/core/metrics.ts';
import {readSb3Json} from '../../packages/core/test/zip.ts';

test('Japanese cleanup matches measured editor positions', () => {
    let count = 0;
    for (const name of ['click', 'clones', 'greenflag', 'keys', 'touch']) {
        const data = JSON.parse(readFileSync(`eval/calibration/ja/${name}.cleanup.json`, 'utf8'));
        const project = readSb3Json(data.fixture) as any;
        for (const target of data.targets) {
            const source = project.targets.find((t: any) => t.name === target.name);
            const placed = cleanUpPlus(source, {locale: 'ja'});
            for (const script of target.scripts) {
                if (!placed.blocks.has(script.id)) continue;
                const pos = placed.blocks.get(script.id)!;
                assert.ok(Math.abs(pos.x-script.x) < 1 && Math.abs(pos.y-script.y) < 1, `${name} ${script.id}`);
                count++;
            }
        }
    }
    assert.ok(count >= 8, `only ${count} scripts`);
});

test('new attached comments clear the entire script in both languages', () => {
    const blocks = {
        hat: {opcode:'event_whenkeypressed', parent:null, next:'say', topLevel:true, x:0, y:0, fields:{KEY_OPTION:['1',null]}},
        say: {opcode:'looks_sayforsecs', parent:'hat', next:null, inputs:{MESSAGE:[1,[10,'a much longer line']], SECS:[1,[4,'2']]}, fields:{}}
    };
    const target = {blocks, comments:{c:{blockId:'hat',width:200,height:200}}};
    const placed = placeNew(target, ['hat'], ['c']);
    const x = placed.blocks.get('hat')!.x, cx = placed.comments.get('c')!.x;
    for (const locale of ['en', 'ja'] as const) assert.ok(cx > x + measureScript(blocks,'hat',{locale}).width, locale);
});
