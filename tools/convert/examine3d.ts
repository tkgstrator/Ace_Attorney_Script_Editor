// 「3D で詳しく調べる」（DS 版の第 5 話）を、証拠品の examine（YAML の evidence.<ID>.examine）にする。
// 表は tools/rom/tbl_examine3d.py の examine3d.json:
//   証拠品 → 3D の物 → 調べられる面 → 結果の番号 → パート・フラグの条件ごとの区画（項目 070 か、今のパートの話の台本）
// 話の台本から 3D の画面を開く所（116 8 46 / 116 11）の決まった区画（開いたとき・閉じたとき）は story_modes。
import type { Context } from './context.ts';
import { flagArg } from './mapping.ts';
import { convertOps } from './section.ts';
import type { CmdOp, Entry, Step } from './types.ts';

export interface X3dSection {
  raw: number;
  script: '070' | 'story';
  section: number;
}
export interface X3dPath {
  parts: number[];
  when: Record<string, number>;
  set_flags: Record<string, number>;
  section: X3dSection | null;
  next_object: number | '+1' | null;
}
export interface X3dEvent {
  on: string;
  section?: { section: number };
  flag?: string;
  mode?: number;
}
export interface X3dMode {
  mode: number | 'e9e' | 'luminol_tutorial';
  opened_at?: { section: number };
  object?: number;
  events: X3dEvent[];
}
export interface LuminolView {
  index: number;
  bg: number;
  scrolled: boolean;
  spots: { x: number; y: number; w: number; h: number; flag: number; section: X3dSection | null }[];
}
export interface Examine3d {
  luminol?: LuminolView[];
  evidence: Record<string, number>;
  objects: { id: number; spots: { result: number }[] }[];
  results: { id: number; paths: X3dPath[] }[];
  story_modes: X3dMode[];
}

const cmd = (ops: Entry['body'][number]['ops']) => ops.filter((o): o is CmdOp => o.op !== 'text');
/** 区画で法廷記録に加える・入れ替える証拠品（23 / 25 の後ろ） */
export function givenIn(entry: Entry, section: number): number[] {
  const out: number[] = [];
  for (const o of cmd(entry.body[section]?.ops ?? [])) {
    if (o.op === 23 && !(o.args[0]! & 0x8000)) out.push(o.args[0]! & 0x3fff);
    if (o.op === 25) out.push(o.args[1]! & 0x3fff);
  }
  return out;
}
const hasOp = (entry: Entry, s: number, op: number, a0: number, a1?: number) =>
  cmd(entry.body[s]?.ops ?? []).some(
    (o) => o.op === op && o.args[0] === a0 && (a1 === undefined || o.args[1] === a1),
  );

/** 物と、そこから結果で続けて見せる物（携帯電話を開いた形など）。gate = その物を見せる結果 */
export function objectChain(x: Examine3d, obj: number): { object: number; gate: number | null }[] {
  const out = [{ object: obj, gate: null as number | null }];
  for (let i = 0; i < out.length; i++) {
    for (const s of x.objects[out[i]!.object]?.spots ?? []) {
      for (const p of x.results[s.result]?.paths ?? []) {
        const n = p.next_object === '+1' ? out[i]!.object + 1 : p.next_object;
        if (n !== null && !out.some((o) => o.object === n)) out.push({ object: n, gate: s.result });
      }
    }
  }
  return out;
}

/** 話の台本のモードの、開く区画（116 8 46 のある opened_at / 116 11 のある区画）と、その区画で加える証拠品 */
export function modeHome(
  x: Examine3d,
  m: X3dMode,
  ctx: Context,
): { section: number; evidence: number[] } | null {
  const e = ctx.entry;
  if (m.mode === 'luminol_tutorial') return null;
  if (m.opened_at) {
    const s = m.opened_at.section;
    return hasOp(e, s, 116, 8, 46) ? { section: s, evidence: givenIn(e, s) } : null;
  }
  for (const sec of e.body) {
    if (!hasOp(e, sec.section, 116, 11)) continue;
    const ev = givenIn(e, sec.section).filter((n) => x.evidence[String(n)] === m.object);
    if (ev.length) return { section: sec.section, evidence: ev };
  }
  return null;
}

/** この項目で証拠品を加えるか */
const gives = (ctx: Context, n: number) =>
  ctx.entry.body.some((s) => givenIn(ctx.entry, s.section).includes(n));

/**
 * この項目の話の台本の区画のうち、3D で調べた結果・モードの決まった区画になるもの（シーンにせず、証拠品の examine に取り込む）。
 * 結果の区画は「その証拠品を加える項目」で、パートが合うもの
 */
export function examineSections(ctx: Context): Set<number> {
  const x = ctx.t.examine3d;
  const out = new Set<number>();
  if (!x) return out;
  for (const [n, obj] of Object.entries(x.evidence)) {
    if (!gives(ctx, Number(n))) continue;
    for (const { object } of objectChain(x, obj)) {
      for (const s of x.objects[object]?.spots ?? []) {
        for (const p of x.results[s.result]?.paths ?? []) {
          if (
            p.section?.script === 'story' &&
            p.parts.includes(ctx.part) &&
            ctx.entry.body[p.section.section]
          )
            out.add(p.section.section);
        }
      }
    }
  }
  for (const m of x.story_modes) {
    if (!modeHome(x, m, ctx)) continue;
    for (const ev of m.events)
      if (ev.section && ctx.entry.body[ev.section.section]) out.add(ev.section.section);
  }
  return out;
}

/** 取り込む区画を、探偵メニューへ戻らない（調べ終えたら調べ始めた場面へ戻る）ステップ列にしておく */
export function prepareExamine(ctx: Context) {
  for (const s of examineSections(ctx)) ctx.consumed.add(s);
}
export function convertExamine(ctx: Context) {
  for (const s of examineSections(ctx)) {
    ctx.examineSteps.set(s, convertOps(ctx, s, ctx.entry.body[s]!.ops, { menuReturn: [] }));
  }
}

/** 区画がフラグ（組 0, 番号）を立てるか */
export function setsFlag(entry: Entry, s: number, flag: string): boolean {
  const [g, i] = flag.split(':').map(Number);
  return cmd(entry.body[s]?.ops ?? []).some((o) => {
    if (o.op !== 16) return false;
    const f = flagArg(o.args[0]!);
    return f.value && f.group === g && f.index === i;
  });
}

/** 法廷で、話の台本から 3D の画面を開いて待つ区画（116 8 46 / 116 11 の後の 21）か */
export function examineWaitAt(ctx: Context, section: number): boolean {
  const x = ctx.t.examine3d;
  if (!x || ctx.inv) return false;
  return x.story_modes.some((m) => modeHome(x, m, ctx)?.section === section);
}

/** 3D で調べ終えるまで待つ: つきつけの要求（正解なし）にして、法廷記録から詳しく調べてもらう */
export const EXAMINE_WAIT: Step = {
  demand: '（法廷記録の証拠品を、詳しく調べてみよう）',
  present: {},
  wrong: [],
};

/**
 * ルミノールの説明（第 5 話 044 §18〜）: 116 6 0 の後の 21 は、ARM9 が決める説明の区画（0x02080cd8、§19）へ。
 * 116 6 1 の後の 21 は、吹きかけて反応を見つけたことにして、反応の区画（この項目にあるルミノールの反応の区画、§20）へ。
 * その先で 21 に来たら、ARM9 が決める区画（0x02082774、§22）へ移る（近似: 吹きかける操作は省く）
 */
export function luminolTutorial(
  ctx: Context,
  section: number,
  gotoSteps: (t: number) => Step[],
): Step[] | null {
  const x = ctx.t.examine3d;
  const ev = (on: string) =>
    x?.story_modes.find((m) => m.mode === 'luminol_tutorial')?.events.find((e) => e.on === on)
      ?.section?.section;
  const open = ev('open'),
    found = ev('found');
  if (!x || open === undefined || found === undefined) return null;
  if (hasOp(ctx.entry, section, 116, 6, 0)) {
    ctx.stats.gap(
      'ルミノールの説明の画面（116 6 0）を開いたことにして、説明の区画へ進めた',
      section,
    );
    return gotoSteps(open);
  }
  if (!hasOp(ctx.entry, section, 116, 6, 1)) return null;
  const spot = (x.luminol ?? [])
    .flatMap((v) => v.spots)
    .find(
      (sp) => sp.section && ctx.entry.body[sp.section.section]?.ops.some((o) => o.op === 'text'),
    );
  if (!spot?.section) return null;
  // 反応の区画から落ちていった先の、21 のある区画
  let s = spot.section.section;
  for (
    let k = 0;
    k < 8 && ctx.entry.body[s] && !cmd(ctx.entry.body[s]!.ops).some((o) => o.op === 21);
    k++
  )
    s++;
  if (ctx.entry.body[s]) ctx.turnGoto.set(s, found);
  ctx.stats.gap('ルミノールの説明（116 6 1）で、吹きかける操作を省いて反応の区画へ進めた', section);
  return [{ set: { [ctx.fname(0, spot.flag)]: true } }, ...gotoSteps(spot.section.section)];
}
