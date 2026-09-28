// 元の台本で本当に使われていない区画（ROM に残った古い版など）のシーンを、変換の結果から除く。
// 「使われていない」= 表（尋問・つきつけ・探偵パート・3D で調べる）と、そこから静的にたどれる区画のどれでもなく、
// 変換した章の中でもどこからも移動しない区画。表からたどれるのにどこからも移動しないものは変換の誤りなので、残して警告に出す。
import type { Context } from './context.ts';
import { staticTargets } from './flow.ts';
import { scriptEntryOf } from './investigation.ts';
import { isStorySection } from './tables.ts';
import type { Step } from './types.ts';

/** 表と、そこから静的にたどれる区画 */
export function usedSections(ctx: Context): Set<number> {
  const e = ctx.entry;
  const roots = new Set<number>([e.body[0]!.section, ...ctx.examineSteps.keys()]);
  const c = ctx.court;
  if (c && !ctx.inv) for (const s of ctx.tableRefs()) roots.add(s);
  // 探偵パート: 場所ごとの表（着いたとき・調べる・話す・つきつける）のうち、その場所の台本がこの項目のもの
  // （第 5 話では場所ごとに読み込む項目が違う）。法廷のつきつけの表（0x020b44c8[パート]）は探偵パートでは使わない
  if (ctx.inv) {
    const inv = ctx.inv;
    const mine = new Set<number>(
      (inv.places ?? [])
        .filter((pl: object) => scriptEntryOf(ctx, pl) === e.entry)
        .map((pl: { id: number }) => pl.id),
    );
    const walk = (x: unknown): void => {
      if (Array.isArray(x)) {
        x.forEach(walk);
        return;
      }
      if (typeof x !== 'object' || x === null) return;
      const o = x as Record<string, unknown>;
      if (typeof o.section === 'number' && isStorySection(o)) roots.add(o.section);
      Object.values(o).forEach(walk);
    };
    for (const pl of inv.places ?? []) {
      if (!mine.has(pl.id)) continue;
      walk([pl.on_enter, pl.every_frame]);
      for (const path of [...pl.on_enter, ...pl.every_frame]) {
        for (const d of path.do)
          if (typeof d.examine === 'string') walk(inv.examine_tables?.[d.examine]);
      }
    }
    walk((inv.talk ?? []).filter((t: { place: number }) => mine.has(t.place)));
    walk((inv.present?.entries ?? []).filter((t: { place: number }) => mine.has(t.place)));
    if (c)
      for (const s of ctx.tableRefs())
        if (!inCourtPresent(ctx, s) && !invOnly(ctx, s)) roots.add(s);
  }
  const out = new Set(roots);
  for (let changed = true; changed; ) {
    changed = false;
    for (const s of [...out])
      for (const t of staticTargets(e, s))
        if (!out.has(t)) {
          out.add(t);
          changed = true;
        }
  }
  return out;
}

/** 区画が、探偵パートの表（場所・話す・調べる・つきつける）に出てくるか（それはこの項目の場所かどうかで上で決める） */
function invOnly(ctx: Context, s: number): boolean {
  let hit = false;
  const walk = (x: unknown, key = ''): void => {
    if (hit || key === 'court_present') return;
    if (Array.isArray(x)) {
      x.forEach((v) => walk(v));
      return;
    }
    if (typeof x !== 'object' || x === null) return;
    const o = x as Record<string, unknown>;
    if (o.section === s && isStorySection(o)) {
      hit = true;
      return;
    }
    for (const [k, v] of Object.entries(o)) walk(v, k);
  };
  walk(ctx.inv);
  return hit;
}

/** 区画が、探偵パートの法廷のつきつけの表だけに出てくるか */
function inCourtPresent(ctx: Context, s: number): boolean {
  const cp = (ctx.inv?.court_present?.entries ?? []) as {
    at?: { section: number };
    section?: { section: number };
  }[];
  return cp.some((x) => x.at?.section === s || x.section?.section === s);
}

/** シーン ID → 区画（区画のシーン `<頭>s<番号>` と、区画の途中から始まるシーン `<頭>s<番号>_<位置>`） */
function sectionOf(ctx: Context, id: string): number | null {
  const m = id.startsWith(ctx.pfx) ? /^s(\d{3})(?:_\d+)?$/.exec(id.slice(ctx.pfx.length)) : null;
  return m ? Number(m[1]) : null;
}

/** 章の中で行き先になるシーン（goto / investigate、書いた順で次のシーンへ落ちるもの、最初・ゲームオーバー） */
function referencedScenes(scenario: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  const walk = (x: unknown): void => {
    if (Array.isArray(x)) {
      x.forEach(walk);
      return;
    }
    if (typeof x !== 'object' || x === null) return;
    for (const [k, v] of Object.entries(x)) {
      if (
        (k === 'goto' || k === 'investigate' || k === 'scene' || k === 'gameover') &&
        typeof v === 'string'
      )
        out.add(v);
      else walk(v);
    }
  };
  walk(scenario);
  const parts = (scenario.parts ?? []) as { scenes?: Record<string, unknown> }[];
  const order = parts.flatMap((p) => Object.entries(p.scenes ?? {}));
  order.forEach(([, body], i) => {
    const last = Array.isArray(body) ? (body.at(-1) as Step | undefined) : undefined;
    if (
      Array.isArray(body) &&
      !(last && ['goto', 'end', 'gameover', 'investigate'].some((k) => k in last))
    ) {
      const next = order[i + 1];
      if (next) out.add(next[0]);
    }
  });
  return out;
}

/** 使われていない区画のシーンを除く（除いたら、そのシーンからだけ行くシーンも調べ直す）。除いた数を返す */
export function pruneUnusedScenes(scenario: Record<string, unknown>, ctxs: Context[]): number {
  const used = new Map(ctxs.map((c) => [c, usedSections(c)] as const));
  const parts = (scenario.parts ?? []) as { scenes?: Record<string, unknown> }[];
  let removed = 0;
  for (let changed = true; changed; ) {
    changed = false;
    const refs = referencedScenes(scenario);
    for (const p of parts) {
      for (const id of Object.keys(p.scenes ?? {})) {
        if (refs.has(id) || !Array.isArray(p.scenes![id])) continue;
        const ctx = ctxs.find((c) => sectionOf(c, id) !== null);
        const s = ctx ? sectionOf(ctx, id)! : null;
        if (!ctx || s === null) continue;
        const body = ctx.entry.body[s];
        // 中身のない区画（nop と end だけ）は、組の 2 つ目からの項目の始まり（§0 から落ちていくだけ）
        const trivial = !body || body.ops.every((o) => o.op === 0 || o.op === 13);
        // 証言・つきつけ・その場に取り込んだ区画は、中身が取り込んだ所にある
        const taken = ctx.consumed.has(s) || ctx.inline.has(s) || ctx.redirect.has(s);
        // 探偵パートの §0 は、最初の場所の着いたときの会話から始めるときは通らない
        if (used.get(ctx)!.has(s) && s !== ctx.entry.body[0]!.section && !trivial && !taken)
          continue;
        delete p.scenes![id];
        ctx.stats.gap(
          used.get(ctx)!.has(s) || !body
            ? '取り込んだ区画・中身のない区画で、どこからも移動しないシーンを出さなかった'
            : '元の台本でどこからも行けない区画（使われていない）をシーンにしなかった',
          s,
        );
        removed++;
        changed = true;
      }
    }
  }
  return removed;
}
