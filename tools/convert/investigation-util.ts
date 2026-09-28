// 探偵パートの変換の小さな道具（条件式・共通の台本の区画・探偵メニューへ戻る所）。investigation.ts から使う。
import type { Context } from './context.ts';
import { otherCond } from './invest23.ts';
import { convertOps } from './section.ts';
import type { Entry, Step } from './types.ts';

/** investigation.json の when（{"0:0x53": 0, ...}）→ 条件式 */
export function whenOf(ctx: Context, when: Record<string, number | string>): string {
  // 'lang' は言語（日本語の項目なら ja の道だけ）
  if (when.lang !== undefined && when.lang !== ctx.entry.lang) return 'false';
  // 2・3: 表・文脈の値での分岐（invest23.ts）
  const other = when._other ? otherCond(ctx, when._other as unknown as string[]) : [];
  if (other === null) return 'false';
  const parts = Object.entries(when)
    .filter(([k]) => k !== 'lang' && k !== '_other')
    .map(([k, v]) => {
      const [g, n] = k.split(':');
      const f = ctx.fname(Number(g), Number(n));
      return v ? f : `not ${f}`;
    });
  parts.push(...other);
  return parts.length ? parts.join(' and ') : 'true';
}

/** 「flag 0x49 == 1」→ 条件式 */
export function condOf(ctx: Context, cond: string): string {
  const m = cond.match(/flag\s+(0x[0-9a-f]+|\d+)\s*==\s*(\d)/i);
  if (!m) return 'true';
  const f = ctx.fname(0, Number(m[1]));
  return m[2] === '1' ? f : `not ${f}`;
}

export const or = (xs: string[]) =>
  xs.length === 1 ? xs[0]! : xs.map((x) => `(${x})`).join(' or ');
export const and = (xs: string[]) =>
  xs
    .filter((x) => x !== 'true')
    .map((x) => (/ or /.test(x) ? `(${x})` : x))
    .join(' and ') || 'true';

/** ブロックの最後の「探偵メニューへ戻る」は要らない（ブロックが終われば戻る）ので外す */
export function stripMenuReturn(ctx: Context, steps: Step[]): Step[] {
  const out = [...steps];
  const last = out.at(-1);
  if (last && 'goto' in last && last.goto === ctx.menuScene()) {
    out.pop();
    const prev = out.at(-1);
    if (prev && 'set' in prev && ctx.returnFlag() in (prev.set as object)) out.pop();
  } else if (last && 'if' in last) {
    out[out.length - 1] = {
      ...last,
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      then: stripMenuReturn(ctx, last.then as Step[]),
      ...(last.else ? { else: stripMenuReturn(ctx, last.else as Step[]) } : {}),
    };
  }
  return out;
}

/** 共通の台本（項目 072/073）の区画を、探偵メニューへ戻る所を外したステップ列にする（無ければ「……」） */
export function commonBlock(ctx: Context, common: Entry | null, section: number): Step[] {
  const sec = common?.body[section];
  return sec
    ? stripMenuReturn(ctx, convertOps(ctx, section, sec.ops, { menuReturn: [] }))
    : [{ narrate: '……' }];
}
