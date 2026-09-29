// 3DS 版（逆転裁判6）の台本 1 ファイル（_sceNN_cXXX_YYYY）を、シーンの集まりにする。
// ラベル 1 つが 1 シーン（入口のラベルはファイル名、ほかは ファイル名_ラベル）。尋問のあるファイルでは、
// 尋問の入口のラベルを証言シーンにし、ゆさぶり・外れ・最後の証言の後など尋問の中から飛ぶラベルはその場に展開する。
import { type Ctx, charId, convertBlock, plain, type Step } from './convert.ts';
import { findExam } from './exam.ts';
import { pointOut, pointOutFlags, seance, spotLabel } from './games.ts';
import { type Entry, type Token, tokenize } from './gmd.ts';

export type Shared = Omit<
  Ctx,
  | 'jump'
  | 'end'
  | 'reveal'
  | 'game'
  | 'choicesAt'
  | 'endInvest'
  | 'callLocal'
  | 'freeRoam'
  | 'pointOut'
  | 'spotName'
  | 'endFlag'
> & {
  /** ファイル → その終わりで行う法廷記録の増減 */
  gains: Map<string, Step[]>;
  /** 話の番号 - 1（sce00 → 0） */
  ep: number;
  /**
   * 探偵パート（物語のファイル file の中の <E393>）の代わりのステップ。place は入る場所（表 12 の番号）、
   * others は行き来できる場所。end は探偵パートを終えた後に行うステップ
   */
  investigate: (
    file: string,
    hub: { chap: number; scene: number },
    end: Step[],
    place: number,
    others: number[],
    endFlags: string[],
  ) => Step[];
};

export type FileResult = {
  scenes: [string, Step[] | Record<string, unknown>][];
  gameover: string | null;
};

/** L_INIT・L_LOAD（読み込み時の準備）は変換しない */
const skipLabel = (l: string | null | undefined) => !l || l === 'L_INIT' || l === 'L_LOAD';

/** ファイルの入口のラベル。飛ばさない最初のラベル（L_INIT・L_LOAD の後の L_MAIN か L_START、または LABEL_0000） */
export function mainLabel(entries: Entry[]): string {
  return entries.find((e) => !skipLabel(e.label))?.label ?? 'L_MAIN';
}

export function sceneId(file: string, label: string, main = 'L_MAIN'): string {
  return label === main ? file : `${file}_${label.replace(/^L_/, '').toLowerCase()}`;
}

function testimonyTitle(blocks: Token[][]): string | null {
  for (const tokens of blocks) {
    const i = tokens.findIndex((t) => t.kind === 'cmd' && t.name === 'E205');
    if (i < 0) continue;
    const end = tokens.findIndex((t, k) => k > i && t.kind === 'cmd' && t.name === 'E206');
    const text = tokens
      .slice(i, end < 0 ? undefined : end)
      .map((t) => (t.kind === 'text' ? t.text : ''))
      .join('');
    return text.trim() || null;
  }
  return null;
}

/** 肢を並べて（<E221> <E222 文 ラベル>…）<E223> を出さずに <E004 n> で飛ぶブロック → n で出す肢 */
function findChoicesAt(blocks: Token[][]): Map<number, { id: number; to: number }[]> {
  const out = new Map<number, { id: number; to: number }[]>();
  for (const tokens of blocks) {
    let list: { id: number; to: number }[] = [];
    for (const t of tokens) {
      if (t.kind !== 'cmd') continue;
      if (t.name === 'E221' || t.name === 'E223') list = [];
      else if (t.name === 'E222') list.push({ id: t.args[0]!, to: t.args[1]! });
      else if (t.name === 'E004' && list.length) {
        out.set(t.args[0]!, list);
        list = [];
      }
    }
  }
  return out;
}

/** ファイルの中で求める法廷記録（<E244 ラベル 種類 番号>・<E225/E226/E255 種類 番号 ラベル>）が増減に含まれるか */
function needsGain(
  blocks: Token[][],
  gains: Step[],
  recordId: (kind: number, idx: number) => string | null,
): boolean {
  const given = new Set(
    gains.flatMap((g) => [g.give, g.giveProfile].filter((x) => typeof x === 'string')),
  );
  for (const tokens of blocks)
    for (const t of tokens) {
      if (t.kind !== 'cmd') continue;
      const [kind, idx] =
        t.name === 'E244' ? [t.args[1], t.args[2]] : /^E22[56]$|^E255$/.test(t.name) ? t.args : [];
      const id = kind === undefined || idx === undefined ? null : recordId(kind, idx);
      if (id && given.has(id)) return true;
    }
  return false;
}

/** 証言のブロックから（話す人の番号, 文） */
function statementLine(tokens: Token[], steps: Step[]): { speaker: number | null; text: string } {
  // 証言は <E260 役 名前>（1 話）か <E041 役 名前>（2 話から）
  const who = tokens.findLast((t) => t.kind === 'cmd' && (t.name === 'E260' || t.name === 'E041'));
  const speech = steps.findLast((s) => {
    const [k, v] = Object.entries(s)[0] ?? [];
    return Object.keys(s).length === 1 && typeof v === 'string' && k !== 'card';
  });
  const text = speech ? String(Object.values(speech)[0]) : '';
  return {
    speaker: who?.kind === 'cmd' ? (who.args[1] ?? null) : null,
    text: text.replace(/\[color green\]/g, ''),
  };
}

export function convertFile(
  entries: Entry[],
  file: string,
  next: string | null,
  shared: Shared,
): FileResult {
  const blocks = entries.map((e) => tokenize(e.text));
  const exam = findExam(blocks);
  const labelOf = (n: number) => entries[n]?.label;
  const entry = mainLabel(entries);
  const idOf = (f: string, label: string) => sceneId(f, label, entry);
  const testimony = exam ? idOf(file, labelOf(exam.start)!) : null;
  const msgs = new Set(exam?.statements.map((s) => s.msg));
  const answers = new Set(exam?.answers.keys());
  const revealFlag = new Map(
    exam?.statements.filter((s) => s.hidden).map((s) => [s.msg, `${file}_open${s.flag}`]),
  );
  for (const f of revealFlag.values()) shared.flags.add(f);
  const choicesAt = findChoicesAt(blocks);
  // 法廷記録の増減はふつうファイルの終わりで行うが、このファイルの中で求める物（尋問の正解・つきつけ）が含まれるなら
  // 始めで行う（c303_0080 の尋問の途中で写真が差し替わる、など）
  const gains = shared.gains.get(file) ?? [];
  const early = needsGain(blocks, gains, shared.recordId);
  const atEnd = early ? [] : gains;
  const inlined = new Set<number>();
  const calling = new Set<number>();
  /** 直前の <E386> で並べた、探偵パートで行き来できる場所（次の <E393> で使い切る） */
  let mapPlaces: number[] = [];
  /** 同じく <E392> で登録した、探偵パートの終わりの条件のフラグ */
  let endFlags: string[] = [];
  const pending: number[] = [];
  const inlinable = (n: number) =>
    !!exam && labelOf(n) !== entry && labelOf(n) !== 'L_GAMEOVER' && !answers.has(n);

  /** stack が null ならシーンとして、配列なら尋問の中で展開中（展開中のラベルの並び） */
  const makeCtx = (stack: number[] | null): Ctx => ({
    ...shared,
    jump: (n) => {
      const label = labelOf(n);
      if (exam?.resume.has(n)) {
        if (!stack) return [{ goto: testimony }];
        // L_EXAM_RESET などは、ゆさぶりを全部終えたかの判定（<E051>… <E050>）を持つことがあるので展開する
        if (n === exam.start || stack.includes(n)) return [];
        return convertBlock(blocks[n]!, makeCtx([...stack, n]), n);
      }
      if (skipLabel(label)) return [{ native: 'E004', args: [n] }];
      if (stack && inlinable(n)) {
        if (stack.includes(n)) return [{ goto: testimony }];
        inlined.add(n);
        return convertBlock(blocks[n]!, makeCtx([...stack, n]), n);
      }
      pending.push(n);
      return [{ goto: idOf(file, label!) }];
    },
    end: () => [...atEnd, next ? { goto: next } : { end: true }],
    reveal: (msg) => revealFlag.get(msg) ?? null,
    game: () => solved('spirit_vision'),
    pointOut: (self) => {
      const po = pointOutIndex(self);
      const pick = po === null ? null : pointOut(po);
      if (pick && po !== null) for (const f of pointOutFlags(po)) shared.flags.add(f);
      return pick;
    },
    spotName: (label, spot) => spotLabel(entries, label, spot),
    choicesAt: (n) => (n === null ? [] : (choicesAt.get(n) ?? [])),
    script: (sce, idx) => [...atEnd, ...shared.script(sce, idx)],
    endInvest: () => [{ native: 'E394', args: [] }],
    freeRoam: (place, n) => {
      const hub = file.match(/^c(\d+)_(\d+)$/);
      if (!hub || !labelOf(n)) return [{ native: 'E393', args: [place, n] }];
      pending.push(n);
      const steps = shared.investigate(
        file,
        { chap: Number(hub[1]), scene: Number(hub[2]) },
        [{ goto: idOf(file, labelOf(n)!) }],
        place,
        mapPlaces,
        endFlags,
      );
      mapPlaces = [];
      endFlags = [];
      return steps;
    },
    mapPlace: (place) => {
      mapPlaces.push(place);
    },
    endFlag: (f) => {
      endFlags.push(f);
    },
    topics: () => [],
    callLocal: (n) => {
      if (calling.has(n) || !blocks[n]) return [];
      calling.add(n);
      const steps = convertBlock(blocks[n], makeCtx(stack), n);
      calling.delete(n);
      return steps;
    },
  });

  // 霊媒ビジョン（映像の場面と感覚を選ぶ）と、絵の中の 1 点を指し示す遊び（<E306>、当たりは hit/ の XFS）は、
  // 正解が台本の外にある。まだ変換しないので、native を残して解けたものとして L_MAIN2 へ進む
  // （2 話からは正解の先が L_PO_OK のこともある）
  const solved = (game: string, to = ['L_MAIN2', 'L_PO_OK']): Step[] => {
    const k = entries.findIndex((e) => to.includes(e.label ?? ''));
    if (k < 0) return [{ native: game, args: [] }];
    pending.push(k);
    return [{ native: game, args: [] }, { goto: idOf(file, labelOf(k)!) }];
  };
  /** L_PO_START(_n) の遊びの番号: 同じ組の L_PO_INIT(_n) の <E306 番号 …> */
  const pointOutIndex = (self: number | null): number | null => {
    const init = labelOf(self ?? -1)?.replace('START', 'INIT');
    const t = blocks[entries.findIndex((e) => e.label === init)]?.find(
      (t) => t.kind === 'cmd' && t.name === 'E306',
    );
    return t?.kind === 'cmd' ? (t.args[0] ?? null) : null;
  };
  /** 霊媒ビジョン（<E530 回> のあるファイル）を託宣と感覚の選択肢にする。正解が分からなければ null */
  const seanceSteps = (): Step[] | null => {
    const round = blocks.flat().find((t) => t.kind === 'cmd' && t.name === 'E530');
    const go = (label: string): Step[] => {
      const k = entries.findIndex((e) => e.label === label);
      if (k < 0) return [];
      pending.push(k);
      return [{ goto: idOf(file, label) }];
    };
    if (round?.kind !== 'cmd') return null;
    return seance(shared.ep, round.args[0]!, {
      main2: go('L_MAIN2'),
      failOracle: go('L_FAIL_ORACLE'),
      failSense: go('L_FAIL_SENSE'),
    });
  };
  const poSuccess = (start: string): string | null => {
    const check = blocks[entries.findIndex((e) => e.label === start.replace('START', 'CHECK'))];
    const t = check?.find((t) => t.kind === 'cmd' && t.name === 'E030');
    return t?.kind === 'cmd' ? (labelOf(t.args[3]!) ?? null) : null;
  };
  const GAMES: { [label: string]: string } = { L_SPIRIT: 'spirit_vision', L_PO_START: 'point_out' };
  // 2 話からの遊びも同じく解けたものとする: みぬく（KS_Pn_START か KS_START、<E521>・<E520> で始め、正解は KS_Pn_OK）、
  // 映像の中を指し示す（L_POM_nn_PLAY、<E567 正解のラベル>、pointoutmovie）
  const LOOPS: [RegExp, string, string][] = [
    [/^KS_(P\d+_)?START$/, 'KS_$1OK', 'perceive'],
    [/^L_POM_(\d+)_PLAY$/, 'L_POM_$1_CORRECT', 'point_out_movie'],
    // 3 話からは番号付きの L_PO_START_0 もある
    [/^L_PO_START_\d+$/, 'L_PO_OK', 'point_out'],
    // 5 話の箱の仕掛け（<E571>、<E573 成功のラベル> <E574 失敗のラベル>）
    [/^L_BOX_PLAY$/, 'L_BOX_SUCCESS', 'puzzle_box'],
    // 5 話の最後のみぬく（<E177 開始 成功 やめる 外れ>）
    [/^L_FORCE_MINUKU_START$/, 'L_FORCE_MINUKU_OK', 'perceive'],
  ];
  const loopGame = (label: string | null | undefined) => {
    for (const [re, to, game] of LOOPS)
      if (label && re.test(label)) return { game, to: label.replace(re, to) };
    return null;
  };

  const scenes = new Map<number, Step[] | Record<string, unknown>>();
  if (exam) {
    const inline = (n: number) => makeCtx([]).jump(n);
    const title = testimonyTitle(blocks);
    let witness: string | null = null;
    const statements = exam.statements.map((s, i) => {
      const { speaker, text } = statementLine(
        blocks[s.msg]!,
        convertBlock(blocks[s.msg]!, makeCtx([s.msg])),
      );
      const who = speaker === null ? undefined : shared.names[speaker];
      if (who && speaker !== null) {
        witness ??= charId(who);
        shared.usedNames.add(speaker);
      }
      const answer = s.correct !== s.wrong ? exam.answers.get(s.correct) : undefined;
      const answerId = answer ? shared.recordId(answer.kind, answer.idx) : null;
      if (answerId) pending.push(s.correct);
      return {
        id: `s${i + 1}`,
        text,
        ...(s.hidden ? { when: revealFlag.get(s.msg) } : {}),
        press: inline(s.press),
        ...(answerId
          ? { present: { [answerId]: [{ goto: idOf(file, labelOf(s.correct)!) }] } }
          : {}),
      };
    });
    scenes.set(exam.start, {
      testimony: title ? plain(title).replace(/^～|～$/g, '') : '証言',
      ...(witness ? { witness } : {}),
      statements,
      ...(exam.follow !== null ? { loop: inline(exam.follow) } : {}),
      wrong: inline(exam.statements[0]!.wrong),
    });
  }
  const main = entries.findIndex((e) => e.label === entry);
  const order = [main, ...[...entries.keys()].filter((k) => k !== main)];
  for (const k of order)
    if (!skipLabel(labelOf(k)) && !msgs.has(k) && !exam?.resume.has(k) && !inlined.has(k))
      pending.push(k);
  while (pending.length) {
    const k = pending.shift()!;
    if (scenes.has(k) || skipLabel(labelOf(k))) continue;
    scenes.set(k, []);
    // 尋問の前の題の行は、証言シーンが題を出すので会話としては出さない
    const t = testimonyTitle(blocks);
    const isTitle = (s: Step) =>
      !!t &&
      s.say === null &&
      typeof s.text === 'string' &&
      plain(s.text).trim() === plain(t).trim();
    // 遊びの入口（ヒント・やり直し・外れとの輪は台本の外の遊びで抜けるので、遊びの代わりを置く）
    const game = GAMES[labelOf(k) ?? ''];
    const loop = loopGame(labelOf(k));
    // 指し示す遊びの成功の先は、L_PO_CHECK(_n) の最初の <E030 … ラベル>（成功でゲームが立てるフラグを見る）
    const isPo = /^L_PO_START(_\d+)?$/.test(labelOf(k) ?? '');
    const po = isPo ? poSuccess(labelOf(k)!) : null;
    // 当たりが読めるものは、そのまま変換して <E307> を pick にする（続く L_PO_CHECK がフラグで分ける）
    const poIdx = isPo ? pointOutIndex(k) : null;
    const seanceK = labelOf(k) === 'L_SPIRIT' ? seanceSteps() : null;
    if (poIdx !== null && pointOut(poIdx))
      scenes.set(k, convertBlock(blocks[k]!, makeCtx(null), k));
    else if (seanceK) scenes.set(k, seanceK);
    else if (po) scenes.set(k, solved('point_out', [po]));
    else if (game) scenes.set(k, solved(game));
    else if (loop) scenes.set(k, solved(loop.game, [loop.to]));
    else
      scenes.set(
        k,
        convertBlock(blocks[k]!, makeCtx(null), k).filter((s) => !isTitle(s)),
      );
  }
  const mainSteps = scenes.get(main);
  if (early && Array.isArray(mainSteps)) scenes.set(main, [...gains, ...mainSteps]);
  const sorted = [...scenes].sort(([a], [b]) => (a === main ? -1 : b === main ? 1 : a - b));
  const gameover = entries.findIndex((e) => e.label === 'L_GAMEOVER');
  return {
    scenes: sorted.map(([k, s]) => [idOf(file, labelOf(k)!), s]),
    gameover: gameover >= 0 && scenes.has(gameover) ? idOf(file, 'L_GAMEOVER') : null,
  };
}
