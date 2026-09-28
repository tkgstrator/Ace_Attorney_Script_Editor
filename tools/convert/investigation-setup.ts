// 探偵パートの準備（行き先の版・会話 event）・最初の場所・日の始めと探偵パートの始めのフラグ（investigation.ts から使う）。
import type { Context } from './context.ts';

/** パート < 17 では、このフラグ（0x41）が立つまで「調べる」は区画 0x8d（§13）になる */
export const EXAMINE_READY = 0x41;

/** その場所の区画がある項目（第 5 話の script_items）。無ければ今の項目 */
export const scriptEntryOf = (ctx: Context, pl: { script_items?: string[] }): number =>
  pl.script_items?.length ? Number(pl.script_items[0]) : ctx.entry.entry;

/** その場所の区画を変換する Context（組の中の、その項目の Context） */
export const ctxOf = (ctx: Context, pl: { script_items?: string[] }): Context =>
  ctx.group.get(scriptEntryOf(ctx, pl)) ?? ctx;

/** 探偵パートの準備: 行き先の版（51。組のすべての項目から）と、この項目にある会話 event の区画 */
export function prepareInvestigation(ctx: Context) {
  const inv = ctx.inv!;
  const moves = new Map<number, number[][]>();
  for (const pl of inv.places) moves.set(pl.id, [pl.dest]);
  const bodies = ctx.group.size
    ? [...ctx.group.values()].flatMap((c) => c.entry.body)
    : ctx.entry.body;
  for (const sec of bodies) {
    for (const o of sec.ops) {
      if (o.op !== 51) continue;
      const [p, ...d] = o.args;
      const list = moves.get(p!) ?? [];
      const dest = d.filter((x) => x !== 255);
      if (!list.some((v) => v.join() === dest.join())) list.push(dest);
      moves.set(p!, list);
    }
  }
  ctx.moveVersions = moves;
  for (const pl of inv.places) {
    if (scriptEntryOf(ctx, pl) !== ctx.entry.entry) continue;
    for (const path of pl.on_enter)
      for (const d of path.do) if (d.event) ctx.eventSections.set(d.event.section, pl.id);
  }
}

/**
 * 一日の終わり（52 wait_ui15 = セーブの画面 → 21）の後に行く場所。元のゲームで場所を決める仕組みは未解明なので、
 * 「その区画より後の、日時の表示（93 align 1）がある会話 event のうち、それまでに立つフラグで道の条件を満たす最初のもの」の場所にする
 */
export function nextDayPlace(ctx: Context, section: number): number | null {
  const inv = ctx.inv!;
  const set = new Set<string>();
  for (const sec of ctx.entry.body) {
    if (sec.section > section) break;
    for (const o of sec.ops) if (o.op === 16 && o.args[0]! >> 15) set.add(`0:${o.args[0]! & 0xff}`);
  }
  for (const pl of inv.places) {
    for (const path of pl.on_enter) {
      for (const d of path.do) {
        if (d.event && d.event.section <= section && d.set_flag)
          set.add(`0:${Number(String(d.set_flag).split(':')[1])}`);
      }
    }
  }
  const ok = (when: Record<string, number | string>) =>
    Object.entries(when).every(([k, v]) => {
      if (k === 'lang') return v === ctx.entry.lang;
      const [g, n] = k.split(':');
      return set.has(`${g}:${Number(n)}`) === (v === 1);
    });
  let best: { e: number; place: number } | null = null;
  for (const pl of inv.places) {
    if (scriptEntryOf(ctx, pl) !== ctx.entry.entry) continue;
    for (const path of pl.on_enter) {
      for (const d of path.do) {
        const e = d.event?.section as number | undefined;
        if (e === undefined || e <= section || !ok(path.when)) continue;
        const card = ctx.entry.body[e]?.ops.some((o) => o.op === 93 && o.args[0] === 1);
        if (card && (!best || e < best.e)) best = { e, place: pl.id };
      }
    }
  }
  return best?.place ?? null;
}

/** 最初に行く場所: ARM9 の始めの関数が決める場所（invest_start.json）、無ければ §0 から落ちていく最初の event の場所 */
export function startPlace(ctx: Context): number {
  // invest_start.json の鍵はパート（game+0x69）。逆転裁判3 は項目 >> 1 と違うので探偵パートの表の part
  const part = ctx.t.game === 'aa1' ? ctx.part : (ctx.inv?.part ?? ctx.part);
  const known = ctx.t.investStart?.[String(part)];
  if (known !== undefined) return known;
  for (let s = 0; s < ctx.entry.body.length; s++) {
    if (ctx.eventSections.has(s)) return ctx.eventSections.get(s)!;
    const ops = ctx.entry.body[s]!.ops;
    if (ops.some((o) => o.op === 21 || o.op === 10 || o.op === 54 || o.op === 8 || o.op === 9))
      break;
  }
  return ctx.inv!.places[0]?.id ?? 0;
}

/** 始めのフラグ（組 0 は 0、パート > 1 ならフラグ 0x41 = 1）で、最初の場所の着いたときの道に会話 event があるか */
export function startsWithEvent(ctx: Context, place: number): boolean {
  const pl = ctx.inv!.places.find((p: { id: number }) => p.id === place);
  const init = (k: string) =>
    k === `0:0x${EXAMINE_READY.toString(16)}` && ctx.inv!.part > 1 ? 1 : 0;
  const path = pl?.on_enter.find((p: { when: Record<string, number | string> }) =>
    Object.entries(p.when).every(([k, v]) => (k === 'lang' ? v === ctx.entry.lang : init(k) === v)),
  );
  return !!path?.do.some((d: { event?: unknown }) => d.event);
}

/** パート > 1 ではフラグ 0x41 が最初から立っている */
export function initInvestigationFlags(ctx: Context) {
  ctx.fname(0, EXAMINE_READY);
}

/** 探偵パートの始めのフラグ: パート < 17 なら組 0 を 0 に戻し、パート > 1 ならフラグ 0x41 = 1 */
/**
 * 第 5 話の日の始め（探偵パート 0x16 / 0x1c、法廷 0x13 / 0x19 / 0x1f）のフラグ。台本のフラグ（組 0）を戻す:
 * 第 5 話の台本は日ごとに同じ番号を別の意味で使い（例: 034 §8 の話題の既読 0x2a を 038 の尋問で 138 の道の印に使う）、
 * どの日も前の日にだけ立つフラグは読まない（台本と探偵パートの表で確かめた）。元のゲームで消す所は見つかっていない（推測）。
 * 法廷の日は、ARM9 のパートの始め（0x0202f7dc〜）が決めるもの（0x1f = 茜が一緒か、ほかは尋問の進み具合）もそのとおりに。
 * 0x1f はコードが決めるので戻さない
 */
export function dayStartFlags(
  part: number,
  flags: string[],
  game = 'aa1',
): Record<string, boolean | number> | null {
  // 逆転裁判2・3: どのパートの始めでも組 0 を 0 にする（探偵 A2GJ 0x02036888 / YG3J 0x02034d4c、
  // 法廷 YG3J 0x0202f630。場所の状態 game+0x398 も 0 にする）
  if (game !== 'aa1') {
    const out: Record<string, boolean | number> = {};
    for (const f of flags) if (f.startsWith('f_0_')) out[f] = false;
    for (const f of flags) if (/(^|_)pstate_\d+$/.test(f)) out[f] = 0;
    return out;
  }
  const rom: Record<number, Record<number, boolean>> = {
    19: { 2: false, 33: false, 34: false, 31: true },
    22: {},
    25: { 15: false, 16: false, 35: false, 36: false, 31: true },
    28: {},
    31: { 37: false, 38: false, 39: false, 31: false },
  };
  if (!rom[part]) return null;
  // ツボを一度組み立てたか（組 0 の 0x1d。ARM9 が立てる。minigames.ts）は、パート 22 の始め（0x02036198）でしか消さない
  const keep = part === 22 ? ['f_0_31'] : ['f_0_31', 'f_0_29'];
  const out: Record<string, boolean> = {};
  for (const f of flags) if (f.startsWith('f_0_') && !keep.includes(f)) out[f] = false;
  for (const [n, v] of Object.entries(rom[part]!)) out[`f_0_${n}`] = v;
  return out;
}

export function investigationStartFlags(
  part: number,
  flags: string[],
  game = 'aa1',
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (game !== 'aa1') {
    for (const f of flags) if (f.startsWith('f_0_')) out[f] = false;
    return out;
  }
  if (part < 17) for (const f of flags) if (f.startsWith('f_0_')) out[f] = false;
  if (part > 1) out[`f_0_${EXAMINE_READY}`] = true;
  return out;
}
