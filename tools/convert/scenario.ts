// 項目（1 つの編の台本）を、シナリオの 1 つの編（part: シーンと場所）にする。章へのまとめは chapter.ts。
import { Context, Shared, type InvPart } from './context.ts';
import { convertExamine, prepareExamine } from './examine3d.ts';
import { buildPlaces, initInvestigationFlags, prepareInvestigation } from './investigation.ts';
import { convertOps } from './section.ts';
import { buildTestimonies } from './testimony.ts';
import type { Entry, Op, Step, Tables } from './types.ts';

export interface PartOptions {
  /** 共通の台本（項目 072/073。尋問の見当違いの反応・「手がかりになるものはない」） */
  common?: Entry | null;
  /** 探偵パートの表（investigation.json） */
  inv?: InvPart | null;
  shared?: Shared;
  /** シーン・場所・フラグの ID の頭 */
  pfx?: string;
  /** 次の編へ（22 next_part）のステップ */
  nextPart?: Step[];
  title?: string;
}

/** 組（1 つの探偵パートが複数の項目にまたがるとき。ふつうは 1 項目）の 1 項目 */
export interface GroupMember { entry: Entry; inv: InvPart | null; pfx: string; nextPart?: Step[]; toPart?: (part: number) => Step[] }

export interface PartResult {
  ctx: Context;
  part: Record<string, unknown>;
  /** 最初のシーン */
  start: string;
  /** ゲームオーバーのシーン（法廷のパートで、その区画がシーンになっているとき） */
  gameover: string | null;
}

/** 1 つの項目を 1 つの編にする */
export function convertPart(t: Tables, entry: Entry, opts: PartOptions = {}): PartResult {
  const m: GroupMember = { entry, inv: opts.inv ?? null, pfx: opts.pfx ?? '', ...(opts.nextPart ? { nextPart: opts.nextPart } : {}) };
  return convertGroup(t, [m], { common: opts.common ?? null, shared: opts.shared, gpfx: opts.pfx ?? '' })[0]!;
}

/**
 * 組を変換する（項目ごとに 1 つの編）。1 回目で区画への移動を集め、選択肢・表からだけ行く区画（とそこからだけ続く区画）を、
 * 2 回目でその場に取り込む（シーンが減る）
 */
export function convertGroup(
  t: Tables, members: GroupMember[], opts: { common: Entry | null; shared?: Shared; gpfx: string },
): PartResult[] {
  const probe = new Shared();
  opts.shared?.profileRecords.forEach(r => probe.profileRecords.add(r));
  const first = convertPass(t, members, { ...opts, shared: probe }, members.map(() => new Set()));
  return convertPass(t, members, opts, first.map(r => inlineSet(r.ctx, r.ctx.entry)));
}

/** 取り込む区画: 移動が 1 つだけで、それが選択肢・表から（またはすでに取り込む区画から）のもの */
export function inlineSet(ctx: Context, entry: Entry): Set<number> {
  const out = new Set<number>();
  const ok = (s: number) => !ctx.consumed.has(s) && s !== entry.body[0]!.section
    && s !== ctx.court?.gameover_section && !ctx.redirect.has(s) && ![...ctx.pieces].some(p => p.startsWith(`${s}:`));
  for (let changed = true; changed;) {
    changed = false;
    for (const [s, refs] of ctx.refs) {
      if (out.has(s) || refs.length !== 1 || !ok(s)) continue;
      const r = refs[0]!;
      if (r.kind === 'choice' || out.has(r.from)) { out.add(s); changed = true; }
    }
  }
  return out;
}

function setup(ctx: Context, m: GroupMember, common: Entry | null, inline: Set<number>) {
  const entry = m.entry;
  if (m.nextPart) ctx.nextPart = m.nextPart;
  if (m.toPart) ctx.toPart = m.toPart;
  ctx.inline = inline;
  ctx.convertSection = s => (entry.body[s] ? convertOps(ctx, s, entry.body[s]!.ops) : [{ native: 'missing_section', args: [s] }]);
  // 共通の台本の区画: 編の表示（日時の表示 + 69）なら、表示してから次の編へ
  ctx.convertCommon = raw => {
    const ops = common?.body[raw]?.ops;
    if (!ops) return [{ native: 'common_section', args: [raw] }];
    ctx.stats.gap('共通の台本の区画へ飛ぶ（編の表示）', raw);
    const partEnd = ops.some(o => o.op === 69);
    return convertOps(ctx, raw, ops, { menuReturn: partEnd ? ctx.nextPart : undefined, gotoSteps: () => [] });
  };
}

function convertPass(
  t: Tables, members: GroupMember[], opts: { common: Entry | null; shared?: Shared; gpfx: string }, inline: Set<number>[],
): PartResult[] {
  const ctxs = members.map(m => new Context(t, m.entry, { shared: opts.shared, pfx: m.pfx, gpfx: opts.gpfx, inv: m.inv }));
  const group = new Map(ctxs.map(c => [c.entry.entry, c]));
  ctxs.forEach((ctx, k) => {
    ctx.group = group;
    setup(ctx, members[k]!, opts.common, inline[k]!);
    if (ctx.inv) { prepareInvestigation(ctx); initInvestigationFlags(ctx); }
    prepareExamine(ctx);
  });
  const scenesOf = ctxs.map(ctx => emitEntry(ctx, opts.common));
  ctxs.forEach(convertExamine);
  const head = ctxs[0]!;
  const places = head.inv ? buildPlaces(head, opts.common) : null;
  if (places) scenesOf[0]![head.menuScene()] = places.menu;
  // 取り込んだ区画へ別の所から飛ぶならその区画も、区画の途中へ飛ぶならそこから先も、シーンとして出す
  for (let changed = true; changed;) {
    changed = false;
    ctxs.forEach((ctx, k) => { if (emitRest(ctx, scenesOf[k]!)) changed = true; });
  }
  return ctxs.map((ctx, k) => {
    const kind = ctx.inv ? 'investigation' : 'trial';
    const part: Record<string, unknown> = {
      id: `part${ctx.part}`,
      kind,
      title: kind === 'investigation' ? '探偵パート' : '法廷パート',
      scenes: scenesOf[k],
      ...(k === 0 && places ? { places: places.places } : {}),
    };
    const go = ctx.court ? ctx.sid(ctx.court.gameover_section) : null;
    // 探偵パートの始め: 最初の場所の着いたときの会話があれば、§0 ではなくそこから（元のゲームでは §0 を追い越す）
    const start = k === 0 && places?.startAtMenu ? ctx.menuScene() : ctx.sid(ctx.entry.body[0]!.section);
    return { ctx, part, start, gameover: go && scenesOf[k]![go] !== undefined ? go : null };
  });
}

/** 項目の区画をシーンにする（証言に取り込んだもの・その場に取り込むものは除く） */
function emitEntry(ctx: Context, common: Entry | null): Record<string, unknown> {
  const scenes: Record<string, unknown> = {};
  const testimonies = buildTestimonies(ctx, common);
  for (const sec of ctx.entry.body) {
    const k = sec.section;
    const tm = testimonies.get(k);
    if (tm) {
      // 読むのと尋問が同じ区画なら、その区画の「証言開始」の前が証言の前のシーン
      const pre = ctx.preScenes.get(k);
      if (pre) scenes[ctx.sid(k)] = pre;
      scenes[tm.id] = tm.scene;
      continue;
    }
    if (ctx.consumed.has(k) || ctx.inline.has(k)) continue;
    scenes[ctx.sid(k)] = ctx.preScenes.get(k) ?? convertOps(ctx, k, sec.ops);
  }
  return scenes;
}

/** まだ出していない行き先（区画・区画の途中）をシーンにする。出したら true */
function emitRest(ctx: Context, scenes: Record<string, unknown>): boolean {
  const entry = ctx.entry;
  let changed = false;
  for (const r of [...ctx.referenced]) {
    if (scenes[ctx.scene(r)] !== undefined || ctx.redirect.has(r)) continue;
    if (!entry.body[r]) { ctx.stats.gap('無い区画への移動', r); scenes[ctx.scene(r)] = [{ native: 'missing_section', args: [r] }]; continue; }
    ctx.stats.gap('取り込んだ区画へ別の所からも飛ぶので、シーンとしても出した', r);
    scenes[ctx.sid(r)] = ctx.preScenes.get(r) ?? convertOps(ctx, r, entry.body[r]!.ops);
    changed = true;
  }
  for (const p of [...ctx.pieces]) {
    const [s, at] = p.split(':').map(Number) as [number, number];
    if (scenes[ctx.sid(s, at)] !== undefined) continue;
    scenes[ctx.sid(s, at)] = convertOps(ctx, s, entry.body[s]!.ops.filter(o => o.at >= at));
    changed = true;
  }
  return changed;
}

/** 命令列をバイト位置で切る（区画の途中から始まるシーンの確認用） */
export function cutOps(ops: Op[], cuts: number[]): Op[][] {
  const out: Op[][] = [[]];
  let c = 0;
  for (const o of ops) {
    while (c < cuts.length && o.at >= cuts[c]!) { out.push([]); c++; }
    out.at(-1)!.push(o);
  }
  while (out.length < cuts.length + 1) out.push([]);
  return out;
}
