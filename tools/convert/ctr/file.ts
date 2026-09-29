// 3DS 版（逆転裁判6）の台本 1 ファイル（_sceNN_cXXX_YYYY）を、シーンの集まりにする。
// ラベル 1 つが 1 シーン（L_MAIN はファイル名、ほかは ファイル名_ラベル）。尋問のあるファイルでは、
// 尋問の入口のラベルを証言シーンにし、ゆさぶり・外れ・最後の証言の後など尋問の中から飛ぶラベルはその場に展開する。
import { type Ctx, charId, convertBlock, plain, type Step } from './convert.ts';
import { findExam } from './exam.ts';
import { type Entry, type Token, tokenize } from './gmd.ts';

export type Shared = Omit<Ctx, 'jump' | 'end' | 'reveal'> & {
  /** ファイル → その終わりで行う法廷記録の増減 */
  gains: Map<string, Step[]>;
};

export type FileResult = {
  scenes: [string, Step[] | Record<string, unknown>][];
  gameover: string | null;
};

/** L_INIT・L_LOAD（読み込み時の準備）は変換しない */
const skipLabel = (l: string | null | undefined) => !l || l === 'L_INIT' || l === 'L_LOAD';

export function sceneId(file: string, label: string): string {
  return label === 'L_MAIN' ? file : `${file}_${label.replace(/^L_/, '').toLowerCase()}`;
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

/** 証言のブロックから（話す人の番号, 文） */
function statementLine(tokens: Token[], steps: Step[]): { speaker: number | null; text: string } {
  const who = tokens.find((t) => t.kind === 'cmd' && t.name === 'E260');
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
  const testimony = exam ? sceneId(file, labelOf(exam.start)!) : null;
  const msgs = new Set(exam?.statements.map((s) => s.msg));
  const answers = new Set(exam?.answers.keys());
  const revealFlag = new Map(
    exam?.statements.filter((s) => s.hidden).map((s) => [s.msg, `${file}_open${s.flag}`]),
  );
  for (const f of revealFlag.values()) shared.flags.add(f);
  const inlined = new Set<number>();
  const pending: number[] = [];
  const inlinable = (n: number) =>
    !!exam && labelOf(n) !== 'L_MAIN' && labelOf(n) !== 'L_GAMEOVER' && !answers.has(n);

  /** stack が null ならシーンとして、配列なら尋問の中で展開中（展開中のラベルの並び） */
  const makeCtx = (stack: number[] | null): Ctx => ({
    ...shared,
    jump: (n) => {
      const label = labelOf(n);
      if (exam?.resume.has(n)) return stack ? [] : [{ goto: testimony }];
      if (skipLabel(label)) return [{ native: 'E004', args: [n] }];
      if (stack && inlinable(n)) {
        if (stack.includes(n)) return [{ goto: testimony }];
        inlined.add(n);
        return convertBlock(blocks[n]!, makeCtx([...stack, n]), n);
      }
      pending.push(n);
      return [{ goto: sceneId(file, label!) }];
    },
    end: () => [...(shared.gains.get(file) ?? []), next ? { goto: next } : { end: true }],
    reveal: (msg) => revealFlag.get(msg) ?? null,
    game: () => solved('spirit_vision'),
  });

  // 霊媒ビジョン（映像の場面と感覚を選ぶ）と、絵の中の 1 点を指し示す遊び（<E306>、当たりは hit/ の XFS）は、
  // 正解が台本の外にある。まだ変換しないので、native を残して解けたものとして L_MAIN2 へ進む
  const solved = (game: string): Step[] => {
    const main2 = entries.findIndex((e) => e.label === 'L_MAIN2');
    if (main2 < 0) return [{ native: game, args: [] }];
    pending.push(main2);
    return [{ native: game, args: [] }, { goto: sceneId(file, 'L_MAIN2') }];
  };
  const GAMES: { [label: string]: string } = { L_SPIRIT: 'spirit_vision', L_PO_START: 'point_out' };

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
          ? { present: { [answerId]: [{ goto: sceneId(file, labelOf(s.correct)!) }] } }
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
  const main = entries.findIndex((e) => e.label === 'L_MAIN');
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
    if (game) scenes.set(k, solved(game));
    else
      scenes.set(
        k,
        convertBlock(blocks[k]!, makeCtx(null), k).filter((s) => !isTitle(s)),
      );
  }
  const sorted = [...scenes].sort(([a], [b]) => (a === main ? -1 : b === main ? 1 : a - b));
  const gameover = entries.findIndex((e) => e.label === 'L_GAMEOVER');
  return {
    scenes: sorted.map(([k, s]) => [sceneId(file, labelOf(k)!), s]),
    gameover: gameover >= 0 && scenes.has(gameover) ? sceneId(file, 'L_GAMEOVER') : null,
  };
}
