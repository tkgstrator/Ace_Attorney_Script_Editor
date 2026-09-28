// DS 版の第 5 話だけの遊び（指紋の検出・防犯カメラの映像・ツボの組み立て）を、絵の上の範囲を選ぶ（pick）ステップに、
// 人物の指名（116 10 n）を人物を選ぶ（nominate）ステップにする。指紋と人物を選ぶ画面は minigames-fp.ts。
// 表は tools/rom/tbl_minigames.py が ARM9 から取り出す（tables/minigames.json）。流れと番地はそちらの説明を参照。
// 遊びの途中で台本の区画を走らせて遊びに戻るところは、区画の 21 player_turn の代わりに遊びのシーンへ移る（ctx.turnSteps）。
import type { Context } from './context.ts';
import { staticTargets } from './flow.ts';
import { fingerprint, nominateStep, prepareFingerprint } from './minigames-fp.ts';
import type { Step } from './types.ts';

type Area = [number, number, number, number];
/** 区画（raw - 0x80）と、どの台本か（story = 今のパートの台本、070 = 項目 070） */
interface Sec {
  raw: number;
  section: number;
  script: 'story' | '070';
}

export interface Minigames {
  fingerprint: {
    /** 出来事の番号 → 区画（0x0207c0fc） */
    events: (Sec & { event: number })[];
    variants: {
      variant: number;
      bg: number;
      /** 正解の人物の番号（人物を選ぶ画面の枠の人物 persons[].person） */
      answer_person: number;
      /** real: 本物の指紋の所（+0x2a = 1） */
      spots: { index: number; area: Area; real: boolean }[];
      success: Sec;
      can_quit: boolean;
    }[];
    /** 版ごとの出来事の番号（B でもどる・本物でない指紋・照合の外れ。null = 出来事なし） */
    flow: Record<'back' | 'fake' | 'wrong', (number | null)[]>;
    persons: { slot: number; person: number; icon: number; rect: Area }[];
    flags: { tutorial: number; glove: number };
  };
  /** 人物の指名（116 10 n）の結果の表（0x020b1558） */
  nominations?: { n: number; answer_person: number; answer: Sec; wrong: Sec }[];
  video: {
    variants: { section: Sec; variant: number }[];
    records: { frames: [number, number]; sections: Sec[] }[];
    miss: Sec[];
    keyframes: { frame: number; key: string; areas: { record: number; area: Area }[] }[];
  };
  /** 金庫の暗証番号（116 8 52）。buttons の index が答え（answer）の番号、delete は 1 字消すボタン */
  safe?: {
    buttons: { index: number; label: string; area: Area }[];
    answer: number[];
    delete: number;
    correct: Sec;
    wrong: Sec;
  };
  /** 選択肢で近似する遊び（116 8 の値ごと。after_ui12 = 116 12 の後だけ。section が null なら物を調べた結果の区画） */
  choices?: {
    ui: number;
    about: string;
    after_ui12?: boolean;
    examine_object?: number;
    options: { text: string; section: Sec | null }[];
  }[];
  vase: {
    flag: number;
    quit: { unset: Sec; set: Sec };
    complete: { unset: Sec; set: Sec };
    bg: { unset: number; set: number };
    area: Area;
  };
}

type Goto = (t: number) => Step[];

/** 116 9 v（指紋）・116 10 n（人物の指名）・116 8 53（映像）・116 8 50（ツボ）ならステップを out に足して true */
export function minigamePick(
  ctx: Context,
  section: number,
  kind: number,
  arg: number,
  gotoSteps: Goto,
  out: Step[],
): boolean {
  const mg = ctx.t.minigames;
  if (!mg || ctx.t.game !== 'aa1') return false;
  if (kind === 9) return fingerprint(ctx, mg, section, arg, out);
  if (kind === 10) return nominate(ctx, mg, section, arg, gotoSteps, out);
  if (kind === 8 && arg === 53) return video(ctx, mg, section, gotoSteps, out);
  if (kind === 8 && arg === 50) return vase(ctx, mg, section, gotoSteps, out);
  if (kind === 8 && arg === 52) return safe(ctx, mg, section, out);
  if (kind === 8) return choice(ctx, mg, section, arg, gotoSteps, out);
  return false;
}

/**
 * 区画から、落ちていく（行き先が 1 つだけの）区画をたどって、21 で遊びに戻る区画（照合に外れた §193 → §192 など）。
 * 見つからなければ最初の区画
 */
function turnSection(ctx: Context, s: number): number {
  for (let at = s, k = 0; k < 8 && ctx.entry.body[at]; k++) {
    if (ctx.entry.body[at]!.ops.some((o) => o.op === 21)) return at;
    const t = staticTargets(ctx.entry, at);
    if (t.length !== 1) break;
    at = t[0]!;
  }
  return s;
}

/** 人物の指名（探偵パート・法廷）。人物を選ぶ画面で正解の人物なら正解の区画、ほかは外れの区画 */
function nominate(
  ctx: Context,
  mg: Minigames,
  section: number,
  n: number,
  go: Goto,
  out: Step[],
): boolean {
  const row = mg.nominations?.find((r) => r.n === n);
  if (!row || !ctx.entry.body[row.answer.section] || !ctx.entry.body[row.wrong.section])
    return false;
  const step = nominateStep(
    ctx,
    mg.fingerprint,
    row.answer_person,
    go(row.answer.section),
    go(row.wrong.section),
  );
  if (!step) return false;
  ctx.stats.gap(`人物の指名（116 10 ${n}）を、人物を選ぶ形にした`, section);
  out.push(step);
  return true;
}

/**
 * 防犯カメラの映像（法廷）。版は今の区画で決まる。場面の絵（動画の決まったコマ）を送る・戻すことで、再生・早送り・
 * 一時停止の代わりにする。当たりは場面ごとの当たりの絵の範囲（点の範囲を四角にした近似）、外れは版の外れの区画
 */
function video(ctx: Context, mg: Minigames, section: number, go: Goto, out: Step[]): boolean {
  const v = mg.video.variants.find((x) => x.section.section === section)?.variant;
  if (v === undefined) return false;
  const frames = mg.video.keyframes;
  ctx.stats.gap(
    '防犯カメラの映像（116 8 53）を、決まった場面の絵の上の範囲を選ぶ形にした（再生の操作は場面を送る・戻すことにした）',
    section,
  );
  out.push({
    pick: '映像の1点を指し示す',
    images: frames.map((f) => f.key),
    areas: frames.flatMap((f, i) =>
      f.areas.map((a) => ({
        area: [...a.area] as Area,
        image: i,
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        then: go(mg.video.records[a.record]!.sections[v]!.section),
      })),
    ),
    miss: go(mg.video.miss[v]!.section),
  });
  return true;
}

/**
 * ツボの組み立て（探偵パート）。3D のカケラを回して合わせる操作は省き、組み立てる窓の範囲を選ぶと組み立て終えた結果にする。
 * フラグ（一度組み立てたか）で区画と絵が替わる。行き先の区画が今の台本に無い版は出さない（元のゲームでもそこには来ない）
 */
function vase(ctx: Context, mg: Minigames, section: number, go: Goto, out: Step[]): boolean {
  const x = mg.vase;
  const flag = ctx.fname(0, x.flag);
  const has = (s: Sec) => !!ctx.entry.body[s.section];
  const pick = (set: boolean): Step => ({
    pick: 'カケラを組み立てる',
    images: [`bg${set ? x.bg.set : x.bg.unset}`],
    areas: [
      {
        area: [...x.area] as Area,
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        then: set
          ? go(x.complete.set.section)
          : [{ set: { [flag]: true } }, ...go(x.complete.unset.section)],
      },
    ],
    quit: go((set ? x.quit.set : x.quit.unset).section),
  });
  const set = has(x.complete.set) && has(x.quit.set);
  const unset = has(x.complete.unset) && has(x.quit.unset);
  if (!set && !unset) return false;
  ctx.stats.gap(
    'ツボの組み立て（116 8 50）を、組み立てる窓の範囲を選ぶ形にした（カケラを回して合わせる操作は省いた）',
    section,
  );
  // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
  out.push(set && unset ? { if: flag, then: [pick(true)], else: [pick(false)] } : pick(set));
  return true;
}

/**
 * 元のとおりには作れない遊び（3D のツボを回す・点をつなぐ・最後の場面の 3D の物）を、ARM9 が決める結果の区画の選択肢にする。
 * 物を調べる選択肢の区画は、物の面の結果（examine3d.json）の今のパートの区画
 */
function choice(
  ctx: Context,
  mg: Minigames,
  section: number,
  ui: number,
  go: Goto,
  out: Step[],
): boolean {
  const ops = ctx.entry.body[section]?.ops ?? [];
  const ui12 = ops.some((o) => o.op === 116 && o.args[0] === 12);
  const c = mg.choices?.find((x) => x.ui === ui && !!x.after_ui12 === ui12);
  if (!c) return false;
  const x3d = ctx.t.examine3d;
  const examined = (obj: number | undefined) => {
    const r = x3d?.objects[obj ?? -1]?.spots[0]?.result;
    const p = x3d?.results[r ?? -1]?.paths.find((q) => q.parts.includes(ctx.part));
    return p?.section?.script === 'story' ? p.section.section : null;
  };
  const opts = c.options.map((o) => ({
    text: o.text,
    s: o.section ? o.section.section : examined(c.examine_object),
  }));
  if (opts.some((o) => o.s === null || !ctx.entry.body[o.s])) return false;
  ctx.stats.gap(`${c.about}（116 8 ${ui}）を、ARM9 が決める結果の選択肢にした`, section);
  // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
  out.push({ choice: opts.map((o) => ({ text: o.text, then: go(o.s!) })) });
  return true;
}

/**
 * 金庫の暗証番号（探偵パート）。今の背景（ボタンの絵）の上で、1 字ずつボタンを選ぶシーン（safe字数）にする。
 * 最初に違えた字の位置（1 から。0 = 違えていない）だけをフラグに覚える（もどるでその字を消したら 0 に戻す）。
 * 字数に達したら 60 フレーム後に、違えていなければ合う区画、違えていれば違う区画へ
 */
function safe(ctx: Context, mg: Minigames, section: number, out: Step[]): boolean {
  const x = mg.safe;
  if (!x || !ctx.entry.body[x.correct.section] || !ctx.entry.body[x.wrong.section]) return false;
  const n = x.answer.length;
  const miss = ctx.flag(`${ctx.gpfx}safe_miss`, 0);
  const id = (k: number) => `${ctx.pfx}safe${k}`;
  const go = (t: number) => ctx.jump(t, section, 'scene');
  ctx.stats.gap(
    '金庫の暗証番号（116 8 52）を、ボタンの絵の上の範囲を 1 字ずつ選ぶ形にした',
    section,
  );
  const judge: Step[] = [
    { wait: 60 },
    {
      if: `${miss} == 0`,
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      then: go(x.correct.section),
      else: [{ set: { [miss]: 0 } }, ...go(x.wrong.section)],
    },
  ];
  for (let k = 0; k < n; k++) {
    const next = k + 1 < n ? [{ goto: id(k + 1) }] : judge;
    const areas = x.buttons.flatMap((b) => {
      if (b.index === x.delete) {
        // 1 字もなければ何もしない（ボタンを出さない）
        if (k === 0) return [];
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        const clear = { if: `${miss} == ${k}`, then: [{ set: { [miss]: 0 } }] };
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        return [{ name: b.label, area: [...b.area] as Area, then: [clear, { goto: id(k - 1) }] }];
      }
      const wrong =
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        b.index === x.answer[k] ? [] : [{ if: `${miss} == 0`, then: [{ set: { [miss]: k + 1 } }] }];
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      return [{ name: b.label, area: [...b.area] as Area, then: [...wrong, ...next] }];
    });
    ctx.extraScenes.set(id(k), [
      { pick: `暗証番号を入力する　${'●'.repeat(k)}${'○'.repeat(n - k)}`, areas },
    ]);
  }
  out.push({ set: { [miss]: 0 } }, { goto: id(0) });
  return true;
}

/**
 * 区画を変換する前に: 遊びの途中で走らせる区画の 21 を、遊びに戻るステップにする（選び直す・照合に戻る）。
 * scenario.ts が項目ごとに呼ぶ
 */
export function prepareMinigames(ctx: Context): void {
  const mg = ctx.t.minigames;
  if (!mg || ctx.t.game !== 'aa1') return;
  prepareFingerprint(ctx, mg, turnSection);
}
