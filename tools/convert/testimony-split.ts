// 尋問の文・証言の区画の命令列を分ける（ゆさぶりの行き先・言い直しの前後・証言の読む所）。testimony.ts から使う。
import type { Context } from './context.ts';
import type { Entry } from './types.ts';

export type CmdOps = Entry['body'][number]['ops'];

/**
 * 文の区画に 15（ゆさぶる先）が 2 つあり、1 つ目の前の 53 が 2 つ目の 15 へ飛ぶ形（例: 042 §12 = フラグ 50 が立っていれば §31）。
 * a = 飛ばないときのゆさぶり、b = 飛んだとき。flag / want = 53 の条件
 */
export function flagPress(
  ops: CmdOps,
): { a: number; b: number; flag: number; want: boolean; jumps: number[] } | null {
  const presses = ops.flatMap((o, i) => (o.op === 15 ? [i] : []));
  if (presses.length !== 2) return null;
  const [i, j] = presses as [number, number];
  const jump = ops
    .slice(0, i)
    .find((o) => o.op === 53 && !(o.args[0]! & 0x80) && o.target?.offset === ops[j]!.at);
  const sec = (o: CmdOps[number]) =>
    o.op === 'text' ? -1 : (o.targets?.[0]?.section ?? o.args[0]! - 128);
  if (!jump || jump.op === 'text') return null;
  // 2 つの 15 の間の、2 つ目を飛び越す 53 も（「立っていなければ文へ」）
  const jumps = ops
    .slice(0, j)
    .filter((o) => o.op === 53 && !(o.args[0]! & 0x80))
    .map((o) => o.at);
  return {
    a: sec(ops[i]!),
    b: sec(ops[j]!),
    flag: jump.args[0]! >> 8,
    want: (jump.args[0]! & 1) === 1,
    jumps,
  };
}

/** 尋問の文の区画の、言い直しの前後（53 のラベルで同じ区画の途中へ飛ぶもの） */
export interface Variant {
  ops: CmdOps;
  at: number;
  when: string | null;
  flag: { index: number; want: boolean } | null;
  press: number | null;
}

export function statementVariants(ctx: Context, section: number, ops: CmdOps): Variant[] {
  const k = ops.findIndex(
    (o) => o.op === 53 && o.target?.section === section && (o.target?.offset ?? 0) > 2,
  );
  const pressOf = (xs: CmdOps) => {
    const p = xs.find((o) => o.op === 15);
    return p && p.op !== 'text' ? (p.targets?.[0]?.section ?? p.args[0]! - 128) : null;
  };
  if (k < 0) return [{ ops, at: 0, when: null, flag: null, press: null }];
  const o = ops[k]!;
  if (o.op === 'text') return [{ ops, at: 0, when: null, flag: null, press: null }];
  const index = o.args[0]! >> 8,
    want = (o.args[0]! & 1) === 1;
  const at = o.target!.offset;
  const flag = ctx.fname(0, index);
  const cond = want ? flag : `not ${flag}`;
  const first = ops.filter((x, i) => i !== k && x.at < at);
  const second = [ops[0]!, ...ops.filter((x) => x.at >= at)];
  ctx.stats.gap('尋問の文の言い直し（区画の途中へのラベル）を 2 つの文にした', section);
  return [
    {
      ops: first,
      at: 0,
      when: want ? `not ${flag}` : flag,
      flag: { index, want: !want },
      press: pressOf(first),
    },
    { ops: second, at, when: cond, flag: { index, want }, press: pressOf(second) },
  ];
}

/**
 * 証言の区画を分ける: pre = T の「証言開始」（40 1）とタイトルのページまで、readingOps = そこから 40 0 まで（区画ごと）、
 * tailOps = 40 0 の後（その区画の残り）
 */
export function splitReading(reading: number[], body: (s: number) => CmdOps) {
  const pre: CmdOps = [];
  const readingOps: [number, CmdOps][] = [];
  let tailOps: [number, CmdOps] | null = null;
  let phase: 'pre' | 'title' | 'read' | 'tail' = 'pre';
  for (const r of reading) {
    const cur: CmdOps = [];
    for (const o of body(r)) {
      if (phase === 'tail') {
        tailOps![1].push(o);
        continue;
      }
      if (o.op === 40 && o.args[0] === 1 && phase === 'pre') {
        phase = 'title';
        continue;
      }
      if (o.op === 40 && o.args[0] === 0) {
        phase = 'tail';
        tailOps = [r, []];
        continue;
      }
      if (phase === 'pre' || phase === 'title') {
        pre.push(o);
        if (phase === 'title' && (o.op === 2 || o.op === 45)) phase = 'read';
        continue;
      }
      cur.push(o);
    }
    if (cur.length) readingOps.push([r, cur]);
  }
  return { pre, readingOps, tailOps };
}
