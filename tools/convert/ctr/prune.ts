// 変換した場所のステップから、その地点では絶対に成り立たない条件の枝を落とす。
//
// 場所の台本（_sceNN_bgNNNN_*）は話の全体で使い回されるので、L_TOPIC_INIT などが「進み具合のフラグ」で
// 出す話題を切り替えている。今いる探偵パートより後のファイルでしか立たないフラグの枝は、その探偵パートでは通らない。
// 通らない枝を残すと、整合性チェックの「どう遊んでもたどり着かない」が場所ごとに増える。
import type { Step } from './convert.ts';

/** フラグが（この地点で）立ちうるか。分からないものは true */
export type Possible = (flag: string) => boolean;

const LITERAL = /^(not )?([A-Za-z_]\w*)$/;

/** 条件式が決まれば true / false、決まらなければ null。書けるのは変換が作る `f` `not f` と、その or の並びだけ */
export function evalCond(cond: unknown, possible: Possible): boolean | null {
  if (typeof cond !== 'string') return null;
  const parts = cond.replace(/^\((.*)\)$/, '$1').split(' or ');
  let unknown = false;
  for (const p of parts) {
    const m = p.trim().match(LITERAL);
    if (!m) return null;
    const can = possible(m[2]!);
    if (m[1]) {
      // not f: f が立ちえなければ常に真
      if (!can) return true;
      unknown = true;
    } else if (can) unknown = true;
  }
  return unknown ? null : false;
}

const isObj = (x: unknown): x is Record<string, unknown> =>
  typeof x === 'object' && x !== null && !Array.isArray(x);

function pruneArr(arr: unknown[], possible: Possible): unknown[] {
  const out: unknown[] = [];
  for (const el of arr) {
    if (isObj(el) && 'if' in el) {
      const c = evalCond(el.if, possible);
      if (c !== null) {
        const branch = c ? el.then : el.else;
        if (Array.isArray(branch)) out.push(...pruneArr(branch, possible));
        continue;
      }
    }
    out.push(prune(el, possible));
  }
  return out;
}

/** ステップの木を写して、決まった条件の枝を落とす */
export function prune<T>(x: T, possible: Possible): T {
  if (Array.isArray(x)) return pruneArr(x, possible) as T;
  if (!isObj(x)) return x;
  return Object.fromEntries(Object.entries(x).map(([k, v]) => [k, prune(v, possible)])) as T;
}

/** ステップの木の中で true にされるフラグ（`set: { f: true }`） */
export function setTrue(x: unknown, into: Set<string>): void {
  if (Array.isArray(x)) for (const e of x) setTrue(e, into);
  else if (isObj(x)) {
    if (isObj(x.set)) for (const [f, v] of Object.entries(x.set)) if (v === true) into.add(f);
    for (const v of Object.values(x)) setTrue(v, into);
  }
}
