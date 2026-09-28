// 逆転裁判2・3 の探偵パートの決まり（investigation.json の rules の、ゲームごとの違い）。investigation.ts から使う。
//   - 調べる: 表を見る前の決め打ちの区画と、何もない所の区画（A2GJ 0x02035108 / YG3J 0x02036124）
//   - つきつける: 1 項目 = [場所, 場所の状態（81）, 番号（0xff = どれでも）, 人物, 証拠品/人物ファイル, 区画, 既定の区画]。
//     場所の最初の項目から、人物・種類・状態・番号が合う項目の区画。無ければ人物・種類が合った最後の項目の既定の区画
//   - 着いたときの道の条件の _other（表の値での分岐）と、store（表への書き込み）
import type { Context } from './context.ts';
import { whenOf } from './investigation-util.ts';
import type { Step } from './types.ts';

type Sec = { raw: number; script: string; section: number };
type Block = (s: Sec) => Step[];

const sec = (raw: number): Sec =>
  raw >= 0x80
    ? { raw, script: 'story', section: raw - 0x80 }
    : { raw, script: 'common', section: raw };

/** 調べる所の前に見る決め打ち（パート・場所・フラグ → 区画）と、何もない所の区画 */
const EXAMINE: Record<
  string,
  {
    before: { part: number; place: number; flags?: [number, number][]; raw: number }[];
    fallback: (part: number, place: number) => number;
  }
> = {
  aa2: {
    before: [
      {
        part: 2,
        place: 5,
        flags: [
          [0x41, 1],
          [0x48, 0],
        ],
        raw: 0xe8,
      },
      { part: 14, place: 0, raw: 0xc7 },
      { part: 15, place: 0, flags: [[0xbc, 1]], raw: 0x14f },
      { part: 18, place: 20, flags: [[0x92, 0]], raw: 0xa5 },
    ],
    fallback: (part, place) =>
      part === 15 && place === 23
        ? 0x15a
        : part === 18 && (place === 25 || place === 21)
          ? 0x10c
          : 0x1f,
  },
  aa3: {
    before: [
      {
        part: 2,
        place: 3,
        flags: [
          [0x13, 0],
          [0xa, 1],
        ],
        raw: 0x12a,
      },
      { part: 4, place: 2, raw: 0xe1 },
    ],
    fallback: (part) => (part === 15 ? 0x23 : 0x22),
  },
};

/**
 * 逆転裁判3 の 108 0（YG3J 0x020581ac）: 今の区画（文脈 +0x4a）で決め打ちの話題を、話題の表（RAM 0x020beb54）の
 * 項目 29（パート 2・場所 7 の矢張）の空いている欄に足す。§92 の後は話題 30（既読 0x25・§93）、§103 の後は
 * 話題 31（既読 0x26・§94）、両方なら 2 つとも。台本の 108 は足した印のフラグを立て（ops23.ts）、話題はその印で出す
 */
const TALK_ADD_108: Record<
  number,
  { table: number; at: number; topic: number; read: number; section: number }[]
> = {
  2: [
    { table: 29, at: 92, topic: 30, read: 0x25, section: 93 },
    { table: 29, at: 103, topic: 31, read: 0x26, section: 94 },
  ],
};

/** 108 で足した印のフラグ（区画ごと） */
export const talkAddFlag = (ctx: Context, section: number): string =>
  ctx.flag(`${ctx.gpfx}talk108_${section}`, false);

/** 話題の表の項目 table に 108 で足す話題（{t: 話題, cond: 足した印}） */
export function talkAdds23(ctx: Context, table: number): { t: Row; cond: string }[] {
  if (ctx.t.game !== 'aa3') return [];
  return (TALK_ADD_108[ctx.inv!.part as number] ?? [])
    .filter((a) => a.table === table)
    .map((a) => ({
      t: {
        topic: a.topic,
        name_ocr: ctx.inv!.topic_names?.[a.topic] ?? null,
        read_flag: a.read,
        section: { section: a.section, script: 'story' },
      },
      cond: talkAddFlag(ctx, a.at),
    }));
}

/** 何もない所を調べたとき（決め打ちの区画を先に） */
export function examineDefault23(
  ctx: Context,
  place: number,
  block: Block,
  common: (section: number) => Step[],
): Step[] {
  const rule = EXAMINE[ctx.t.game]!;
  const part = ctx.inv!.part as number;
  const of = (raw: number) => (raw >= 0x80 ? block(sec(raw)) : common(raw));
  let out = of(rule.fallback(part, place));
  for (const b of [...rule.before].reverse()) {
    if (b.part !== part || b.place !== place) continue;
    const cond = (b.flags ?? [])
      .map(([f, v]) => (v ? ctx.fname(0, f) : `not ${ctx.fname(0, f)}`))
      .join(' and ');
    // 条件の無い決め打ちは、その場所のどこを調べてもその区画
    // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
    out = cond ? [{ if: cond, then: of(b.raw), else: out }] : of(b.raw);
  }
  return out;
}

/** 調べる所より先に見る決め打ちの条件（'true' はいつも。調べる所の when に「そうでない」を足す） */
export function examineBlockers(ctx: Context, place: number): string[] {
  const part = ctx.inv!.part as number;
  return EXAMINE[ctx.t.game]!.before.filter((b) => b.part === part && b.place === place).map(
    (b) =>
      (b.flags ?? [])
        .map(([f, v]) => (v ? ctx.fname(0, f) : `not ${ctx.fname(0, f)}`))
        .join(' and ') || 'true',
  );
}

/** 調べる所の条件（「flag 0xa9 == 1 and part == 19」など）→ 条件式 */
export function condOf23(ctx: Context, cond: string): string {
  if (cond.startsWith('never')) return 'false';
  const parts: string[] = [];
  for (const c of cond.split(/\s+and\s+/)) {
    const f = c.match(/flag\s+(0x[0-9a-f]+|\d+)\s*==\s*(\d)/i);
    if (f) {
      const n = ctx.fname(0, Number(f[1]));
      parts.push(f[2] === '1' ? n : `not ${n}`);
      continue;
    }
    const p = c.match(/(part|place)\s*==\s*(\d+)/);
    if (p && p[1] === 'part' && Number(p[2]) !== ctx.inv!.part) return 'false';
    // 場所の比べは、調べる所がその場所のものなので真
  }
  return parts.length ? parts.join(' and ') : 'true';
}

/**
 * 着いたときの道の条件の _other: 「talk[5][3] eq 1 = True」（話題の項目 5 を使うか）は話題のフラグ。
 * 「ctx+0x4a ne 227 = True」（今の区画での分岐）は、探偵メニューに着いたときの区画が分からないので、
 * ふつうの場合（その区画ではない = True）の道だけを取る。どの道も取れなければ null（その道は通らない）
 */
export function otherCond(ctx: Context, other: string[]): string[] | null {
  const out: string[] = [];
  for (const o of other) {
    const t = o.match(/talk\[(\d+)\]\[3\]\s+(eq|ne)\s+(\d+)\s*=\s*(True|False)/);
    if (t) {
      const f = ctx.talkFlag(Number(t[1]));
      // 「talk[k][3] eq v」が真（ne なら偽）なら値は v
      const on = (t[3] === '1') === ((t[4] === 'True') === (t[2] === 'eq'));
      out.push(on ? f : `not ${f}`);
      continue;
    }
    if (/ctx\+0x4a ne \d+ = False/.test(o)) return null;
    // 台本を読んでいない（文脈 +0 のビット 3。探偵メニューにいる）とき。メニューで調べるので真
    if (o === 'ctx+0x0 & 0x8 eq 0 = False') continue;
    ctx.stats.gap('着いたときの道の、表・文脈の値での分岐（_other）を近似した', -1);
  }
  return out;
}

export type FrameRow = { when: Record<string, number | string>; do: Row[] };

/**
 * 毎フレームの処理（every_frame）で調べる表を替える場所の、表 → 番号と、今の表を覚える数のフラグ
 * （-1 = 着いたときの表、-2 = 空）。替えない場所は null
 */
export function frameTabs(
  ctx: Context,
  pl: { id: number; every_frame: FrameRow[] },
): { flag: string; index: Map<string, number> } | null {
  if (!pl.every_frame.some((r) => r.do.some((d) => 'examine' in d))) return null;
  const tables = pl.every_frame.flatMap((r) =>
    r.do.flatMap((d) => (typeof d.examine === 'string' ? [d.examine as string] : [])),
  );
  return {
    flag: ctx.flag(`${ctx.gpfx}exam_${pl.id}`, -1),
    index: new Map([...new Set(tables)].map((t, i) => [t, i])),
  };
}

/**
 * 毎フレームの処理の 1 行 → ステップ: フラグを立てる・調べる表を替える（最後の表）・場所を移す
 * （逆転裁判3: 今の場所 game+0x84 を替えて着き直す arrive_again）。条件の合わない行・何もしない行は空
 */
export function frameRowStep(
  ctx: Context,
  r: FrameRow,
  tabs: { flag: string; index: Map<string, number> } | null,
): Step[] {
  const steps: Step[] = r.do
    .filter((d) => d.set_flag)
    .map((d) => {
      const [g, n] = String(d.set_flag).split(':');
      return {
        set: { [ctx.fname(Number(g), Number(n))]: d.value === undefined ? true : !!d.value },
      };
    });
  const ex = [...r.do].reverse().find((d) => 'examine' in d);
  if (tabs && ex)
    steps.push({ set: { [tabs.flag]: ex.examine ? tabs.index.get(ex.examine)! : -2 } });
  const move = r.do.find((d) => d.store === 'game+0x84');
  if (move)
    steps.push({ set: { [ctx.returnFlag()]: false } }, { investigate: ctx.placeId(move.value) });
  if (!steps.length) return [];
  const cond = whenOf(ctx, r.when);
  if (cond === 'false') return [];
  // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
  return [{ if: cond, then: steps }];
}

/**
 * フラグ flag を台本で書き換えた直後の、毎フレームの処理（every_frame）の行（フラグ・調べる表）。今いる場所の行だけ
 * 動くので、場所のフラグも条件に入れる（蘇る逆転と、探偵パートでないときは空）
 */
export function frameReact(ctx: Context, flag: string): Step[] {
  if (ctx.t.game === 'aa1' || !ctx.inv) return [];
  const out: Step[] = [];
  for (const pl of ctx.inv.places as { id: number; every_frame: FrameRow[] }[]) {
    const tabs = frameTabs(ctx, pl);
    for (const r of pl.every_frame) {
      if (!r.do.some((d) => d.set_flag || 'examine' in d)) continue;
      const reads = Object.keys(r.when).some((k) => {
        const [g, n] = k.split(':');
        return k !== '_other' && k !== 'lang' && `f_${Number(g)}_${Number(n)}` === flag;
      });
      if (!reads) continue;
      const row = { when: r.when, do: r.do.filter((d) => !d.store) };
      for (const st of frameRowStep(ctx, row, tabs)) {
        const c = (st as { if: string }).if;
        out.push({
          ...st,
          if: `${ctx.placeFlag()} == ${pl.id} and ${c.includes(' or ') ? `(${c})` : c}`,
        });
      }
    }
  }
  return out;
}

/** 着いたとき・毎フレームの store（表への書き込み）→ ステップ */
export function storeStep(ctx: Context, d: { store: string; value: number }): Step | null {
  const t = d.store.match(/^talk\[(\d+)\]\[3\]$/);
  if (t) return { set: { [ctx.talkFlag(Number(t[1]))]: d.value === 1 } };
  ctx.stats.gap(`着いたときの表への書き込み（${d.store}）を省いた`, -1);
  return null;
}

type Row = Record<string, any>;

/**
 * つきつけの表（2・3）: 人物ごとに、番号 item（null = 見当違い）・種類 kind の反応。
 * 場所の状態（81）の列は、数のフラグ pstate_場所 と比べる。ARM9（A2GJ 0x020310d4 / YG3J 0x020341b4）は場所の項目を
 * 上から見て、人物・種類・状態が合う項目のうち、番号が合えば（0xff はどれでも）その区画、合わなければ既定の区画を
 * その項目の default に替えて次へ進む。最後まで合わなければ最後に替えた既定の区画（始めはパートの表の最初の項目の default）。
 * つまり「状態の合う、番号の合う最初の項目の区画」、無ければ「状態の合う、番号の合わない最後の項目の default」
 */
export function presentChain23(
  ctx: Context,
  place: number,
  rows: Row[],
  item: number | null,
  kind: 'evidence' | 'profile',
  block: (s: number) => Step[],
): Step[] {
  const state = ctx.flag(`${ctx.gpfx}pstate_${place}`, 0);
  const pf = ctx.personFlag();
  const first = (ctx.inv!.present.entries as Row[])[0]?.default.section as number | undefined;
  const fallback = (): Step[] => (first === undefined ? [] : block(first));
  const cond = (r: Row) => (r.state === null ? null : `${state} == ${r.state}`);
  /** 条件つきの行き先を上から試す（条件 null はいつも） */
  const pick = (list: { cond: string | null; steps: () => Step[] }[], rest: () => Step[]) => {
    let out = rest();
    for (const x of [...list].reverse())
      out =
        x.cond === null
          ? x.steps()
          : // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
            [{ if: x.cond, then: x.steps(), else: out }];
    return out;
  };
  const persons = [...new Set(rows.map((r) => r.person & 0x1fff))];
  let out: Step[] = fallback();
  for (const k of [...persons].reverse()) {
    const mine = rows.filter((r) => (r.person & 0x1fff) === k && r.record === kind);
    const hit = (r: Row) => r.item === null || r.item === item;
    const hits = mine
      .filter(hit)
      .map((r) => ({ cond: cond(r), steps: () => block(r.section.section) }));
    const misses = mine
      .filter((r) => !hit(r))
      .reverse()
      .map((r) => ({ cond: cond(r), steps: () => block(r.default.section) }));
    out = [
      {
        if: `${pf} == ${k}`,
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        then: pick(hits, () => pick(misses, fallback)),
        ...(out.length ? { else: out } : {}),
      },
    ];
  }
  return out;
}
