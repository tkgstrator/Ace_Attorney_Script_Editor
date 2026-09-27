// 第 1 話（項目 000）を実際に変換し、コンパイルと整合性チェックを通ることを確かめる。
// ROM から取り出したもの（assets/extracted/）が無ければ飛ばす。
import { describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { loadScenario } from '../../packages/script/src/load.ts';
import { verifyScenario } from '../../packages/script/src/verify.ts';
import { toYaml } from './index.ts';
import { convertChapter } from './chapter.ts';
import { EXTRACTED, loadEntry, loadTables } from './tables.ts';

const ready = ['script/json/000.json', 'script/json/072.json', 'tables/court.json'].every(p => existsSync(join(EXTRACTED, p)));

describe.skipIf(!ready)('第 1 話の変換', () => {
  const { scenario, ctx } = ready
    ? (({ scenario, results }) => ({ scenario, ctx: results[0]!.ctx }))(convertChapter(loadTables(), [loadEntry(0)], { id: 'ep1', title: 'test', common: loadEntry(72) }))
    : { scenario: {} as Record<string, unknown>, ctx: null };

  test('エラーなくコンパイルでき、整合性チェックを通る', () => {
    const { scenario: compiled, diagnostics } = loadScenario(toYaml(scenario));
    expect(diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    const v = verifyScenario(compiled!);
    expect(v.truncated).toBe(false);
    expect(v.findings.filter(f => f.severity === 'error')).toEqual([]);
  });

  test('尋問 3 つ・つきつけの正解（解剖記録 → §59、停電記録 → §76、置物 → §89）', () => {
    const scenes = (scenario.parts as { scenes: unknown }[])[0]!.scenes as Record<string, { statements?: { id: string; present?: Record<string, unknown> }[] }>;
    const present = (id: string) => scenes[id]!.statements!.flatMap(s => Object.entries(s.present ?? {}).map(([e, v]) => [s.id, e, v]));
    expect(present('t037')).toEqual([['s46', 'e6', [{ goto: 's059' }]]]);
    expect(present('t062').map(p => p[1])).toEqual(['e9', 'e9', 'e9', 'e9', 'e9']);
    expect(present('t079')[0]).toEqual(['s81', 'e7', [{ goto: 's089' }]]);
  });

  test('ライフ 5・1 回で 1 減る・ゲームオーバーは §113', () => {
    expect(scenario).toMatchObject({ life: 5, defaults: { penalty: 1, autoShow: false }, gameover: 's113' });
    expect(ctx!.stats.totals().native).toBeGreaterThan(0);
  });
});

const ready2 = ready && [2, 4, 6, 8].every(n => existsSync(join(EXTRACTED, `script/json/${String(n).padStart(3, '0')}.json`)))
  && existsSync(join(EXTRACTED, 'tables/investigation.json'));

describe.skipIf(!ready2)('第 2 話の変換（探偵パートあり）', () => {
  test('4 つの編を 1 つの章にしてエラーなくコンパイルでき、法廷の編（004）は整合性チェックを通る', async () => {
    const { loadInvParts } = await import('./index.ts');
    const t = loadTables();
    const common = loadEntry(72);
    const { scenario } = convertChapter(t, [2, 4, 6, 8].map(n => loadEntry(n)), { id: 'ep2', title: 'test', common, invParts: loadInvParts() });
    const parts = scenario.parts as { kind: string; places?: object }[];
    expect(parts.map(p => p.kind)).toEqual(['investigation', 'trial', 'investigation', 'trial']);
    expect(Object.keys(parts[0]!.places ?? {}).length).toBeGreaterThan(3);
    expect(loadScenario(toYaml(scenario)).diagnostics.filter(d => d.severity === 'error')).toEqual([]);
    const court = convertChapter(t, [loadEntry(4)], { id: 'p2', title: 'test', common }).scenario;
    const v = verifyScenario(loadScenario(toYaml(court)).scenario!);
    expect(v.findings.filter(f => f.severity === 'error')).toEqual([]);
  }, 60_000); // 4 つの項目の変換と整合性チェックで数秒かかる
});
