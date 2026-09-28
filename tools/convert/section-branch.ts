// 流れを分ける命令（ラベルへの移動・選択肢・写真の一点を指す・下画面の遊び・つきつけの要求）のステップ。section.ts から使う。
import type { Context } from './context.ts';
import { nominationResults, orphanSections } from './flow.ts';
import { native } from './mapping.ts';
import { convertOps } from './section.ts';
import type { CmdOp, Step } from './types.ts';

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
export function pointChoice(
  ctx: Context,
  section: number,
  k: number | null,
  gotoSteps: (t: number) => Step[],
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
  return { choice: opts };
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
        gotoSteps: (t) => (t === section ? [] : gotoSteps(t)),
      })
    : [];
  ctx.consumed.add(req.wrong);
  return [{ demand: prompt, ...(by ? { by } : {}), present, wrong }];
}
