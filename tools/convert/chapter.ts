// 1 つの話（複数の項目 = 編）を 1 つの章（シナリオ）にまとめる。
//   第 2 話 = 項目 002（探偵）・004（法廷）・006（探偵）・008（法廷）
// 編の境目（22 next_part）では、法廷記録を次の編の最初の中身（evidence.json の start）に入れ替えて、次の編の最初のシーンへ。
// ゲームオーバーは編ごとに違う区画なので、今の編（フラグ part）で分ける gameover シーンを作る。
import { Shared } from './context.ts';
import { markNoScroll } from './examine-area.ts';
import { buildExamine } from './examine3d-build.ts';
import { dayStartFlags, investigationStartFlags } from './investigation.ts';
import { isStandKey } from './mapping.ts';
import { pruneUnusedScenes } from './prune.ts';
import { convertGroup, type PartResult } from './scenario.ts';
import type { Entry, Step, Tables } from './types.ts';

/**
 * サイコ・ロックに挑むのに使う証拠品（勾玉）。2: 0x2b（A2GJ 0x02032800）、
 * 3: 0x21・0x57・0xa9（YG3J 0x02032ac4。話ごとに別の勾玉）
 */
const LOCK_KEYS: Record<string, number[]> = { aa1: [], aa2: [43], aa3: [33, 87, 169] };

export interface ChapterOptions {
  id: string;
  title: string;
  common?: Entry | null;
  /** investigation.json の parts（探偵パートの表） */
  invParts?: Record<string, any>[];
  /** 3D で詳しく調べるときの台詞の項目（070/071、第 5 話） */
  item070?: Entry | null;
}

export function convertChapter(
  t: Tables,
  entries: Entry[],
  opts: ChapterOptions,
): { scenario: Record<string, unknown>; results: PartResult[] } {
  const multi = entries.length > 1;
  const pfx = (e: Entry) => (multi ? `p${e.entry >> 1}_` : '');
  // 探偵パートの表: 2・3 は表の items（パートの項目の一覧。3 はパートの番号が項目 >> 1 ではない）で引く
  const item = (e: Entry) => String(e.entry & ~1).padStart(3, '0');
  const invOf = (e: Entry) =>
    opts.invParts?.find(
      (p) =>
        (p.items ? p.items.includes(item(e)) : p.part === e.entry >> 1) &&
        p.kind === 'investigation' &&
        p.places?.length,
    ) ?? null;
  const profileRecords = collectProfileRecords(t, entries);
  const startOf = (e: Entry) => t.evidenceStart.find((s) => s.part === e.entry >> 1);
  /** 項目のパート（game+0x69）。逆転裁判3 は court.json の part_starts（パートの最初の項目）で決まる */
  const realPart = (e: Entry): number => {
    const st = t.court.part_starts;
    return st ? st.findLastIndex((x) => x <= (e.entry & ~1)) : e.entry >> 1;
  };
  const partFlag = 'part';

  // 組: 第 5 話では 1 つの探偵パート（同じ場所の表）が複数の項目にまたがる。続く項目で表が同じなら同じ組
  const groups: Entry[][] = [];
  for (const e of entries) {
    const inv = invOf(e),
      last = groups.at(-1);
    const prevInv = last ? invOf(last.at(-1)!) : null;
    if (last && inv && prevInv && inv.init?.places_src === prevInv.init?.places_src) last.push(e);
    else groups.push([e]);
  }
  const groupOf = (k: number) => groups.findIndex((g) => g.includes(entries[k]!));
  const run = (
    shared: Shared,
    next: (k: number) => Step[] | undefined,
    toPart?: (part: number) => Step[],
  ): PartResult[] => {
    let k = 0;
    return groups.flatMap((g) =>
      convertGroup(
        t,
        g.map((e) => {
          const m = {
            entry: e,
            inv: invOf(e),
            pfx: pfx(e),
            nextPart: next(k),
            ...(toPart ? { toPart } : {}),
          };
          k++;
          return m;
        }),
        { common: opts.common ?? null, shared, gpfx: pfx(g[0]!) },
      ),
    );
  };

  // 1 回目: 章で使う証拠品・人物ファイルを集める（編の境目で法廷記録を入れ替えるため）
  const probe = new Shared();
  for (const r of profileRecords) probe.profileRecords.add(r);
  const chapterRecords = collectChapterRecords(t, entries);
  for (const r of chapterRecords) probe.chapterRecords.add(r);
  const probed = run(probe, () => undefined);
  const allEvidence = [...probe.evidence].sort((a, b) => a - b).map((n) => `e${n}`);
  const allProfiles = [...probe.characters].filter(([, c]) => c.profile).map(([id]) => id);
  const allFlags = [...new Set(probed.flatMap((r) => [...r.ctx.flags.keys()]))];
  const initial = (e: Entry) => ({
    evidence: (startOf(e)?.evidence ?? []).map((n) => `e${n}`),
    profiles: (startOf(e)?.profiles ?? []).map((r) => probed[0]!.ctx.profile(r)),
  });
  // 編の境目: 法廷記録を次の編の最初の中身に入れ替えて、次の編へ。組が変わるなら前の組のフラグを初期値に戻す
  // （次の組では読まないので、整合性チェックの状態を増やさない）。同じ組の中なら、探偵パートの最初の場所から
  const transition = (k: number): Step[] => {
    const e = entries[k]!;
    const init = initial(e);
    // 逆転裁判3 で 106 が読む、パートの途中の項目（パートの最初の項目でない）は、同じパートの続き
    const partStarts = t.court.part_starts;
    const cont = !!partStarts && !partStarts.includes(e.entry & ~1);
    const sameGroup = groupOf(k) === groupOf(k - 1) || cont;
    const part = e.entry >> 1;
    // 前の組だけのフラグ（場所・人物・話題など）は初期値に戻す。台本のフラグ（f_組_番号）は探偵パートの始めの決まりどおり
    const prev = sameGroup
      ? {}
      : Object.fromEntries([...probed[k - 1]!.ctx.flags].filter(([f]) => !/^f_\d+_/.test(f)));
    const day = sameGroup ? null : dayStartFlags(part, allFlags, t.game);
    const startFlags = {
      ...day,
      ...(invOf(e) && !sameGroup ? investigationStartFlags(part, allFlags, t.game) : {}),
    };
    const place = t.investStart?.[String(realPart(e))];
    // 法廷記録: 第 1〜4 話は編ごとに作り直す（evidence.json の start）。第 5 話（パート 17〜）は日の始めだけ作り直し、
    // ほかは引き継ぐ（日の途中の証拠品の入れ替え（146 → 147 など）は台本に無く、日の始めの中身にだけ現れる）
    // 逆転裁判2・3 はパートの始め（evidence.json の start がある項目）ごとに作り直す
    const rebuild = t.game === 'aa1' ? part < 17 || day !== null : !cont && !!startOf(e);
    return [
      ...(Object.keys(prev).length || Object.keys(startFlags).length
        ? [{ set: { ...prev, ...startFlags } }]
        : []),
      ...(rebuild && allEvidence.length ? [{ take: allEvidence }] : []),
      ...(rebuild && allProfiles.length ? [{ takeProfile: allProfiles }] : []),
      ...(rebuild && init.evidence.length ? [{ give: init.evidence }] : []),
      ...(rebuild && init.profiles.length ? [{ giveProfile: init.profiles }] : []),
      {
        set: {
          [partFlag]: k,
          ...(sameGroup && place !== undefined ? { [probed[k]!.ctx.placeFlag()]: place } : {}),
        },
      },
      { goto: probed[k]!.start },
    ];
  };

  const shared = new Shared();
  for (const r of profileRecords) shared.profileRecords.add(r);
  for (const r of chapterRecords) shared.chapterRecords.add(r);
  shared.chapterProfiles = [...probe.characters.values()].flatMap((c) => {
    const icon = (c.profile as { icon?: string } | undefined)?.icon;
    return icon?.startsWith('r') ? [Number(icon.slice(1))] : [];
  });
  // 22 next_part は game+0x69 を 1 進める（ただし 0x1c の次は 0x1f、第 5 話の 3 日目の探偵パート → 最後の法廷）。
  // 106 は次の語の値のパートへ移る
  const indexOfPart = (part: number) => entries.findIndex((e) => e.entry >> 1 === part);
  // 逆転裁判3: パートの番号は項目 >> 1 ではない（court.json の part_starts = パートの最初の項目）。
  // 106 k は表（load_106）の項目を読む（同じパートのまま）
  const starts = t.court.part_starts;
  const indexOfItem = (item: number | undefined) => entries.findIndex((e) => e.entry === item);
  const toPart = (v: number): Step[] => {
    const j = starts ? indexOfItem(t.court.load_106?.[String(v)]) : indexOfPart(v);
    return j > 0 ? transition(j) : [{ end: true }];
  };
  const nextPartIndex = (k: number): number => {
    const item = entries[k]!.entry & ~1;
    if (starts) {
      const p = starts.findLastIndex((s) => s <= item);
      return indexOfItem(starts[p + 1]);
    }
    const part = item >> 1;
    return indexOfPart(t.game === 'aa1' && part === 0x1c ? 0x1f : part + 1);
  };
  // 逆転裁判3: 22 で法廷 → 探偵パートに移るとき、ゲージを 40 回復する（パートの種類 court.json の part_kinds）
  const kinds = t.court.part_kinds;
  const heal = (k: number): Step[] => {
    if (!starts || !kinds) return [];
    const p = starts.findLastIndex((s) => s <= (entries[k]!.entry & ~1));
    return kinds[p] === 3 && kinds[p + 1] === 4 ? [{ heal: 40 }] : [];
  };
  const results = run(
    shared,
    (k) => {
      const j = nextPartIndex(k);
      const go =
        j > 0 ? transition(j) : k < entries.length - 1 ? transition(k + 1) : [{ end: true }];
      return [...heal(k), ...go];
    },
    toPart,
  );
  if (multi)
    for (const r of results)
      r.ctx.stats.gap('編の境目でライフを戻さない（元は法廷の日ごとに戻る）', -1);

  // 最初の法廷記録の中身も、章の証拠品・人物ファイルに入れる
  for (const e of entries) {
    for (const n of startOf(e)?.evidence ?? []) shared.evidence.add(n);
    for (const r of startOf(e)?.profiles ?? []) results[0]!.ctx.profile(r);
  }
  // 3D で詳しく調べる（第 5 話）: 項目 070 の台詞の人物・証拠品も章に入るので、人物・証拠品を並べる前に
  const { examine, luminol } = buildExamine(
    t,
    results.map((r) => r.ctx),
    [...shared.evidence],
    opts.item070 ?? null,
    multi ? partFlag : null,
  );
  // ルミノールの反応の場所は、その場所の調べる所の先頭に
  for (const r of results) {
    for (const [id, pl] of Object.entries(
      (r.part.places ?? {}) as Record<string, { examine?: unknown[] }>,
    )) {
      const add = luminol.get(id);
      if (add) pl.examine = [...add, ...(pl.examine ?? [])];
    }
  }
  // 調べる間に背景を動かせない場所（第 5 話の地下駐車場の一部）
  markNoScroll(results, multi ? partFlag : null);
  const characters: Record<string, unknown> = {};
  for (const [id, c] of [...shared.characters].sort()) {
    const votes = [...(shared.standVotes.get(id) ?? [])]
      .filter(([k]) => isStandKey(k))
      .sort((a, b) => b[1] - a[1]);
    characters[id] = {
      name: c.name,
      ...(votes[0] ? { stand: votes[0][0] } : {}),
      ...(c.blip ? { blip: c.blip } : {}),
      ...(c.profile ? { profile: c.profile } : {}),
    };
  }
  // 詳しく調べるのは、法廷記録に入る証拠品だけ（編の最初の中身か give で入るもの。show_item で絵を出すだけの物
  // （第 5 話の 171〜204 など）は法廷記録に入らないので、ゲームでは調べられない）
  const held = new Set(entries.flatMap((e) => (startOf(e)?.evidence ?? []).map((n) => `e${n}`)));
  collectGives([...results.map((r) => r.part), ...examine.values()], held);
  // サイコ・ロック: 挑むのに使う証拠品（勾玉）。章の証拠品に入れる
  const lockKeys = shared.lockKeys ? (LOCK_KEYS[t.game] ?? []) : [];
  for (const n of lockKeys) shared.evidence.add(n);
  const evidence: Record<string, unknown> = {};
  for (const n of [...shared.evidence].sort((a, b) => a - b)) {
    const text = results[0]!.ctx.recordText(n);
    const ex = held.has(`e${n}`) ? examine.get(n) : undefined;
    evidence[`e${n}`] = {
      name: text?.name || `証拠品 ${n}`,
      description: text?.desc ?? '',
      ...(ex ? { examine: ex } : {}),
    };
  }
  const flags: Record<string, unknown> = multi ? { [partFlag]: 0 } : {};
  for (const r of results) for (const [k, v] of r.ctx.flags) if (!(k in flags)) flags[k] = v;
  // 最初の編が探偵パートなら、その始めの決まり（パート > 1 ならフラグ 0x41 = 1）
  if (invOf(entries[0]!))
    Object.assign(
      flags,
      Object.fromEntries(
        Object.entries(investigationStartFlags(entries[0]!.entry >> 1, [], t.game)).filter(
          ([, v]) => v,
        ),
      ),
    );
  const player =
    [...shared.standVotes]
      .filter(([, m]) => m.has('defense'))
      .sort((a, b) => b[1].get('defense')! - a[1].get('defense')!)[0]?.[0] ??
    results[0]!.ctx.speaker(2);
  const parts = results.map((r) => r.part);
  // ゲームオーバー: 今の編の区画へ
  const overs = results.map((r, k) => [k, r.gameover] as const).filter(([, g]) => g !== null);
  let gameover: string | undefined;
  if (overs.length === 1 || (!multi && overs.length)) gameover = overs[0]![1]!;
  else if (overs.length > 1) {
    gameover = 'gameover';
    const last = parts.findLast((p) => p.kind === 'trial') ?? parts.at(-1)!;
    (last.scenes as Record<string, unknown>).gameover = [
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      ...overs.slice(0, -1).map(([k, g]) => ({ if: `${partFlag} == ${k}`, then: [{ goto: g! }] })),
      { goto: overs.at(-1)![1]! },
    ];
  }
  const first = initial(entries[0]!);
  const scenario: Record<string, unknown> = {
    id: opts.id,
    title: opts.title,
    player,
    // ライフ: 蘇る逆転は「！」5 個、2・3 はゲージ（0〜80）
    life: t.game === 'aa1' ? 5 : 80,
    defaults: { penalty: 1, autoShow: false, autoPause: false },
    ...(lockKeys.length ? { psycheLock: { keys: lockKeys.map((n) => `e${n}`), heal: 40 } } : {}),
    characters,
    evidence,
    ...(Object.keys(flags).length ? { flags } : {}),
    start: { scene: results[0]!.start, evidence: first.evidence, profiles: first.profiles },
    ...(gameover ? { gameover } : {}),
    parts,
  };
  pruneUnusedScenes(
    scenario,
    results.map((r) => r.ctx),
  );
  pruneUnreadFlags(scenario);
  return { scenario, results };
}

/** ステップ列（などのオブジェクト）の中の give の証拠品を out に集める */
export function collectGives(x: unknown, out: Set<string>, seen = new Set<object>()): void {
  if (typeof x !== 'object' || x === null || seen.has(x)) return;
  seen.add(x);
  if (Array.isArray(x)) {
    for (const v of x) collectGives(v, out, seen);
    return;
  }
  for (const [k, v] of Object.entries(x)) {
    if (k === 'give')
      ([] as unknown[]).concat(v).forEach((id) => {
        if (typeof id === 'string') out.add(id);
      });
    else collectGives(v, out, seen);
  }
}

/** 人物ファイルとして使われる法廷記録の番号（最初の中身と、23/24/25 の bit15） */
function collectProfileRecords(t: Tables, entries: Entry[]): Set<number> {
  const out = new Set<number>(t.evidenceStart.flatMap((s) => s.profiles));
  for (const e of entries) {
    for (const sec of e.body) {
      for (const o of sec.ops) {
        if (o.op === 'text' || ![23, 24, 25].includes(o.op)) continue;
        if (o.args[0]! & 0x8000)
          for (const a of o.op === 25 ? o.args : [o.args[0]!]) out.add(a & 0x3fff);
      }
    }
  }
  return out;
}

/**
 * 章の中で法廷記録に入りうる番号（編の最初の中身と、23 / 25 で加える番号）。サイコ・ロックの正解のうち、これに無い番号
 * （逆転裁判3 の第 5 話 070 §121 の 0 など）は、どう選んでも当たらない（ARM9 は選んだ項目の番号と 1 バイトで比べるだけ）
 */
function collectChapterRecords(t: Tables, entries: Entry[]): Set<number> {
  const parts = new Set(entries.map((e) => e.entry >> 1));
  const out = new Set<number>(
    t.evidenceStart.filter((s) => parts.has(s.part)).flatMap((s) => [...s.evidence, ...s.profiles]),
  );
  for (const e of entries)
    for (const sec of e.body)
      for (const o of sec.ops)
        if (o.op === 23 || o.op === 25)
          for (const a of o.op === 25 ? o.args : [o.args[0]!]) out.add(a & 0x3fff);
  return out;
}

/**
 * 条件式で一度も読まないフラグの set を外す（整合性チェックの状態の数を減らす。元の台本では調べた印などに使うが、
 * 変換した章の中では誰も読まない）。読むフラグの一覧を返す
 */
export function pruneUnreadFlags(scenario: Record<string, unknown>): Set<string> {
  const read = new Set<string>();
  const walkRead = (x: unknown): void => {
    if (Array.isArray(x)) {
      x.forEach(walkRead);
      return;
    }
    if (typeof x !== 'object' || x === null) return;
    for (const [k, v] of Object.entries(x)) {
      if ((k === 'if' || k === 'when' || k === 'locked') && typeof v === 'string')
        for (const m of v.matchAll(/[A-Za-z_][A-Za-z0-9_]*/g)) read.add(m[0]);
      walkRead(v);
    }
  };
  walkRead(scenario);
  const seen = new Set<object>();
  const prune = (x: unknown): void => {
    if (typeof x !== 'object' || x === null || seen.has(x)) return;
    seen.add(x);
    if (Array.isArray(x)) {
      for (let i = x.length - 1; i >= 0; i--) {
        const s = x[i];
        if (s && typeof s === 'object' && 'set' in s && Object.keys(s).length === 1) {
          const set = (s as { set: Record<string, unknown> }).set;
          for (const k of Object.keys(set)) if (!read.has(k)) delete set[k];
          if (Object.keys(set).length === 0) x.splice(i, 1);
        }
      }
    }
    Object.values(x).forEach(prune);
  };
  prune(scenario.parts ?? scenario.scenes);
  const flags = scenario.flags as Record<string, unknown> | undefined;
  if (flags) for (const k of Object.keys(flags)) if (!read.has(k)) delete flags[k];
  return read;
}
