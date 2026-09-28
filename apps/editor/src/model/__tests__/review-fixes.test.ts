// レビュー対応（台詞の属性・コマンドのひな形・フォームにない項目・条件式・参照の書き換え・行のキー・検索）のテスト
import { describe, expect, it } from 'vitest';
import { checkCond, condMentions, renameInCond } from '../cond.ts';
import { applyOps } from '../doc-session.ts';
import { extraKeys, extraRecordKeys, hasForm, YAML_ONLY } from '../form-keys.ts';
import { findRefs } from '../refs.ts';
import { reconcileRows } from '../row-keys.ts';
import { canShorten, sayEditOps, shortenOps } from '../say.ts';
import { buildIndex, search } from '../search.ts';
import { COMMAND_GROUPS, COMMAND_NAMES, OTHER_COMMANDS, stepKind, stepTemplate } from '../steps.ts';
import { toData } from '../yaml-doc.ts';

const edit = (text: string, ops: Parameters<typeof applyOps>[1]) =>
  toData(applyOps(text, ops)).data;

describe('台詞の人物・色・自動送りの編集', () => {
  const full = 'steps:\n  - say: judge\n    text: 開廷します。  # 行末コメント\n    auto: true\n';

  it('色を変えても auto は残る（変えた属性だけを書き換える）', () => {
    const step = { say: 'judge', text: '開廷します。', auto: true };
    const out = applyOps(full, sayEditOps(['steps', 0], step, { color: 'red' }));
    expect(toData(out).data).toEqual({
      steps: [{ say: 'judge', text: '開廷します。', auto: true, color: 'red' }],
    });
    expect(out).toContain('# 行末コメント');
  });

  it('人物を変えても auto は残る', () => {
    const step = { say: 'judge', text: '開廷します。', auto: true };
    expect(edit(full, sayEditOps(['steps', 0], step, { speaker: 'naruse' }))).toEqual({
      steps: [{ say: 'naruse', text: '開廷します。', auto: true }],
    });
  });

  it('auto があると省略形にはできない。auto を外すと省略形にできる', () => {
    expect(canShorten({ say: 'judge', text: 'a', auto: true })).toBe(false);
    expect(shortenOps(['steps', 0], { say: 'judge', text: 'a', auto: true })).toEqual([]);
    expect(canShorten({ say: 'judge', text: 'a' })).toBe(true);
    expect(canShorten({ say: 'text', text: 'a' })).toBe(false);
  });

  it('省略形の人物を変えるときはキーの名前を変える。色・自動送りを付けると完全形になる', () => {
    const text = 'steps:\n  - naruse: "はい"  # c\n';
    const step = { naruse: 'はい' };
    const renamed = applyOps(text, sayEditOps(['steps', 0], step, { speaker: 'torii' }));
    expect(toData(renamed).data).toEqual({ steps: [{ torii: 'はい' }] });
    // 引用符と行末コメントは残る（位置揃えの空白は yaml が 1 つにする）
    expect(renamed).toContain('torii: "はい" # c');
    expect(edit(text, sayEditOps(['steps', 0], step, { auto: true }))).toEqual({
      steps: [{ say: 'naruse', text: 'はい', auto: true }],
    });
    expect(edit(text, sayEditOps(['steps', 0], step, { speaker: null }))).toEqual({
      steps: [{ say: null, text: 'はい' }],
    });
  });
});

describe('コマンドの一覧とひな形', () => {
  it('すべてのコマンドが追加メニューのどこかにある（その他のコマンドを含む）', () => {
    const listed = [...COMMAND_GROUPS.flatMap((g) => g.items), ...OTHER_COMMANDS];
    expect([...listed].sort()).toEqual([...COMMAND_NAMES].sort());
    for (const n of YAML_ONLY) expect(OTHER_COMMANDS).toContain(n);
  });

  it('どのコマンドも、フォームか YAML の欄のどちらかで編集できる', () => {
    for (const n of COMMAND_NAMES) expect(hasForm(n) || YAML_ONLY.has(n)).toBe(true);
    for (const n of COMMAND_NAMES)
      expect(
        stepKind(
          stepTemplate(n, { characters: [], evidence: [], scenes: [], places: [], flags: [] }),
        ),
      ).toBe(n);
  });

  const ctx = {
    characters: ['naruse'],
    evidence: [],
    scenes: [],
    places: [],
    flags: ['count', 'name', 'done'],
    flagValues: { count: 0, name: 'x', done: false },
  };

  it('set は真偽のフラグに true、add は数値のフラグだけ', () => {
    expect(stepTemplate('set', ctx)).toEqual({ set: { done: true } });
    expect(stepTemplate('add', ctx)).toEqual({ add: { count: 1 } });
    expect(stepTemplate('if', ctx)).toMatchObject({ if: 'done' });
  });

  it('型の合うフラグがなければ、架空のフラグを作らない', () => {
    const none = { ...ctx, flags: ['name'], flagValues: { name: 'x' } };
    expect(stepTemplate('add', none)).toEqual({ add: {} });
    expect(stepTemplate('set', none)).toEqual({ set: { name: '' } });
    expect(stepTemplate('if', none)).toMatchObject({ if: 'true' });
    expect(stepTemplate('set', { ...none, flags: [], flagValues: {} })).toEqual({ set: {} });
  });
});

describe('フォームにない項目', () => {
  it('入力欄に出していない属性を返す', () => {
    expect(extraKeys('demand', { demand: 'x', present: {}, profiles: true })).toEqual(['profiles']);
    expect(extraKeys('say', { say: 'a', text: 'b', auto: true })).toEqual([]);
    expect(extraKeys('shorthand', { a: 'b' })).toEqual([]);
    expect(extraKeys('native', { native: 'x', args: [] })).toEqual([]);
    expect(
      extraRecordKeys({ name: 'a', description: '', examine: [] }, ['name', 'description']),
    ).toEqual(['examine']);
  });
});

describe('条件式', () => {
  it('構文に沿って ID を書き換える（文字列の中・別の種類の ID・関数名は変えない）', () => {
    const src = 'has(knife) and knife > 0 or visited(knife) and not "knife"';
    expect(renameInCond(src, 'var', 'knife', 'blade')).toBe(
      'has(knife) and blade > 0 or visited(knife) and not "knife"',
    );
    expect(renameInCond(src, 'has', 'knife', 'blade')).toBe(
      'has(blade) and knife > 0 or visited(knife) and not "knife"',
    );
    expect(condMentions('seen(x)', 'seen', 'x')).toBe(true);
    expect(condMentions('not(flag)', 'var', 'flag')).toBe(true);
  });

  it('構文エラーと、章にない ID を見つける', () => {
    const known = { flags: ['a'], evidence: ['e'], nodes: ['s'] };
    expect(checkCond('a == ', known).error).toContain('文字目');
    expect(checkCond('a and has(x) and visited(s)', known)).toEqual({
      error: null,
      unknown: ['証拠品 x'],
    });
    expect(checkCond('', known)).toEqual({ error: null, unknown: [] });
  });
});

const chapter = `
id: c
title: t
player: naruse
characters:
  naruse: { name: N }
  tomoe: { name: T, profile: { description: d } }
evidence:
  knife: { name: K, description: d }
flags:
  count: 0
start: { scene: s1, evidence: [knife], profiles: [tomoe] }
parts:
  - id: p1
    kind: trial
    title: x
    scenes:
      s1:
        - naruse: はい
        - say: tomoe
          text: いいえ
          auto: true
        - show: tomoe
        - give: [knife]
        - add: { count: 1 }
        - if: count > 0 and has(knife)
          then:
            - goto: t1
        - demand: 見せて
          by: tomoe
          present:
            knife: [{ naruse: これだ }]
            tomoe: []
      t1:
        testimony: 証言
        witness: tomoe
        statements:
          - text: a
            present: { knife: [] }
`;

describe('ID の参照を探して書き換える', () => {
  it('人物の参照（省略形のキー・say・show・by・witness・人物ファイル・つきつけのキー・player）', () => {
    const refs = findRefs(toData(chapter).data, 'character', 'tomoe');
    // start.profiles・say・show・demand.by・つきつけのキー・witness
    expect(refs.length).toBe(6);
    const out = edit(chapter, [
      { op: 'renameKey', path: ['characters'], from: 'tomoe', to: 'lana' },
      { op: 'renameRefs', target: 'character', from: 'tomoe', to: 'lana' },
    ]);
    const text = JSON.stringify(out);
    expect(text).not.toContain('tomoe');
    expect(findRefs(out, 'character', 'naruse').length).toBe(3);
  });

  it('証拠品（give・start・つきつけのキー・条件式の has）とフラグ（add・条件式）', () => {
    const ev = edit(chapter, [
      { op: 'renameKey', path: ['evidence'], from: 'knife', to: 'blade' },
      { op: 'renameRefs', target: 'evidence', from: 'knife', to: 'blade' },
    ]);
    expect(JSON.stringify(ev)).not.toContain('knife');
    const fl = edit(chapter, [
      { op: 'renameKey', path: ['flags'], from: 'count', to: 'n' },
      { op: 'renameRefs', target: 'flag', from: 'count', to: 'n' },
    ]);
    const parts = fl?.parts as { scenes: Record<string, unknown[]> }[];
    const s1 = parts[0]!.scenes.s1!;
    expect(s1[4]).toEqual({ add: { n: 1 } });
    expect((s1[5] as { if: string }).if).toBe('n > 0 and has(knife)');
  });

  it('シーンの ID の変更では goto・start.scene を書き換える', () => {
    const out = edit(chapter, [
      { op: 'renameKey', path: ['parts', 0, 'scenes'], from: 't1', to: 't2' },
      { op: 'renameRefs', target: 'scene', from: 't1', to: 't2' },
    ]);
    expect(JSON.stringify(out)).not.toContain('"t1"');
  });
});

describe('列の行のキー', () => {
  it('並べ替え・追加・削除・書き換えの後も、同じ行には同じキー', () => {
    const a = { x: 1 };
    const b = { x: 2 };
    const c = { x: 3 };
    const r1 = reconcileRows(null, [a, b, c]);
    const moved = reconcileRows(r1, [{ x: 2 }, { x: 1 }, { x: 3 }]);
    expect(moved.keys).toEqual([r1.keys[1], r1.keys[0], r1.keys[2]]);
    // 中身が同じ行は前のオブジェクトを使う（描き直さない）
    expect(moved.items[0]).toBe(b);
    const edited = reconcileRows(r1, [a, { x: 20 }, c]);
    expect(edited.keys).toEqual(r1.keys);
    const inserted = reconcileRows(r1, [a, { y: 0 }, b, c]);
    expect(inserted.keys[0]).toBe(r1.keys[0]);
    expect(inserted.keys[2]).toBe(r1.keys[1]);
    expect(new Set(inserted.keys).size).toBe(4);
    const dup = reconcileRows(r1, [a, a, b, c]);
    expect(new Set(dup.keys).size).toBe(4);
  });
});

describe('章の中の検索', () => {
  const data = toData(chapter).data;
  it('シーン ID・台詞・話し手で探せる', () => {
    const index = buildIndex(data);
    expect(search(index, 't1').some((r) => r.kind === 'id')).toBe(true);
    const hits = search(index, 'いいえ');
    expect(hits[0]?.selection).toEqual({ kind: 'scene', part: 0, id: 's1' });
    expect(hits[0]?.path).toEqual(['parts', 0, 'scenes', 's1', 1, 'text']);
    expect(search(index, 'naruse: これ').map((r) => r.text)).toEqual(['これだ']);
    expect(search(index, 'tomoe: これ')).toEqual([]);
    // 同じデータなら索引を作り直さない
    expect(buildIndex(data)).toBe(index);
  });
});
