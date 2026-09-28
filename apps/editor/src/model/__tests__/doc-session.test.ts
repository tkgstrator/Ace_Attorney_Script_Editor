import { describe, expect, it } from 'vitest';
import { DocSession, applyOps, mergeEntries, type Entry } from '../doc-session.ts';
import { createHistory, push, redo, undo, type History } from '../history.ts';
import { toData, type Op } from '../yaml-doc.ts';

const SRC = `# 先頭のコメント
id: case1
title: テスト

flags:
  asked: false   # 聞いたか
  count: 0       # 回数

start:
  scene: opening
  evidence: [badge, photo]

scenes:
  opening:
    - naruse: こんにちは
    - card: "9月27日\\n法廷"
    - set: { asked: true }
    - goto: next
  next:
    - end: true
`;

/** いろいろな操作（1 件ずつ当てる） */
const OPS: Op[][] = [
  [{ op: 'set', path: ['scenes', 'opening', 0, 'naruse'], value: 'こんばんは' }],
  [{ op: 'set', path: ['scenes', 'opening', 0, 'color'], value: 'blue' }],
  [{ op: 'delete', path: ['scenes', 'opening', 0, 'color'] }],
  [
    {
      op: 'insert',
      path: ['scenes', 'opening'],
      index: 1,
      value: { choice: [{ text: 'A', then: [{ goto: 'next' }] }] },
    },
  ],
  [{ op: 'move', path: ['scenes', 'opening'], from: 0, to: 3 }],
  [{ op: 'set', path: ['scenes', 'opening', 3, 'set', 'count'], value: 2 }],
  [{ op: 'set', path: ['scenes', 'opening', 2], value: { say: null, text: 'x' } }],
  [{ op: 'delete', path: ['scenes', 'opening', 1] }],
  [{ op: 'set', path: ['scenes', 'later'], value: [{ card: '後で' }] }],
  [{ op: 'set', path: ['flags', 'count'], value: 5 }],
  [
    { op: 'renameKey', path: ['scenes'], from: 'next', to: 'finale' },
    { op: 'renameRefs', target: 'scene', from: 'next', to: 'finale' },
  ],
  [{ op: 'insert', path: ['extra', 'list'], value: { a: 1 } }],
  [
    { op: 'set', path: ['parts'], value: [] },
    {
      op: 'insert',
      path: ['parts'],
      index: 0,
      value: { id: 'trial', kind: 'trial', title: '裁判編' },
    },
    { op: 'relocate', from: ['scenes'], to: ['parts', 0, 'scenes'] },
  ],
];

describe('DocSession', () => {
  it('Document に直接当てた結果は、毎回テキストを読み直して当てた結果と同じ（データも同じ）', () => {
    const s = new DocSession(SRC);
    let text = SRC;
    for (const ops of OPS) {
      s.edit(ops);
      text = applyOps(text, ops);
      expect(s.text()).toBe(text);
      expect(s.data).toEqual(toData(text).data);
    }
  });

  it('書き換えていなければ、読んだテキストそのものを返す', () => {
    const s = new DocSession(SRC);
    expect(s.text()).toBe(SRC);
    expect(s.textReady()).toBe(true);
    s.edit([{ op: 'set', path: ['title'], value: '別' }]);
    expect(s.textReady()).toBe(false);
  });

  it('スカラーを書き換えても、ほかの部分のデータは同じオブジェクトのまま', () => {
    const s = new DocSession(SRC);
    const before = s.data!;
    s.edit([{ op: 'set', path: ['scenes', 'opening', 0, 'naruse'], value: 'やあ' }]);
    const after = s.data!;
    expect(after).not.toBe(before);
    expect(after.flags).toBe(before.flags);
    const [a, b] = [
      before.scenes as Record<string, unknown[]>,
      after.scenes as Record<string, unknown[]>,
    ];
    expect(b.next).toBe(a.next);
    expect(b.opening![1]).toBe(a.opening![1]);
    expect(b.opening![0]).toEqual({ naruse: 'やあ' });
  });

  it('元に戻す・やり直すで、テキストもデータも前と同じになる', () => {
    const s = new DocSession(SRC);
    let h: History<Entry> = createHistory();
    const texts = [SRC];
    for (const ops of OPS) {
      h = push(h, s.edit(ops)!);
      texts.push(s.text());
    }
    for (let i = OPS.length - 1; i >= 0; i--) {
      const u = undo(h)!;
      h = u.history;
      s.undo(u.entry);
      expect(s.text()).toBe(texts[i]);
      expect(s.data).toEqual(toData(texts[i]!).data);
    }
    expect(s.textReady()).toBe(true);
    for (let i = 1; i <= OPS.length; i++) {
      const r = redo(h)!;
      h = r.history;
      s.redo(r.entry);
      expect(s.text()).toBe(texts[i]);
    }
  });

  it('続けての入力は 1 件にまとまり、1 回で戻せる', () => {
    const s = new DocSession(SRC);
    let h: History<Entry> = createHistory();
    for (const [i, v] of ['こ', 'こん', 'こんば'].entries()) {
      h = push(
        h,
        s.edit([{ op: 'set', path: ['title'], value: v }])!,
        'title',
        i * 100,
        mergeEntries,
      );
    }
    expect(h.past.length).toBe(1);
    expect(h.past[0]!.changes.length).toBe(1);
    s.undo(undo(h)!.entry);
    expect(s.text()).toBe(SRC);
  });

  it('テキストの置き換え（YAML の直接編集）も元に戻せ、構文エラーの間はフォームで編集できない', () => {
    const s = new DocSession(SRC);
    const e1 = s.edit([{ op: 'set', path: ['title'], value: '前' }])!;
    const mid = s.text();
    const e2 = s.replaceText('id: [')!;
    expect(s.data).toBeNull();
    expect(s.error).not.toBeNull();
    expect(() => s.edit([{ op: 'set', path: ['title'], value: 'x' }])).toThrow();
    s.undo(e2);
    expect(s.text()).toBe(mid);
    s.undo(e1);
    expect(s.text()).toBe(SRC);
  });

  it('途中で失敗した編集は、何も変えない', () => {
    const s = new DocSession(SRC);
    expect(() =>
      s.edit([
        { op: 'set', path: ['title'], value: '変えた' },
        { op: 'renameKey', path: ['scenes'], from: 'opening', to: 'next' },
      ]),
    ).toThrow();
    expect(s.text()).toBe(SRC);
    expect((s.data as { title: string }).title).toBe('テスト');
  });
});
