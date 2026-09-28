// サイコ・ロック（逆転裁判2・3）を、普通の命令（フラグ・分岐・シーン移動）に直す。
//
// YAML の書き方（docs/scenario.md の「サイコ・ロック」）:
//   psycheLock: { keys: [勾玉の証拠品 ID], heal: 40 }        # 章全体: 挑むのに使う証拠品と、解除したときの回復量
//   - psycheLock: lock0                                     # ロックを決める（書いた欄だけ変える。書けば有効になる）
//     locks: 3, person: 人物, place: 場所, start: シーン, quit: シーン, gaugeOut: シーン
//   - demand: …, giveUp: true                               # 挑戦中のつきつけ。「やめる」で quit のシーンへ
//   - breakLock: true                                       # 錠を 1 つ壊す（最後なら解除: 回復・ロックを無効に）
//   - unlock: true                                          # その場で解除する
// ロックの中身はフラグ（core の lockFlag）に持つ。場所で勾玉をつきつけると、その場所・今いる人物の有効なロックに挑む
// （挑戦中のロック = LOCK_CURRENT、残りの錠 = LOCK_LEFT）。シーンの値はフラグの文字列なので、移る所は、
// 章の中に書かれた値すべての分岐にする（整合性チェックは普通の分岐として調べられる）。
import {
  type Expr,
  type Instr,
  LOCK_CURRENT,
  LOCK_LEFT,
  lockEndScene,
  lockFlag,
  type Scene,
  type Value,
} from '@gyakusai/core';
import { Builder, patch } from './builder.ts';

/** 章の中のロックの定義（psycheLock のステップ）から集めた、欄ごとの値 */
export interface LockInfo {
  counts: Set<number>;
  persons: Set<string>;
  places: Set<string>;
  starts: Set<string>;
  quits: Set<string>;
  outs: Set<string>;
}

export type LockRegistry = Map<string, LockInfo>;

/** 章の中の psycheLock のステップを集める（ステップはどこに書いてあってもよいので、中身を全部たどる） */
export function collectLocks(raw: unknown): LockRegistry {
  const out: LockRegistry = new Map();
  const seen = new Set<object>();
  const walk = (x: unknown): void => {
    if (typeof x !== 'object' || x === null || seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) {
      x.forEach(walk);
      return;
    }
    const o = x as Record<string, unknown>;
    if (typeof o.psycheLock === 'string') {
      let info = out.get(o.psycheLock);
      if (!info) {
        info = {
          counts: new Set(),
          persons: new Set(),
          places: new Set(),
          starts: new Set(),
          quits: new Set(),
          outs: new Set(),
        };
        out.set(o.psycheLock, info);
      }
      if (typeof o.locks === 'number') info.counts.add(o.locks);
      if (typeof o.person === 'string') info.persons.add(o.person);
      if (typeof o.place === 'string') info.places.add(o.place);
      if (typeof o.start === 'string') info.starts.add(o.start);
      if (typeof o.quit === 'string') info.quits.add(o.quit);
      if (typeof o.gaugeOut === 'string') info.outs.add(o.gaugeOut);
    }
    Object.values(o).forEach(walk);
  };
  walk(raw);
  return out;
}

/** ロックのフラグと初期値（章の flags に足す） */
export function lockFlags(reg: LockRegistry): Record<string, Value> {
  if (reg.size === 0) return {};
  const out: Record<string, Value> = { [LOCK_CURRENT]: '', [LOCK_LEFT]: 0 };
  for (const id of reg.keys()) {
    out[lockFlag(id, 'active')] = false;
    out[lockFlag(id, 'count')] = 0;
    for (const f of ['person', 'place', 'start', 'quit', 'out'] as const) out[lockFlag(id, f)] = '';
  }
  return out;
}

const v = (name: string): Expr => ({ t: 'var', name });
const lit = (x: Value): Expr => ({ t: 'lit', v: x });
const eq = (name: string, x: Value): Expr => ({ t: 'bin', op: '==', l: v(name), r: lit(x) });
const and = (l: Expr, r: Expr): Expr => ({ t: 'bin', op: '&&', l, r });
const or = (l: Expr, r: Expr): Expr => ({ t: 'bin', op: '||', l, r });
const not = (e: Expr): Expr => ({ t: 'not', e });

/** 条件が真のときだけ body を実行する */
function when(b: Builder, cond: Expr, body: () => void): void {
  const j = b.emit({ op: 'jumpUnless', cond, to: -1 });
  body();
  patch(b, j, b.pc);
}

/** 解除する: 回復し、挑戦中のロックを無効にして挑戦を終える */
export function emitUnlock(b: Builder, reg: LockRegistry, heal: number): void {
  if (heal > 0) b.emit({ op: 'heal', amount: heal });
  b.emit({ op: 'locks', show: 'unlock' });
  for (const id of reg.keys())
    when(b, eq(LOCK_CURRENT, id), () => {
      b.emit({ op: 'set', flag: lockFlag(id, 'active'), value: false });
    });
  b.emit({ op: 'set', flag: LOCK_CURRENT, value: '' });
  b.emit({ op: 'set', flag: LOCK_LEFT, value: 0 });
}

/** 錠を壊す前の残りの上限 */
const MAX_LEFT = 5;

/** 錠を 1 つ壊す。hold でなければ、最後の錠で解除する */
export function emitBreak(b: Builder, reg: LockRegistry, heal: number, hold: boolean): void {
  // 残りは 5 より多ければ 5 にしてから減らす（YG3J 0x0203593c・A2GJ 0x0205122c。逆転裁判3 の第 5 話の春美は
  // 錠 6 つで 5 回壊すと解除）
  when(b, { t: 'bin', op: '>', l: v(LOCK_LEFT), r: lit(MAX_LEFT) }, () => {
    b.emit({ op: 'set', flag: LOCK_LEFT, value: MAX_LEFT });
  });
  b.emit({ op: 'add', flag: LOCK_LEFT, amount: -1 });
  b.emit({ op: 'locks', show: 'break' });
  if (!hold)
    when(b, { t: 'bin', op: '<=', l: v(LOCK_LEFT), r: lit(0) }, () => emitUnlock(b, reg, heal));
}

/** 「やめる」: 挑戦を終え、そのロックの quit のシーンへ。どれにも当たらなければ end の後ろ（fallback）へ */
export function emitGiveUp(b: Builder, reg: LockRegistry): number[] {
  const exits: number[] = [];
  for (const [id, info] of reg) {
    for (const q of info.quits) {
      when(b, and(eq(LOCK_CURRENT, id), eq(lockFlag(id, 'quit'), q)), () => {
        b.emit({ op: 'set', flag: LOCK_CURRENT, value: '' });
        b.emit({ op: 'locks', show: 'unlock' });
        b.emit({ op: 'goto', scene: q });
      });
    }
  }
  exits.push(b.emit({ op: 'jump', to: -1 }));
  return exits;
}

/**
 * 場所で勾玉をつきつけたとき: その場所・今いる人物の有効なロックがあれば挑む（残りの錠を戻し、start のシーンへ）。
 * 無ければ fallback へ。場所の人物は person の一覧のうち when が真の最初の人物
 */
export function emitChallenge(
  b: Builder,
  reg: LockRegistry,
  place: string,
  person: { id: string; when?: Expr }[],
  fallback: number,
): void {
  // 「今いる人物が x」: 一覧の i 番目の when が真で、それより前の when がすべて偽
  const personIs = (field: string): Expr | null => {
    let out: Expr | null = null;
    let before: Expr | null = null;
    for (const p of person) {
      let c: Expr = eq(field, p.id);
      if (p.when) c = and(p.when, c);
      if (before) c = and(not(before), c);
      out = out ? or(out, c) : c;
      if (!p.when) break;
      before = before ? or(before, p.when) : p.when;
    }
    return out;
  };
  for (const [id, info] of reg) {
    if (!info.places.has(place)) continue;
    const who = personIs(lockFlag(id, 'person'));
    if (!who) continue;
    const cond = and(and(eq(lockFlag(id, 'active'), true), eq(lockFlag(id, 'place'), place)), who);
    when(b, cond, () => {
      b.emit({ op: 'set', flag: LOCK_CURRENT, value: id });
      for (const c of info.counts)
        when(b, eq(lockFlag(id, 'count'), c), () => {
          b.emit({ op: 'set', flag: LOCK_LEFT, value: c });
          b.emit({ op: 'locks', show: c });
        });
      for (const s of info.starts)
        when(b, eq(lockFlag(id, 'start'), s), () => {
          b.emit({ op: 'goto', scene: s });
        });
    });
  }
  b.emit({ op: 'jump', to: fallback });
}

/** psycheLock のステップ: 書いた欄だけフラグにし、ロックを有効にする */
export function emitDefine(b: Builder, s: Record<string, unknown>): void {
  const id = s.psycheLock as string;
  const set = (flag: string, value: Value) => b.emit({ op: 'set', flag, value } as Instr);
  set(lockFlag(id, 'active'), true);
  if (typeof s.locks === 'number') set(lockFlag(id, 'count'), s.locks);
  const fields = {
    person: 'person',
    place: 'place',
    start: 'start',
    quit: 'quit',
    gaugeOut: 'out',
  };
  for (const [k, f] of Object.entries(fields))
    if (typeof s[k] === 'string') set(lockFlag(id, f as 'person'), s[k] as string);
}

/**
 * クリア（end）。有効なまま残ったロックがあれば、先に印のシーン（lockEndScene）を通る。印のシーンは after より後の
 * ロックを同じように調べてから end する（整合性チェックが、外さずにクリアできるロックを 1 つずつ報告する）
 */
export function emitEnd(b: Builder, reg: LockRegistry, after?: string): void {
  const ids = [...reg.keys()];
  for (const id of ids.slice(after === undefined ? 0 : ids.indexOf(after) + 1))
    when(b, eq(lockFlag(id, 'active'), true), () => {
      b.emit({ op: 'goto', scene: lockEndScene(id) });
    });
  b.emit({ op: 'end' });
}

/** ロックごとの印のシーン */
export function lockEndScenes(reg: LockRegistry): Record<string, Scene> {
  const out: Record<string, Scene> = {};
  for (const id of reg.keys()) {
    const b = new Builder();
    emitEnd(b, reg, id);
    out[lockEndScene(id)] = { kind: 'dialogue', id: lockEndScene(id), program: b.code };
  }
  return out;
}

/** ロックの gaugeOut のシーン（ライフが尽きたときにだけ入る） */
export const lockOutScenes = (reg: LockRegistry): string[] => [
  ...new Set([...reg.values()].flatMap((i) => [...i.outs])),
];
