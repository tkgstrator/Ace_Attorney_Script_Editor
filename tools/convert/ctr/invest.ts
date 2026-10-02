// 3DS 版（逆転裁判6）の探偵パートを、探索編の場所（places）にする。
//
// 物語のファイルの <E386 背景 場所> で行き来できる場所を並べ、<E393 場所 ラベル> で探偵パートに入る（場所は
// 表 12（APP_PARAM_ID_SCRIPT_BG）の番号で、場所の台本の版まで決まる。ラベルは終わった後に進む先）。<E394> で終わる。
// 場所の台本（_sceNN_bgNNNN_*）の中身:
//   最初のラベル（L_EVENT_CHECK か L_START）  来たとき。<E052> の出来事の判定や最初の会話を経て L_DTC（<E371>）に着く
//   <E313 ? 番 ラベル …>                      調べる所（3D の部品）。ラベルの台詞が調べたとき
//   <E311 ラベル>                            何もない所を調べたとき
//   <E380 ラベル>                            つきつけ（L_THRUST_nn の <E224>・<E225>）
//   <E377 人 話題 ラベル>・<E378 人 旧 新 ラベル>  話す話題の追加・差し替え。話題の名前は topic_sceNN の（番号 - 最小の番号）番目
// 調べる所の位置は 3D の部品なので取れず、画面を縦に切った帯で選ばせる近似にしている。

import type { Hub } from './calls.ts';
import { type Ctx, charId, type Step } from './convert.ts';
import type { Shared } from './file.ts';
import { spotLabel } from './games.ts';
import { type Entry, tokenize } from './gmd.ts';
import { prune, setTrue } from './prune.ts';

export type InvestOpts = {
  /** 表 12（場所の台本）の番号 → 台本の名前（sce01_bg0105_0_00） */
  bgScripts: (string | null)[];
  /** 場所の名前（BG0105 → 成歩堂なんでも事務所） */
  bgNames: Map<string, string>;
  /** 表 11（人物の台本）の番号 → 台本の名前（sce01_chr0105_01） */
  chrScripts: (string | null)[];
  /** 話題の名前（話題の番号 → 名前） */
  topicName: (id: number) => string | null;
  load: (name: string) => Entry[] | null;
  block: (short: string, entries: Entry[], k: number, hub?: Hub) => Step[];
  shared: () => Shared;
  /** 進み具合のフラグ（f{バンク}_{番号}）が、物語のファイル file の探偵パートで立ちうるか */
  flagPossible: (flag: string, file: string) => boolean;
};

type Place = Record<string, unknown>;

/** 場所を組み立てた後に、探偵パートの終わりの判定（<E392>）を足すための手がかり */
type Meta = {
  talk: { id: string; flag: string; then: Step[] }[];
  /** <E394> で終わる話題・調べる所・つきつけがあるか（LABEL_0000 などの終わりの判定を除く） */
  realEnd: boolean;
  /** LABEL_0000（<E392> の条件が満たされたときにゲームが実行する）が探偵パートを終えるならそのラベル */
  doneK: number | null;
  run: (k: number) => Step[];
  /** サイコ・ロックの遊び（L_PSYCO_START）がある場所 */
  psyche: boolean;
};

/** 探偵パートの入口の近似で使う、来たときのラベル */
function entryLabel(entries: Entry[]): number {
  const find = (l: string) => entries.findIndex((e) => e.label === l);
  const skip = /^(LABEL_0000|L_DTC_END|L_LOAD.*|L_INIT)$/;
  for (const l of ['L_EVENT_CHECK', 'L_START']) if (find(l) >= 0) return find(l);
  return entries.findIndex((e) => e.label && !skip.test(e.label));
}

export function makeInvest(o: InvestOpts) {
  const places: Record<string, Place> = {};
  const scenes: Record<string, Step[]> = {};
  const meta: Record<string, Meta> = {};

  const build = (
    id: string,
    file: string,
    short: string,
    entries: Entry[],
    hubBase: { chap: number; scene: number; end: Step[] },
    moves: string[],
  ): { place: Place; meta: Meta } => {
    const shared = o.shared();
    const blocks = entries.map((e) => tokenize(e.text));
    const cmds = blocks.flatMap((b) => b.flatMap((t) => (t.kind === 'cmd' ? [t] : [])));
    const labelIdx = (l: string) => entries.findIndex((e) => e.label === l);

    // 話題: (話題, ラベル) ごとにフラグを 1 つ。足す・差し替えで立てる・下ろす
    const variants = new Map<number, Set<number>>();
    const addVariant = (t: number, l: number) => {
      if (!variants.has(t)) variants.set(t, new Set());
      variants.get(t)!.add(l);
    };
    for (const c of cmds) {
      if (c.name === 'E377') addVariant(c.args[1]!, c.args[2]!);
      if (c.name === 'E378') {
        addVariant(c.args[2]!, c.args[3]!);
        if (!variants.has(c.args[1]!)) variants.set(c.args[1]!, new Set());
      }
    }
    const topicFlag = (t: number, l: number) => `${id}_t${t}_${l}`;
    const topics: Ctx['topics'] = (swap, a) => {
      if (!swap) {
        shared.flags.add(topicFlag(a[1]!, a[2]!));
        return [{ set: { [topicFlag(a[1]!, a[2]!)]: true } }];
      }
      const off = [...(variants.get(a[1]!) ?? [])].map((l) => topicFlag(a[1]!, l));
      for (const f of off) shared.flags.add(f);
      shared.flags.add(topicFlag(a[2]!, a[3]!));
      return [
        {
          set: {
            ...Object.fromEntries(off.map((f) => [f, false])),
            [topicFlag(a[2]!, a[3]!)]: true,
          },
        },
      ];
    };
    const hub: Hub = { ...hubBase, topics };
    const run = (k: number) => o.block(short, entries, k, hub);

    // 来たとき
    const start = entryLabel(entries);
    // ゲームは来たあとで L_TOPIC_INIT（あれば）を実行して話題を並べ直す（L_START の先で通らない場所もある）
    const topicInit = labelIdx('L_TOPIC_INIT');
    const enter = [...(start >= 0 ? run(start) : []), ...(topicInit >= 0 ? run(topicInit) : [])];

    // 調べる所: 部品ごとの <E313> を、ラベルで束ねて画面の帯にする
    const spots = new Map<number, number>();
    for (const c of cmds)
      if (c.name === 'E313' && !spots.has(c.args[2]!)) spots.set(c.args[2]!, c.args[1]!);
    const cols = Math.max(1, spots.size);
    const examine = [...spots].map(([label, spot], i) => ({
      id: `${id}_inv${label}`,
      name: spotLabel(entries, label, spot),
      area: [Math.floor((256 / cols) * i), 0, Math.floor(256 / cols), 192],
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      then: run(label),
    }));

    // つきつけ: L_THRUST_nn のブロックの要求（<E224>）を、場所のつきつけにまとめる
    const present: Record<string, Step[]> = {};
    let wrong: Step[] | null = null;
    entries.forEach((e, k) => {
      if (!e.label?.startsWith('L_THRUST') || e.label.endsWith('_OK')) return;
      const steps = o.block(short, entries, k, hub);
      const demand = steps.find((s) => 'demand' in s);
      if (!demand) return;
      for (const [key, v] of Object.entries(demand.present as Record<string, Step[]>))
        present[key] ??= v;
      wrong ??= (demand.wrong as Step[] | undefined) ?? [];
    });

    // 話す
    const talk: Record<string, unknown>[] = [];
    const talkMeta: Meta['talk'] = [];
    for (const [t, ls] of variants) {
      const name = o.topicName(t) ?? `話題 ${t}`;
      const sorted = [...ls].sort((a, b) => a - b);
      for (const l of sorted) shared.flags.add(topicFlag(t, l));
      // 同じ話題の版（差し替えで入れ替わる）は 1 つの項目にまとめる（別々にすると聞いた印の組が増えて、
      // 整合性チェックの状態が溢れる）。どの版かは、立っているフラグで分ける
      const flag = sorted.map((l) => topicFlag(t, l)).join(' or ');
      const chain = (rest: number[]): Step[] =>
        rest.length === 0
          ? []
          : rest.length === 1
            ? run(rest[0]!)
            : // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
              [{ if: topicFlag(t, rest[0]!), then: run(rest[0]!), else: chain(rest.slice(1)) }];
      const then = chain(sorted);
      const tid = `${id}_talk${t}`;
      talkMeta.push({ id: tid, flag: `(${flag})`, then });
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      talk.push({ id: tid, topic: name, when: flag, then });
    }

    // 人物: 話題で呼ぶ人物の台本（<E033 11 番号 …>、chr0105 → p105）。名前欄の表にいる人だけ
    const chr = cmds
      .filter((c) => c.name === 'E033' && c.args[0] === 11)
      .map((c) => o.chrScripts[c.args[1]!]?.match(/_chr(\d+)_/)?.[1])
      .find((x) => x);
    // 台本を呼ばない場所は、話題や会話で最初に話す人（弁護士も含む）
    const spoken = JSON.stringify([talk, enter]).match(/"(p\d{3})":/)?.[1];
    const pid = chr ? `p${String(Number(chr)).padStart(3, '0')}` : (spoken ?? '');
    const personIdx = pid ? shared.names.findIndex((n) => charId(n) === pid) : -1;
    const person = personIdx >= 0 ? pid : null;
    if (person) shared.usedNames.add(personIdx);

    const isEnd = (t: { kind: string; name?: string }) => t.kind === 'cmd' && t.name === 'E394';
    const hook = /^(LABEL_0000|L_FLAG_CHECK|L_DTC_END|L_EVENT.*)$/;
    const realEnd = entries.some((e, k) => !hook.test(e.label ?? '') && blocks[k]!.some(isEnd));
    const zero = labelIdx('LABEL_0000');
    // 終わりの判定は LABEL_0000。無い台本（場所の台本が物語のファイルを兼ねるもの）は L_DTC_END
    const endK = zero >= 0 ? zero : labelIdx('L_DTC_END');
    const doneK =
      endK >= 0 && entries.some((e, k) => hook.test(e.label ?? '') && blocks[k]!.some(isEnd))
        ? endK
        : null;

    // この探偵パートでは立たないフラグの枝（と、そのせいで選べない話題）を落とす
    const local = new Set<string>();
    const possible = (f: string) =>
      /^f\d+_\d+$/.test(f)
        ? o.flagPossible(f, file)
        : f.startsWith(`${id}_t`)
          ? local.has(f)
          : true;
    const rawTalk = talk.map((t, i) => ({ t, m: talkMeta[i]! }));
    let cur: {
      enter: Step[];
      examine: unknown;
      present: unknown;
      wrong: Step[] | null;
      thens: Step[][];
    };
    for (;;) {
      cur = {
        enter: prune(enter, possible),
        examine: prune(examine, possible),
        present: prune(present, possible),
        wrong: wrong && prune(wrong as Step[], possible),
        thens: rawTalk.map(({ m }) => prune(m.then, possible)),
      };
      const found = new Set<string>();
      // 話題の中で立てるフラグは、その話題が選べるとき（フラグが立ちうるとき）だけ数える
      const open = cur.thens.filter((_, i) =>
        String(rawTalk[i]!.t.when)
          .split(' or ')
          .some((f) => local.has(f)),
      );
      setTrue([cur.enter, cur.examine, cur.present, cur.wrong, open], found);
      const before = local.size;
      for (const f of found) if (f.startsWith(`${id}_t`)) local.add(f);
      if (local.size === before) break;
    }
    const kept = rawTalk.flatMap(({ t, m }, i) => {
      if (
        !String(t.when)
          .split(' or ')
          .some((f) => local.has(f))
      )
        return [];
      const then = cur.thens[i]!;
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      return [{ t: { ...t, then }, m: { ...m, then } }];
    });

    const bg = short.match(/_bg(\d+)_/)?.[1] ?? '0000';
    const place: Place = {
      name: o.bgNames.get(`BG${bg}`) ?? `場所 ${bg}`,
      background: `bg${bg}`,
      ...(person ? { person } : {}),
      ...(cur.enter.length ? { enter: cur.enter } : {}),
      ...((cur.examine as unknown[]).length ? { examine: cur.examine } : {}),
      ...(kept.length ? { talk: kept.map((k) => k.t) } : {}),
      ...(Object.keys(cur.present as object).length ? { present: cur.present } : {}),
      ...(cur.wrong?.length ? { presentWrong: cur.wrong } : {}),
      ...(moves.length ? { move: moves } : {}),
    };
    return {
      place,
      meta: {
        talk: kept.map((k) => k.m),
        realEnd,
        doneK,
        run,
        psyche: labelIdx('L_PSYCO_START') >= 0,
      },
    };
  };

  const investigate: Shared['investigate'] = (file, hub, end, place, others, endFlags) => {
    const order = [place, ...others.filter((p) => p !== place)];
    const ids = order.flatMap((p) => {
      const short = o.bgScripts[p];
      return short && o.load(short)
        ? [{ p, short, id: `${file}_${short.replace(/^sce\d+_/, '')}` }]
        : [];
    });
    if (ids.length === 0) return [{ native: 'E393', args: [place] }, ...end];
    // 探偵パートを出るときは出口のシーンを通す。そこで、この探偵パートの場所で手に入る法廷記録をまとめて加える
    // （物語のファイルをファイル名の順につなぐ近似なので、取らずに先へ進める道ができて詰むのを防ぐ）
    const exit = `${file}_dtc_exit${place}`;
    const toExit: Step[] = [{ goto: exit }];
    const fresh: string[] = [];
    for (const { p, short, id } of ids) {
      if (places[id]) continue;
      places[id] = {}; // 再入の防止
      const r = build(
        id,
        file,
        short,
        o.load(short)!,
        { ...hub, end: toExit },
        ids.filter((x) => x.p !== p).map((x) => x.id),
      );
      places[id] = r.place;
      meta[id] = r.meta;
      fresh.push(id);
    }
    // <E392> で登録した終わりの条件（ゲームは満たすと LABEL_0000 を実行する）は台本に書かれていない。話題がすべて
    // 終わったときと見て、話したあとに判定する。話題や調べる所に <E394> がある探偵パートには足さない
    const all = ids.map((x) => x.id);
    if (fresh.length && !all.some((x) => meta[x]?.realEnd)) {
      // 終わりの条件のフラグ（<E392>）は、話題で呼ぶ人物の台本が立てることが多い（<E033> で展開済みの、変換した場所の
      // 中身を見る。来たときの会話は数えない）。場所の判定（LABEL_0000）自身が立てるものは何が立てるのか台本に無いので、最後の話題を聞いたか、で近似する
      const built = JSON.stringify(
        all.map((x) => [places[x]?.talk, places[x]?.examine, places[x]?.present]),
      );
      const byFlags = endFlags.length > 0 && endFlags.every((f) => built.includes(`"${f}":true`));
      const seenLast = all
        .flatMap((x) => meta[x]?.talk ?? [])
        .slice(-4)
        .map((t) => `(not ${t.flag} or seen(${t.id}))`)
        .join(' and ');
      // フラグの組は台本の外の遊び（サイコ・ロックなど）を経ないと立たないことがあるので、最後の話題を聞いた場合も終わりとする
      // サイコ・ロックのある場所（L_PSYCO_START）は、錠を外す遊びが台本の外で、フラグが立たないことがあるので、
      // 最後の話題を聞いた場合も終わりとする。ほかは元のゲームどおり、フラグがすべて立ったとき
      const psyche = all.some((x) => meta[x]?.psyche);
      const cond =
        byFlags && psyche && seenLast
          ? `(${endFlags.join(' and ')}) or (${seenLast})`
          : byFlags
            ? endFlags.join(' and ')
            : seenLast;
      const terms = cond ? [cond] : [];
      for (const x of fresh) {
        const m = meta[x]!;
        if (m.doneK === null || terms.length === 0) continue;
        scenes[`${x}_done`] = [...m.run(m.doneK), { investigate: x }];
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        for (const t of m.talk) t.then.push({ if: cond, then: [{ goto: `${x}_done` }] });
      }
    }
    if (!scenes[exit]) {
      const text = JSON.stringify(ids.map((x) => places[x.id]));
      const gains = [...new Set(text.match(/"give(Profile)?":"[^"]+"/g) ?? [])].map(
        (m) => JSON.parse(`{${m}}`) as Step,
      );
      scenes[exit] = [...gains, ...end];
    }
    return [{ investigate: ids.find((x) => x.p === place)?.id ?? ids[0]!.id }];
  };
  return { investigate, places, scenes };
}
