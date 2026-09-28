// DS 版の第 5 話の指紋の検出（116 9 v）と、人物を選ぶ画面（指紋の照合・人物の指名 116 10 n）のステップ。minigames.ts から使う。
// 流れと番地は tools/rom/tbl_minigames.py の先頭の説明を参照。
// 指紋の遊びは、選ぶ（fp版）・粉をかけて吹きとばす（fp版_dust）・照合（fp版_match）のシーンにする。遊びの途中で走らせる
// 区画の 21 は、遊びのシーンへ戻る（ctx.turnSteps）。項目 070 の区画（版 1・2 の「もどる」・本物でない指紋）は、
// 章を作るときに add070Scenes がシーンにする（chapter.ts）。
import { Context } from './context.ts';
import type { Minigames } from './minigames.ts';
import { convertOps } from './section.ts';
import type { Entry, Step, Tables } from './types.ts';

type Area = [number, number, number, number];
type Goto = (t: number) => Step[];
type Fp = Minigames['fingerprint'];

/** 指紋の遊びのシーン ID（fp版・fp版_dust・fp版_match・fp版_ev出来事） */
export const fpId = (ctx: Context, variant: number, s = '') => `${ctx.pfx}fp${variant}${s}`;

/** 項目 070 の区画から作るシーン（ID → [区画, 21 の代わりのステップ]）。項目ごと */
const requests070 = new WeakMap<Context, Map<string, [number, Step[]]>>();

/** 出来事の区画（なければ null） */
const eventOf = (fp: Fp, k: number | null) =>
  k === null ? null : (fp.events.find((e) => e.event === k) ?? null);

/** 版の遊びで使う出来事（版 0 は説明・検出の説明・本物の指紋を検出した後も）。ARM9 の番号は fp.flow */
function eventsOf(fp: Fp, variant: number): { k: number; back: string }[] {
  const f = (key: 'back' | 'fake' | 'wrong') => fp.flow[key][variant] ?? null;
  const out = [
    { k: f('back'), back: '' },
    { k: f('fake'), back: '' },
    { k: f('wrong'), back: '_match' },
  ];
  if (variant === 0)
    out.push({ k: 0, back: '' }, { k: 1, back: '_dust' }, { k: 6, back: '_match' });
  return out.flatMap((x) => (x.k === null ? [] : [{ k: x.k, back: x.back }]));
}

/** 指紋の遊びにできる版か（今の台本・項目 070 に出来事の区画がある） */
function fpVariant(ctx: Context, fp: Fp, variant: number) {
  const v = fp.variants[variant];
  if (!v || !fp.flow) return null;
  const ok = eventsOf(fp, variant).every(({ k }) => {
    const e = eventOf(fp, k);
    return !!e && (e.script === '070' || !!ctx.entry.body[e.section]);
  });
  return ok && ctx.entry.body[v.success.section] ? v : null;
}

/** 区画から、落ちていく（行き先が 1 つだけの）区画をたどって、21 で遊びに戻る区画。minigames.ts */
type TurnSection = (ctx: Context, s: number) => number;

/**
 * 区画を変換する前に: 遊びの途中で走らせる区画の 21 を、遊びに戻るステップにする（選び直す・照合に戻る）
 */
export function prepareFingerprint(ctx: Context, mg: Minigames, turnSection: TurnSection): void {
  const fp = mg.fingerprint;
  for (const sec of ctx.entry.body) {
    for (const o of sec.ops) {
      if (o.op !== 116 || o.args[0] !== 9) continue;
      const v = o.args[1] ?? 0;
      if (!fpVariant(ctx, fp, v)) continue;
      for (const { k, back } of eventsOf(fp, v)) {
        const e = eventOf(fp, k)!;
        const to: Step[] = [{ goto: fpId(ctx, v, back) }];
        if (e.script === 'story') ctx.turnSteps.set(turnSection(ctx, e.section), to);
        else {
          const reqs = requests070.get(ctx) ?? new Map<string, [number, Step[]]>();
          reqs.set(fpId(ctx, v, `_ev${k}`), [e.section, to]);
          requests070.set(ctx, reqs);
        }
      }
    }
  }
}

/** 章を作るとき: 項目 070 の区画を、21 で指紋の遊びに戻るシーンにして、編のシーンに加える */
export function add070Scenes(
  t: Tables,
  results: { ctx: Context; part: Record<string, unknown> }[],
  item070: Entry | null,
): void {
  for (const { ctx, part } of results) {
    const reqs = requests070.get(ctx);
    if (!reqs?.size) continue;
    const scenes = part.scenes as Record<string, Step[]>;
    const c = item070
      ? new Context(t, item070, { shared: ctx.shared, pfx: `${ctx.pfx}x070_` })
      : null;
    for (const [id, [s, back]] of reqs) {
      const ops = c?.entry.body[s]?.ops;
      scenes[id] = ops
        ? convertOps(c!, s, ops, { menuReturn: back, gotoSteps: () => back })
        : [{ native: 'item070', args: [s] }, ...back];
    }
    if (c) ctx.stats.merge(c.stats);
  }
}

/** 人物を選ぶ画面の枠の人物（左上から 8 人）の人物 ID。人物ファイルの顔の絵（アイコン）で法廷記録の人物を探す */
export function peopleOf(ctx: Context, fp: Fp): { ids: string[]; person: number[] } | null {
  const slots = [...fp.persons].sort((a, b) => a.slot - b.slot);
  const ids: string[] = [];
  for (const p of slots) {
    const recs = ctx.t.evidence.filter((e) => e.icon === p.icon).map((e) => e.id);
    const rec = recs.find((r) => ctx.shared.profileRecords.has(r)) ?? recs[0];
    if (rec === undefined) return null;
    ids.push(ctx.profile(rec));
  }
  return { ids, person: slots.map((p) => p.person) };
}

/** 人物を選ぶステップ（正解の人物の番号 → then、ほかの人物 → wrong）。人物が分からなければ null */
export function nominateStep(
  ctx: Context,
  fp: Fp,
  answerPerson: number,
  then: Step[],
  wrong: Step[] | null,
): Step | null {
  const people = peopleOf(ctx, fp);
  const at = people?.person.indexOf(answerPerson) ?? -1;
  if (!people || at < 0) return null;
  return {
    nominate: '',
    people: people.ids,
    present: { [people.ids[at]!]: then },
    ...(wrong ? { wrong } : {}),
  };
}

/** 指紋の検出（探偵パート）。作れたら true */
export function fingerprint(
  ctx: Context,
  mg: Minigames,
  section: number,
  variant: number,
  out: Step[],
): boolean {
  const fp = mg.fingerprint;
  const v = fpVariant(ctx, fp, variant);
  if (!v) return false;
  const id = (s: string) => fpId(ctx, variant, s);
  // 結果の区画は、何か所からも行くのでシーンにする（取り込まない）。項目 070 の区画は add070Scenes のシーン
  const go: Goto = (t) => ctx.jump(t, section, 'scene');
  const ev = (key: 'back' | 'fake' | 'wrong' | number): Step[] => {
    const k = typeof key === 'number' ? key : (fp.flow[key][variant] ?? null);
    const e = eventOf(fp, k);
    if (!e) return [];
    return e.script === 'story' ? go(e.section) : [{ goto: id(`_ev${k}`) }];
  };
  const wrongK = fp.flow.wrong[variant] ?? null;
  const match = nominateStep(
    ctx,
    fp,
    v.answer_person,
    go(v.success.section),
    wrongK === null ? null : ev('wrong'),
  );
  if (!match) return false;
  const tutorial = ctx.fname(0, fp.flags.tutorial);
  const glove = ctx.fname(0, fp.flags.glove);
  const spot = ctx.flag(`${ctx.gpfx}fp${variant}_spot`, -1);
  const real = v.spots.find((s) => s.real)!.index;
  const first = variant === 0;
  ctx.stats.gap(
    `指紋の検出（116 9 ${variant}）を、指紋の絵の上の範囲を選ぶ形にした（粉をかけて吹きとばす操作は「検出する」の選択肢にした）`,
    section,
  );
  // 選ぶ画面: 版 0 は、手袋の跡（+0x2a ≠ 1）の指は手袋の跡と分かるまで、分かったら本物の指紋の所だけ。
  // 版 0 は初めて選んだときに検出の説明（出来事 1）。版 1・2 はやめられる（区画を走らせずに探偵パートへ。版 1 は法廷記録も戻す）
  ctx.extraScenes.set(id(''), [
    {
      pick: '指紋を検出する所を選ぶ',
      images: [`bg${v.bg}`],
      areas: v.spots.map((s) => ({
        name: first ? (s.real ? '指紋' : `指 ${s.index + 1}`) : `所 ${s.index + 1}`,
        area: [...s.area] as Area,
        ...(first ? { when: s.real ? glove : `not ${glove}` } : {}),
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        then: [
          { set: { [spot]: s.index } },
          ...(first
            ? // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
              [{ if: `not ${tutorial}`, then: [{ set: { [tutorial]: true } }, ...ev(1)] }]
            : []),
          { goto: id('_dust') },
        ],
      })),
      ...(v.can_quit
        ? { quit: [...(variant === 1 ? [{ ui: { record: true } }] : []), ...ctx.menuReturn()] }
        : {}),
    },
  ]);
  // 粉をかけて吹きとばす画面（A 検出・B もどる）。本物の指紋なら、版 0 は出来事 6 の後、版 1・2 はそのまま照合へ
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
              then: first ? ev(6) : [{ goto: id('_match') }],
              else: [...(first ? [{ set: { [glove]: true } }] : []), ...ev('fake')],
            },
          ],
        },
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        { text: 'もどる', then: ev('back') },
      ],
    },
  ]);
  // 照合: 人物を選ぶ画面（外れは版 0 が出来事 4、版 2 が出来事 7、版 1 は何もなく選び直す）
  ctx.extraScenes.set(id('_match'), [match]);
  out.push(...(first ? ev(0) : [{ goto: id('') }]));
  return true;
}
