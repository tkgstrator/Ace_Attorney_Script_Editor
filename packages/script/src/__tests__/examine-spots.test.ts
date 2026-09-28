// 「調べる」の目印の位置（当たり判定と合うか）と、調べた所の判定のテスト
import { type Beat, Engine, examineSpots, markerPoint } from '@gyakusai/core';
import { describe, expect, it } from 'vitest';
import { loadScenario } from '../load.ts';

type Area = [number, number, number, number];

function load(yaml: string) {
  const { scenario, diagnostics } = loadScenario(yaml);
  if (!scenario)
    throw new Error(diagnostics.map((d) => `${d.line}:${d.column} ${d.message}`).join('\n'));
  return scenario;
}

/** 台詞を読み飛ばして、止まった Beat を返す */
function skip(e: Engine): Beat {
  for (let i = 0; i < 1000; i++) {
    const b = e.beat;
    if (b.kind !== 'line' && b.kind !== 'shout') return b;
    e.advance();
  }
  throw new Error('止まりません');
}

const CHAPTER = `
id: ch
title: 第1話
player: me
characters:
  me: { name: 私 }
evidence: {}
flags:
  open: false
start: { scene: intro }
parts:
  - id: inv
    kind: investigation
    title: 探偵パート
    scenes:
      intro:
        - investigate: room
    places:
      room:
        name: 部屋
        examine:
          - id: cup
            area: [50, 45, 20, 20]
            then:
              - me: コップだ。
          - id: table
            area: [20, 30, 80, 50]
            then:
              - me: 机だ。
              - set: { open: true }
          - id: box
            area: [150, 20, 30, 30]
            when: open
            then:
              - me: 箱だ。
          - id: wall
            area: [0, 0, 256, 192]
            then:
              - me: 壁だ。
`;

/** 先に並んだものが優先（examineAt と同じ規則）で、点 (x, y) に当たる範囲の番号 */
function owner(areas: Area[], x: number, y: number): number {
  return areas.findIndex(([ax, ay, w, h]) => x >= ax && x < ax + w && y >= ay && y < ay + h);
}

describe('examineSpots', () => {
  it('探偵メニューの外では空', () => {
    const sc = load(
      CHAPTER.replace('- investigate: room', '- me: まだ。\n        - investigate: room'),
    );
    expect(examineSpots(sc, new Engine(sc).state)).toEqual([]);
  });

  it('when が真のものだけを、並びの順に返す', () => {
    const sc = load(CHAPTER);
    const e = new Engine(sc);
    skip(e);
    expect(examineSpots(sc, e.state).map((s) => s.id)).toEqual(['cup', 'table', 'wall']);
    e.setFlag('open', true);
    expect(examineSpots(sc, e.state).map((s) => s.id)).toEqual(['cup', 'table', 'box', 'wall']);
  });

  it('中心が手前の範囲に隠れていなければ中心、隠れていれば当たる所に置く', () => {
    const sc = load(CHAPTER);
    const e = new Engine(sc);
    skip(e);
    const spots = examineSpots(sc, e.state);
    const byId = Object.fromEntries(spots.map((s) => [s.id, s]));
    expect(byId.cup!.point).toEqual([60, 55]);
    // 机の中心 (60, 55) はコップに隠れる
    expect(byId.table!.point).not.toEqual([60, 55]);
    // 壁の中心 (128, 96) は何にも隠れていない
    expect(byId.wall!.point).toEqual([128, 96]);
  });

  it('目印の点を調べると、その所に当たって調べた印が付く', () => {
    const sc = load(CHAPTER);
    const e = new Engine(sc);
    skip(e);
    e.setFlag('open', true);
    for (const s of examineSpots(sc, e.state)) {
      expect(s.seen).toBe(false);
      expect(s.point).not.toBeNull();
      e.examine(...s.point!);
      expect(e.state.seen).toContain(s.id);
      skip(e);
      const after = examineSpots(sc, e.state).find((x) => x.id === s.id);
      expect(after?.seen).toBe(true);
    }
  });

  it('未定義のフラグを読む条件は、選べないものとする（落ちない）', () => {
    const sc = load(CHAPTER);
    const e = new Engine(sc);
    skip(e);
    const broken = { ...e.state, flags: {} };
    expect(examineSpots(sc, broken).map((s) => s.id)).toEqual(['cup', 'table', 'wall']);
  });
});

describe('markerPoint', () => {
  it('手前の範囲にすっかり隠れるなら null', () => {
    expect(markerPoint([10, 10, 20, 20], [[0, 0, 100, 100]])).toBeNull();
  });

  it('隠れていない細い所しかなければ、そこに置く', () => {
    // 右端の 2 ドットだけが見えている
    const p = markerPoint([0, 0, 50, 50], [[0, 0, 48, 50]]);
    expect(p).not.toBeNull();
    expect(
      owner(
        [
          [0, 0, 48, 50],
          [0, 0, 50, 50],
        ],
        ...p!,
      ),
    ).toBe(1);
  });

  it('端から少し内側に置く', () => {
    // 左半分が隠れている → 見えている右半分の、中心寄りの端から 3 ドット内側
    expect(markerPoint([0, 0, 40, 20], [[0, 0, 24, 20]])).toEqual([27, 10]);
  });

  it('いろいろな重なり方で、点は必ずその範囲に当たり、当たる所があれば null にならない', () => {
    let seed = 12345;
    const rnd = (n: number) => {
      seed = (seed * 1103515245 + 12345) % 2 ** 31;
      return seed % n;
    };
    for (let t = 0; t < 300; t++) {
      const areas: Area[] = Array.from({ length: 1 + rnd(6) }, () => {
        const x = rnd(120),
          y = rnd(90);
        return [x, y, 1 + rnd(80), 1 + rnd(60)];
      });
      areas.forEach((a, i) => {
        const before = areas.slice(0, i);
        const p = markerPoint(a, before);
        if (p) {
          expect(owner(areas, ...p)).toBe(i);
          return;
        }
        // null なら、どの点も手前の範囲に当たる
        for (let x = a[0]; x < a[0] + a[2]; x++)
          for (let y = a[1]; y < a[1] + a[3]; y++) expect(owner(areas, x, y)).not.toBe(i);
      });
    }
  });
});
