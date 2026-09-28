// 流れを分ける命令（ラベルへの移動・選択肢・写真の一点を指す・下画面の遊び・つきつけの要求）のステップ。section.ts から使う。
import type { Context } from './context.ts';
import { nominationResults, orphanSections } from './flow.ts';
import { native } from './mapping.ts';
import type { Memory } from './ops.ts';
import { answerFlag, answerSets, lockAnswers } from './ops23.ts';
import { convertOps } from './section.ts';
import type { CmdOp, Op, Step } from './types.ts';

/** ラベルへの移動。区画の途中のラベルは「区画_位置」のシーン */
export function labelGoto(ctx: Context, o: CmdOp, gotoSteps: (t: number) => Step[]): Step[] {
  const t = o.target;
  if (!t || t.section === null) return [native(o.name, o.args)];
  if (t.offset <= 2) return gotoSteps(t.section);
  ctx.referenced.add(t.section);
  ctx.pieces.add(`${t.section}:${t.offset}`);
  return [{ goto: ctx.sid(t.section, t.offset) }];
}

/**
 * DS 版の下画面の遊び（116 8 / 9 / 10）の結果を、続く「どこからも行き先にならない区画」から選ぶ選択肢にする（近似）。
 * 選択肢の文はその区画の最初の文。作れたら true
 */
export function minigameChoice(
  ctx: Context,
  section: number,
  kind: number,
  gotoSteps: (t: number) => Step[],
  out: Step[],
): boolean {
  const orphans = orphanSections(ctx.entry, ctx.tableRefs());
  const picks: number[] = [];
  // 人物の指名: 次の区画が外れ（ペナルティ）、外れから落ちていく区画の次が正解（flow.ts の nominationResults）。
  // 探偵パート（056 §40）も同じ。続く区画から選ぶと、話題の区画（§44）まで結果にしてしまい、話題の切り替えが狂って詰む
  if (kind === 10) picks.push(...nominationResults(ctx.entry, section));
  else {
    // 続く区画のうち、どこからも来ない区画（遊びの結果）。表の行き先や、次の遊びの区画まで（間の区画は飛ばす）
    const refs = ctx.tableRefs(true);
    // 次の遊びの始まり: 21 / 121 で待つ直前の 116 が 8 / 9 / 10（結果の区画の中の 116 8 n → 116 5 → 21 は含めない）
    const game = (s: number) => {
      const ops = ctx.entry.body[s]!.ops.filter((o): o is CmdOp => o.op !== 'text');
      const w = ops.findIndex((o) => o.op === 21 || o.op === 121);
      const last = ops.slice(0, w < 0 ? ops.length : w).findLast((o) => o.op === 116);
      return !!last && [8, 9, 10].includes(last.args[0]!);
    };
    for (let s = section + 1; ctx.entry.body[s] && picks.length < 8 && s <= section + 12; s++) {
      if (game(s)) break;
      // 表の行き先（つきつけの要求・尋問など）に着いたら、それも結果の 1 つにして終わる（映像の遊びの正解が尋問へ続くときなど）
      if (refs.has(s)) {
        picks.push(s);
        break;
      }
      if (orphans.has(s)) picks.push(s);
    }
  }
  if (!picks.length) return false;
  ctx.stats.gap(
    kind === 10
      ? '人物の指名（116 10、第 5 話）を選択肢にした'
      : kind === 9
        ? '指紋などの遊び（116 9、第 5 話）の結果を選択肢にした'
        : '下画面の遊び（116 8、映像・字を書くなど）の結果を選択肢にした',
    section,
  );
  const label = (s: number) => {
    const t = ctx.entry.body[s]!.ops.find((o) => o.op === 'text');
    return `（${t && t.op === 'text' ? t.text.slice(0, 14) : `結果 ${s}`}）`;
  };
  // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
  out.push({ choice: picks.map((s) => ({ text: label(s), then: gotoSteps(s) })) });
  return true;
}

/** 四角形の位置の言い方（画面の左上など） */
export function whereOf(quad: number[][]): string {
  const cx = quad.reduce((a, p) => a + p[0]!, 0) / quad.length,
    cy = quad.reduce((a, p) => a + p[1]!, 0) / quad.length;
  const h = cx < 86 ? '左' : cx < 171 ? '中央' : '右';
  const v = cy < 64 ? '上' : cy < 128 ? '' : '下';
  return h === '中央' && !v ? 'まん中' : `${h}${v}`;
}

/** 63 写真の一点を指す: 正解の 2 つの四角形と外れを、選択肢にする */
/** 区画の中の 62 の問題の番号（重なりなし） */
export function pointKs(ctx: Context, section: number): number[] {
  const ops = ctx.entry.body[section]?.ops ?? [];
  return [...new Set(ops.flatMap((o) => (o.op !== 'text' && o.op === 62 ? [o.args[0]!] : [])))];
}

/** どの問題（62）かのフラグ */
export const pointFlag = (ctx: Context): string => ctx.flag(`${ctx.gpfx}point`, -1);

export function pointChoice(
  ctx: Context,
  section: number,
  k: number | null,
  gotoSteps: (t: number) => Step[],
  lock = false,
): Step {
  const p = ctx.t.courtPoints?.find((x) => x.id === k);
  ctx.stats.gap('写真の一点を指す（62/63）を選択肢にした', section);
  if (!p) return { native: 'examine_wait', args: [k ?? -1] };
  const opts: { text: string; then: Step[] }[] = [];
  if (p.section_a.section !== p.miss.section)
    // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
    opts.push({ text: `${whereOf(p.quad_a)}を指す`, then: gotoSteps(p.section_a.section) });
  if (p.section_b.section !== p.miss.section && p.section_b.section !== p.section_a.section) {
    // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
    opts.push({ text: `${whereOf(p.quad_b)}を指す`, then: gotoSteps(p.section_b.section) });
  }
  // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
  opts.push({ text: 'ほかの所を指す', then: gotoSteps(p.miss.section) });
  // サイコ・ロックの挑戦中は「やめる」もある（quit のシーンへ）
  // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
  if (lock) opts.push({ text: 'やめる', then: [{ quitLock: true }] });
  return { choice: opts };
}

/**
 * 63（写真の一点を指す）のステップ。2・3 の探偵パートで減る量を予告した（84 2）区画ならサイコ・ロックの挑戦中
 * （「やめる」を出す）。問題（62）がフラグで分かれるなら、覚えた番号（pointFlag）で分ける
 */
export function pointSteps(
  ctx: Context,
  section: number,
  ops: Op[],
  point: number | null,
  gotoSteps: (t: number) => Step[],
): Step[] {
  const body = ctx.entry.body[section]?.ops ?? ops;
  const lock =
    ctx.t.game !== 'aa1' &&
    !!ctx.inv &&
    body.some((x) => x.op !== 'text' && x.op === 84 && x.args[0] === 2);
  const ks = ctx.t.game === 'aa1' ? [] : pointKs(ctx, section);
  if (ks.length < 2) return [pointChoice(ctx, section, point, gotoSteps, lock)];
  return ks.reduceRight<Step[]>(
    (rest, k, j) =>
      j === ks.length - 1
        ? [pointChoice(ctx, section, k, gotoSteps, lock)]
        : [
            {
              if: `${pointFlag(ctx)} == ${k}`,
              // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
              then: [pointChoice(ctx, section, k, gotoSteps, lock)],
              else: rest,
            },
          ],
    [],
  );
}

/** 8 / 9 選択肢。文は下画面のボタンの絵を文字認識したもの（script_json.py --ocr） */
export function choiceStep(
  ctx: Context,
  section: number,
  o: CmdOp,
  gotoSteps: (t: number) => Step[],
): Step {
  const texts = ctx.entry.choices?.[String(section)]?.text ?? [];
  if (texts.length === 0) ctx.stats.gap('選択肢の文が無い（script_json.py --ocr で読む）', section);
  const targets = (o.targets ?? []).map((t, k) => t?.section ?? o.args[k]! - 128);
  return {
    // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
    choice: targets.map((t, k) => ({ text: texts[k] ?? `選択肢 ${k + 1}`, then: gotoSteps(t) })),
  };
}

/**
 * サイコ・ロックの挑戦中のつきつけ（82 の後の 21）。正解は 96 / 97、外れは 96 の外れの区画。「やめる」を出す
 */
export function lockDemand(
  ctx: Context,
  section: number,
  say: { text: string; speaker: string | null } | null,
  mem: Memory,
  gotoSteps: (t: number) => Step[],
): Step {
  const key = (item: number) =>
    ctx.shared.profileRecords.has(item) ? ctx.profile(item) : ctx.evidenceId(item);
  // 正解の番号は、証拠品と人物ファイルで共通の法廷記録の番号（選んだ項目の番号と比べるだけ。YG3J 0x0208a198）。
  // 章の中で法廷記録に入らない番号（台本が「どれも外れ」の印に使う 0 など）は、どう選んでも当たらないので書かない
  const recs = ctx.shared.chapterRecords;
  const reachable = (item: number) => recs.size === 0 || recs.has(item);
  const head = {
    demand: say ? say.text.replace(/(\[color white\])+$/, '') : '',
    ...(say?.speaker ? { by: say.speaker } : {}),
  };
  // 正解を決める区画が複数あるなら、どれを通ったか（answerFlag）で分ける
  const sets = answerSets(ctx, section);
  if (sets.length) {
    const flag = answerFlag(ctx);
    const pick = (f: (a: (typeof sets)[number]['ans']) => number): Step[] =>
      new Set(sets.map((x) => f(x.ans))).size === 1
        ? gotoSteps(f(sets[0]!.ans))
        : sets.reduceRight<Step[]>(
            (rest, x, i) =>
              i === sets.length - 1
                ? gotoSteps(f(x.ans))
                : // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
                  [{ if: `${flag} == ${x.section}`, then: gotoSteps(f(x.ans)), else: rest }],
            [],
          );
    const present: Record<string, Step[]> = {};
    for (const item of new Set(sets.flatMap((x) => x.ans.list.map((c) => c.item))))
      if (reachable(item))
        present[key(item)] = pick((a) => a.list.find((c) => c.item === item)?.goto ?? a.wrong);
    return { ...head, present, wrong: pick((a) => a.wrong), giveUp: true };
  }
  const ans = lockAnswers(ctx, section, mem);
  if (!ans) ctx.stats.gap('サイコ・ロックのつきつけの正解（96）が見つからない', section);
  const present: Record<string, Step[]> = {};
  for (const c of ans?.list ?? []) if (reachable(c.item)) present[key(c.item)] = gotoSteps(c.goto);
  return { ...head, present, wrong: ans ? gotoSteps(ans.wrong) : [], giveUp: true };
}

/**
 * 17 / 33 つきつけの要求。正解の表と外れの区画は court.json の present_requests。
 * 外れの区画は、最後に同じ要求へ戻るなら demand の wrong（もう一度求める）、別の所へ行くならその goto を付ける
 */
export function demandSteps(
  ctx: Context,
  section: number,
  prompt: string,
  by: string | null,
  gotoSteps: (t: number) => Step[],
  life: boolean,
  resumeTo?: (t: number) => Step[],
): Step[] {
  const req = ctx.court?.present_requests.find((r) => r.section === section);
  if (!req) {
    ctx.stats.gap('つきつけの要求の表が無い', section);
    return [native(life ? 'present_life' : 'present', [])];
  }
  if (!life) ctx.stats.gap('体力ゲージを出さないつきつけ（17 present）', section);
  const present: Record<string, Step[]> = {};
  for (const c of req.correct) {
    if (c.flag !== null) ctx.stats.gap('フラグつきの正解（つきつけの表）', section);
    // 人物ファイルが正解なら人物 ID をキーにする（YAML では、それで人物ファイルもつきつけられる要求になる）
    present[ctx.shared.profileRecords.has(c.item) ? ctx.profile(c.item) : ctx.evidenceId(c.item)] =
      gotoSteps(c.goto);
  }
  const wrongSec = ctx.entry.body[req.wrong];
  const wrong = wrongSec
    ? convertOps(ctx, req.wrong, wrongSec.ops, {
        // 外れの後に尋問の文へ戻るなら（証言の中のブロックでは移動が空になる）、その文へ resume する
        // （空のままだと、もう一度同じ要求になる。逆転裁判2 の正解の無い要求など）
        gotoSteps: (t) => {
          if (t === section) return [];
          const go = gotoSteps(t);
          return go.length === 0 && resumeTo ? resumeTo(t) : go;
        },
      })
    : [];
  ctx.consumed.add(req.wrong);
  return [{ demand: prompt, ...(by ? { by } : {}), present, wrong }];
}
