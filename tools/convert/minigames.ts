// DS 版の第 5 話だけの遊び（指紋の検出・防犯カメラの映像・ツボの組み立て）を、絵の上の範囲を選ぶ（pick）ステップにする。
// 表は tools/rom/tbl_minigames.py が ARM9 から取り出す（tables/minigames.json）。流れと番地はそちらの説明を参照。
// 遊びの途中で台本の区画を走らせて遊びに戻るところは、区画の 21 player_turn の代わりに遊びのシーンへ移る（ctx.turnSteps）。
import type { Context } from './context.ts';
import { staticTargets } from './flow.ts';
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
    persons: { slot: number; person: number; icon: number; rect: Area }[];
    flags: { tutorial: number; glove: number };
  };
  video: {
    variants: { section: Sec; variant: number }[];
    records: { frames: [number, number]; sections: Sec[] }[];
    miss: Sec[];
    keyframes: { frame: number; key: string; areas: { record: number; area: Area }[] }[];
  };
  vase: {
    flag: number;
    quit: { unset: Sec; set: Sec };
    complete: { unset: Sec; set: Sec };
    bg: { unset: number; set: number };
    area: Area;
  };
}

type Goto = (t: number) => Step[];

/** 116 9 v（指紋）・116 8 53（映像）・116 8 50（ツボ）なら pick のステップを out に足して true */
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
  if (kind === 8 && arg === 53) return video(ctx, mg, section, gotoSteps, out);
  if (kind === 8 && arg === 50) return vase(ctx, mg, section, gotoSteps, out);
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

/** 指紋の遊びのシーン ID（fp版・fp版_dust・fp版_match） */
const fpId = (ctx: Context, variant: number, s = '') => `${ctx.pfx}fp${variant}${s}`;

/** 指紋の遊びにできる版か（版 0 だけ。版 1・2 は項目 070 の区画を使うので、まだ選択肢の近似） */
function fpVariant(mg: Minigames, variant: number) {
  const fp = mg.fingerprint;
  const v = fp.variants[variant];
  const ok = (k: number) => fp.events.find((e) => e.event === k)?.script === 'story';
  return v && variant === 0 && [0, 1, 2, 3, 4, 6].every(ok) ? v : null;
}

/**
 * 区画を変換する前に: 遊びの途中で走らせる区画の 21 を、遊びに戻るステップにする（選び直す・照合に戻る）。
 * scenario.ts が項目ごとに呼ぶ
 */
export function prepareMinigames(ctx: Context): void {
  const mg = ctx.t.minigames;
  if (!mg || ctx.t.game !== 'aa1') return;
  for (const sec of ctx.entry.body) {
    for (const o of sec.ops) {
      if (o.op !== 116 || o.args[0] !== 9 || !fpVariant(mg, o.args[1] ?? 0)) continue;
      const v = o.args[1] ?? 0;
      const ev = (k: number) => mg.fingerprint.events.find((e) => e.event === k)!.section;
      const back = (k: number, s: string) =>
        ctx.turnSteps.set(turnSection(ctx, ev(k)), [{ goto: fpId(ctx, v, s) }]);
      back(0, '');
      back(1, '_dust');
      back(2, '');
      back(3, '');
      back(6, '_match');
      back(4, '_match');
    }
  }
}

/** 指紋の検出（探偵パート） */
function fingerprint(
  ctx: Context,
  mg: Minigames,
  section: number,
  variant: number,
  out: Step[],
): boolean {
  const fp = mg.fingerprint;
  const v = fpVariant(mg, variant);
  const ev = (k: number) => fp.events.find((e) => e.event === k)!;
  const answer = v && answerCharacter(ctx, fp, v.answer_person);
  if (!v || !answer) return false;
  const id = (s: string) => fpId(ctx, variant, s);
  const tutorial = ctx.fname(0, fp.flags.tutorial);
  const glove = ctx.fname(0, fp.flags.glove);
  const spot = ctx.flag(`${ctx.gpfx}fp${variant}_spot`, -1);
  const real = v.spots.find((s) => s.real)!.index;
  // 結果の区画は、何か所からも行くのでシーンにする（取り込まない）
  const go: Goto = (t) => ctx.jump(t, section, 'scene');
  ctx.stats.gap(
    '指紋の検出（116 9 0）を、指紋の絵の上の範囲を選ぶ形にした（粉をかけて吹きとばす操作は「検出する」の選択肢、人物の照合は人物ファイルのつきつけにした）',
    section,
  );
  // 選ぶ画面: 手袋の跡（+0x2a ≠ 1）の指は、手袋の跡と分かるまで。分かったら本物の指紋の所だけ
  ctx.extraScenes.set(id(''), [
    {
      pick: '指紋を検出する所を選ぶ',
      images: [`bg${v.bg}`],
      areas: v.spots.map((s) => ({
        name: s.real ? '指紋' : `指 ${s.index + 1}`,
        area: [...s.area] as Area,
        when: s.real ? glove : `not ${glove}`,
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        then: [
          { set: { [spot]: s.index } },
          // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
          { if: `not ${tutorial}`, then: [{ set: { [tutorial]: true } }, ...go(ev(1).section)] },
          { goto: id('_dust') },
        ],
      })),
    },
  ]);
  // 粉をかけて吹きとばす画面（A 検出・B もどる）
  ctx.extraScenes.set(id('_dust'), [
    {
      choice: [
        {
          text: '検出する',
          // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
          then: [
            {
              if: `${spot} == ${real}`,
              // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
              then: go(ev(6).section),
              else: [{ set: { [glove]: true } }, ...go(ev(2).section)],
            },
          ],
        },
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        { text: 'もどる', then: go(ev(3).section) },
      ],
    },
  ]);
  // 照合: 人物を選ぶ画面の代わりに、人物ファイルをつきつける
  ctx.extraScenes.set(id('_match'), [
    {
      demand: '指紋のヌシだと思われる人物は?',
      profiles: true,
      present: { [answer]: go(v.success.section) },
      wrong: go(ev(4).section),
    },
  ]);
  out.push(...go(ev(0).section));
  return true;
}

/** 人物の番号 → 人物 ID（その人物の顔の絵を使う法廷記録の人物ファイル） */
function answerCharacter(
  ctx: Context,
  fp: Minigames['fingerprint'],
  person: number,
): string | null {
  const icon = fp.persons.find((p) => p.person === person)?.icon;
  const recs = ctx.t.evidence.filter((e) => e.icon === icon).map((e) => e.id);
  const rec = recs.find((r) => ctx.shared.profileRecords.has(r)) ?? recs[0];
  return rec === undefined ? null : ctx.profile(rec);
}
