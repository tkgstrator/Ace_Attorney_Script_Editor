// 探偵パート（investigation.json の parts）を、YAML の探索編の場所（places）にする。
//
// 元のゲームの探偵パートは「今いる場所」「今出ている人物（30 char の最後）」「フラグ」で決まる:
//   - 着いたとき（移動）: 背景 = 場所の bg、人物を消し、on_enter の道（フラグの組）のうち合うものを行う
//     （調べる表の切り替え・人物を出す・音楽・一度きりの会話 event）
//   - 話す: (場所, 人物) の項目のうち有効（55 で切り替え）なものの話題 / つきつける: (場所, 証拠品, 人物) の区画、無ければ既定
//   - 調べる: 着いたときに選んだ表の四角形 / 移動する: 場所の行き先（51 で書き換え）
//   - 区画の終わりの 28 3 → 21 で探偵メニューに戻る
// YAML では、人物・場所・行き先の版・話題の有効をフラグ（person / place / mv_場所 / talk_項目）で持ち、条件（when）にする。
// 区画の中から探偵メニューに戻るときは menu_return を立てて menu シーンへ行き、今の場所へ investigate する
// （場所の enter は menu_return が立っていれば着いたときの処理を飛ばす）。
import type { Context } from './context.ts';
import { areaOf, bgSize } from './examine-area.ts';
import {
  condOf23,
  examineBlockers,
  examineDefault23,
  type FrameRow,
  frameRowStep,
  frameTabs,
  presentChain23,
  storeStep,
  talkAdds23,
} from './invest23.ts';
import {
  ctxOf,
  EXAMINE_READY,
  prepareInvestigation,
  scriptEntryOf,
  startPlace,
  startsWithEvent,
} from './investigation-setup.ts';
import { and, commonBlock, condOf, or, stripMenuReturn, whenOf } from './investigation-util.ts';
import { bgKey } from './mapping.ts';
import { lockIconFlag } from './ops23.ts';
import type { Entry, Step } from './types.ts';

export { areaOf, bgSize } from './examine-area.ts';
export {
  ctxOf,
  dayStartFlags,
  initInvestigationFlags,
  investigationStartFlags,
  nextDayPlace,
  prepareInvestigation,
  scriptEntryOf,
} from './investigation-setup.ts';
export { commonBlock, condOf, stripMenuReturn, whenOf } from './investigation-util.ts';

const EXAMINE_NOT_YET = 13;
/** 共通の台本の「手がかりになるものはない。」 */
const COMMON_NOTHING = 43;

type Sec = { raw: number; script: string; section: number };
type Row = Record<string, any>;

export function buildPlaces(
  ctx: Context,
  common: Entry | null,
): { places: Record<string, unknown>; menu: Step[]; startAtMenu: boolean } {
  const inv = ctx.inv!;
  const st = ctx.stats;
  const pf = ctx.personFlag();
  /** 区画をブロックにする（その場所の台本の項目で） */
  let pc = ctx;
  const block = (s: number, from = -1) => stripMenuReturn(pc, pc.jump(s, from, 'choice'));
  /** 表の区画（script が common なら共通の台本の区画。例: 調べる表の「手がかりになるものはない。」= 共通の §43） */
  const sectionBlock = (sec: Sec) =>
    sec.script === 'common' ? commonBlock(ctx, common, sec.section) : block(sec.section);
  const places: Record<string, unknown> = {};
  const aa1 = ctx.t.game === 'aa1';
  const lockIcons = new Set<number>(
    (inv.init?.op89_sections ?? []).map((s: { section: number }) => s.section),
  );
  const lateExamine = aa1 && inv.part < 17;
  if (inv.places.some((p: { every_frame: unknown[] }) => p.every_frame.length))
    st.gap('探偵パートの毎フレームの処理（every_frame）', -1);

  for (const pl of inv.places) {
    const P: number = pl.id;
    pc = ctxOf(ctx, pl);
    const pid = ctx.placeId(P);
    // 着いたとき
    const chain = (k: number): Step[] => {
      const path = pl.on_enter[k];
      if (!path) return [];
      const doSteps: Step[] = [];
      for (const d of path.do) {
        if (d.event) {
          const [g, n] = String(d.set_flag).split(':');
          doSteps.push(
            { set: { [ctx.fname(Number(g), Number(n))]: true } },
            ...block((d.event as Sec).section),
          );
        }
        if (d.set_flag && !d.event) {
          const [g, n] = String(d.set_flag).split(':');
          doSteps.push({
            set: { [ctx.fname(Number(g), Number(n))]: d.value === undefined ? true : !!d.value },
          });
        }
        if (d.char !== undefined) {
          const k = d.char & 0x1fff;
          doSteps.push(
            {
              show: ctx.character(k),
              ...(d.talk !== null && d.talk !== undefined ? { talk: d.talk } : {}),
              ...(d.idle !== d.talk && d.idle !== null && d.talk != null ? { idle: d.idle } : {}),
            },
            { set: { [pf]: k } },
          );
          if (d.char & 0xe000) st.gap('人物の位置・反転（30 char の 0x8000/0x4000/0x2000）', -1);
        }
        if (d.bgm !== undefined) doSteps.push({ bgm: ctx.sound(d.bgm) });
        if (d.store !== undefined) {
          const s = storeStep(ctx, d as { store: string; value: number });
          if (s) doSteps.push(s);
        }
        if (d.gauge_full) doSteps.push({ heal: true });
        if (d.call !== undefined || d.op_2232c !== undefined)
          st.gap('着いたときの処理の中の、下画面などの関数呼び出し', -1);
      }
      const rest = chain(k + 1);
      const cond = whenOf(ctx, path.when);
      if (cond === 'false') return rest;
      if (cond === 'true') return doSteps;
      return [
        {
          if: cond,
          // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
          then: doSteps.length ? doSteps : [{ set: { [pf]: 0 } }],
          ...(rest.length ? { else: rest } : {}),
        },
      ];
    };
    // 毎フレームの処理（every_frame）: 条件を満たすとフラグを立てる・調べる表を替える・場所を移す（invest23.ts）。
    // 各行動の終わりと着いたときに調べる（ずれ）
    if (aa1 && pl.every_frame.some((r: Row) => r.do.some((d: Row) => d.examine)))
      st.gap('毎フレームの処理で調べる表を替える（every_frame）', -1);
    const tabs = aa1 ? null : frameTabs(ctx, pl);
    const frame: Step[] = pl.every_frame.flatMap((r: FrameRow) => frameRowStep(ctx, r, tabs));
    const withFrame = (steps: Step[]) => (frame.length ? [...steps, ...frame] : steps);
    const enter: Step[] = [
      { set: { [ctx.placeFlag()]: P } },
      {
        if: ctx.returnFlag(),
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        then: [{ set: { [ctx.returnFlag()]: false } }],
        // 着いたときは、着いたときの表を使う（毎フレームの処理で替えた表を戻す）
        else: [{ set: { [pf]: 0 } }, ...(tabs ? [{ set: { [tabs.flag]: -1 } }] : []), ...chain(0)],
      },
      ...frame,
    ];
    // 人物（その場所の話す・つきつけるの表に出る人と、着いたときに出す人）
    const persons = new Set<number>();
    for (const t of inv.talk) if (t.place === P) persons.add(t.person & 0x1fff);
    for (const e of inv.present.entries) if (e.place === P) persons.add(e.person & 0x1fff);
    for (const path of pl.on_enter)
      for (const d of path.do) if (d.char !== undefined) persons.add(d.char & 0x1fff);
    const person = [...persons].map((k) => ({ id: ctx.character(k), when: `${pf} == ${k}` }));
    // 調べる
    const tableConds = new Map<string, string[]>();
    for (const path of pl.on_enter) {
      const t = [...path.do].reverse().find((d: { examine?: string | null }) => d.examine)
        ?.examine as string | undefined;
      const c = whenOf(ctx, path.when);
      if (t && c !== 'false') tableConds.set(t, [...(tableConds.get(t) ?? []), c]);
    }
    // 2・3: 毎フレームの処理で替えた表（tabs.flag = 表の番号。-1 なら着いたときの表）
    if (tabs) {
      for (const [t, conds] of tableConds)
        tableConds.set(
          t,
          conds.map((c) => and([c, `${tabs.flag} == -1`])),
        );
      for (const [t, i] of tabs.index)
        tableConds.set(t, [...(tableConds.get(t) ?? []), `${tabs.flag} == ${i}`]);
    }
    const examine: Record<string, unknown>[] = [];
    const nothing = aa1
      ? commonBlock(ctx, common, COMMON_NOTHING)
      : examineDefault23(ctx, P, sectionBlock, (s) => commonBlock(ctx, common, s));
    // 2・3: 表より先に見る決め打ち（そのときは表の所を調べても、決め打ちの区画）
    const blockers = aa1 ? [] : examineBlockers(ctx, P);
    if (blockers.includes('true')) tableConds.clear();
    // 範囲は背景の座標のまま（横長の背景は、調べる間に左右へ動かせる）
    const size = bgSize(pl.bg_file);
    for (const [table, conds] of tableConds) {
      const entries = inv.examine_tables[table] ?? [];
      // 条件つきを先に。重なったときに小さいものが選べるよう、同じ種類の中では小さい順
      const areaSize = (e: { quad: number[][] }) => {
        const a = areaOf(e.quad, size);
        return a ? a[2] * a[3] : 0;
      };
      const bySize = (xs: Record<string, any>[]) =>
        [...xs].sort(
          (a, b) => areaSize(a as { quad: number[][] }) - areaSize(b as { quad: number[][] }),
        );
      const sorted = [
        ...bySize(entries.filter((e: { kind: string }) => e.kind === 'cond')),
        ...bySize(entries.filter((e: { kind: string }) => e.kind !== 'cond')),
      ];
      for (const e of sorted) {
        const area = areaOf(e.quad, size);
        if (!area) {
          st.gap('背景の外の調べる場所', e.section.section);
          continue;
        }
        st.gap(
          '調べる場所の四角形を長方形にし、小さい順に並べた（元は 4 点の四角形と 16×16 のカーソルの重なり）',
          e.section.section,
        );
        const when = and([
          or(conds),
          ...(lateExamine ? [ctx.fname(0, EXAMINE_READY)] : []),
          ...(e.cond ? [aa1 ? condOf(ctx, e.cond) : condOf23(ctx, e.cond)] : []),
          ...blockers.map((c) => `not (${c})`),
        ]);
        if (when.includes('false')) continue;
        examine.push({
          area,
          ...(when !== 'true' ? { when } : {}),
          // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
          then: withFrame(sectionBlock(e.section)),
        });
      }
    }
    const examineDefault = withFrame(
      lateExamine
        ? // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
          [{ if: ctx.fname(0, EXAMINE_READY), then: nothing, else: block(EXAMINE_NOT_YET) }]
        : nothing,
    );
    // 話す
    const talk: Record<string, unknown>[] = [];
    const topicWhen = new Map<string, { t: Record<string, any>; k: number; flags: string[] }>();
    // 使うのは、同じ場所・人物の項目のうち有効な最初のもの（前の項目が有効なら、この項目は使わない）
    const earlier = new Map<number, string[]>();
    inv.talk.forEach((entry: Record<string, any>) => {
      if (entry.place !== P) return;
      const k = (entry.person as number) & 0x1fff;
      const own = ctx.talkFlag(entry.id as number);
      const before = earlier.get(k) ?? [];
      const flag = and([own, ...before.map((f) => `not ${f}`)]);
      earlier.set(k, [...before, own]);
      // 逆転裁判3 の 108 で足す話題（invest23.ts の talkAdds23）は、足した印のフラグも条件にする
      const topics = [
        ...entry.topics.map((t: Record<string, any>) => ({ t, cond: null as string | null })),
        ...talkAdds23(ctx, entry.id as number),
      ];
      for (const { t, cond } of topics) {
        const key = `${entry.person}:${t.topic}:${t.section.section}`;
        const v = topicWhen.get(key) ?? {
          t,
          k: (entry.person as number) & 0x1fff,
          flags: [] as string[],
        };
        v.flags.push(cond ? and([flag, cond]) : flag);
        topicWhen.set(key, v);
      }
    });
    for (const [key, v] of topicWhen) {
      const [, topic, sec] = key.split(':');
      talk.push({
        id: `${pid}_k${v.k}_t${topic}_${sec}`,
        topic: v.t.name_ocr || `話題 ${topic}`,
        when: and([`${pf} == ${v.k}`, or(v.flags)]),
        // 2・3: サイコ・ロックの印（89 で一覧に入れた区画の話題）
        ...(lockIcons.has(v.t.section.section)
          ? { locked: lockIconFlag(ctx, v.t.section.section) }
          : {}),
        // 話題の既読（組 2 のフラグ）を立ててから
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        then: withFrame([
          { set: { [ctx.fname(2, v.t.read_flag)]: true } },
          ...block(v.t.section.section),
        ]),
      });
    }
    // つきつける（人物ごとの表。合わなければその人の既定。人物ファイルも同じ表を引き、表に無ければ既定の反応）
    const rows = inv.present.entries.filter((e: { place: number }) => e.place === P);
    const byPerson = new Map<number, Record<string, any>[]>();
    for (const r of rows)
      byPerson.set(r.person & 0x1fff, [...(byPerson.get(r.person & 0x1fff) ?? []), r]);
    const personChain = (f: (k: number, rs: Record<string, any>[]) => Step[]): Step[] => {
      let out: Step[] = rows[0] ? block(rows[0].default.section) : [];
      for (const [k, rs] of [...byPerson].reverse()) {
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        out = [{ if: `${pf} == ${k}`, then: f(k, rs), ...(out.length ? { else: out } : {}) }];
      }
      return out;
    };
    const present: Record<string, Step[]> = {};
    const items = new Set<number>(
      rows
        .filter((r: { item: number | null }) => r.item !== null)
        .map((r: { item: number }) => r.item),
    );
    for (const item of items) {
      // 法廷記録の番号は証拠品と人物ファイルで通し番号。人物ファイルなら、YAML では人物 ID をキーにする
      // （2・3 は表の種類の列で分ける）
      const profile = aa1
        ? ctx.shared.profileRecords.has(item)
        : rows.some((r: Row) => r.item === item && r.record === 'profile');
      const key = profile ? ctx.profile(item) : ctx.evidenceId(item);
      present[key] = withFrame(
        aa1
          ? personChain((_k, rs) => {
              const hit = rs.find((r) => r.item === item);
              return block((hit ?? rs.at(-1)!)[hit ? 'section' : 'default'].section);
            })
          : presentChain23(ctx, P, rows, item, profile ? 'profile' : 'evidence', block),
      );
    }
    // 2・3: 表に無い人物ファイルは、人物ファイルの行の既定の反応（証拠品の見当違いとは別）
    if (!aa1 && rows.some((r: Row) => r.record === 'profile'))
      for (const rec of ctx.shared.chapterProfiles) {
        const key = ctx.profile(rec);
        if (!(key in present))
          present[key] = withFrame(presentChain23(ctx, P, rows, null, 'profile', block));
      }
    const presentWrong = withFrame(
      aa1
        ? personChain((_k, rs) => block(rs.at(-1)!.default.section))
        : presentChain23(ctx, P, rows, null, 'evidence', block),
    );
    // 移動する（51 で版が変わる）
    const versions = ctx.moveVersions.get(P) ?? [pl.dest];
    const mv = versions.length > 1 ? ctx.flag(`${ctx.gpfx}mv_${P}`, 0) : null;
    const dests = [...new Set(versions.flat())];
    const move = dests
      .filter((d) => d !== P && inv.places.some((x: { id: number }) => x.id === d))
      .map((d) => {
        const ks = versions.flatMap((v, k) => (v.includes(d) ? [k] : []));
        return ks.length === versions.length || !mv
          ? ctx.placeId(d)
          : { to: ctx.placeId(d), when: or(ks.map((k) => `${mv} == ${k}`)) };
      });
    places[pid] = {
      name: pl.name?.ocr || `場所 ${P}`,
      background: bgKey(pl.bg, ctx.t.game).key,
      ...(person.length ? { person } : {}),
      enter,
      ...(examine.length ? { examine } : {}),
      examineDefault,
      ...(talk.length ? { talk } : {}),
      ...(Object.keys(present).length ? { present } : {}),
      ...(rows.length ? { presentWrong } : {}),
      ...(move.length ? { move } : {}),
    };
  }
  const start = startPlace(ctx);
  const menu: Step[] = [
    ...inv.places.map((pl: { id: number }) => ({
      if: `${ctx.placeFlag()} == ${pl.id}`,
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      then: [{ investigate: ctx.placeId(pl.id) }],
    })),
    { set: { [ctx.returnFlag()]: false } },
    { investigate: ctx.placeId(start) },
  ];
  return { places, menu, startAtMenu: startsWithEvent(ctx, start) };
}
