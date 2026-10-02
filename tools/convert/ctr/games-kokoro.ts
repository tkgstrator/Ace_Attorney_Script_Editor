// 3DS 版（逆転裁判6）の「みぬく」（こころスコープ。ラベル KS_*）。証人の証言（kokoro_XXYY の文）に出ている感情のうち、
// 証言とムジュンするものを指摘する。感情の位置と種類は kokoro_image*_GS6.gui のアニメーションに埋まっていて読めていない。
// ただ、指摘した後の台詞に「どの行のどの感情か」が書かれているので、その行を正解として「証言の行を選ぶ」選択肢にする
// （感情の種類は選ばせない）。kokoro_XXYY の XX は話の番号 - 1、YY は連番。文は TEXT_{部}_{行}（部が <E519 部> と対応）。
//
// 第 2 話 c102_0040 の KS_P0 は成功後の台詞が確かめられた（「反省してるなんて言ってますが、喜びの感情がわずかに出ています」）。
// 第 4 話は KS_OK が空で、後のファイルの台詞から行を決めた（確度は根拠の欄）。KS_P1 は通常の尋問なのでここでは扱わない
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Step } from './convert.ts';
import { readGmdText } from './gmd.ts';

const ROOT = join(import.meta.dir, '../../..');
const ARCHIVE = join(ROOT, 'assets/extracted-rs/aa6/script/arc/archive');

type Answer = { msg: string; part: number; line: number };

/** キーは「話の番号 - 1/ファイル」。根拠は後続の台詞 */
const ANSWERS: { [key: string]: Answer } = {
  // 確か: 「反省してます。」に喜びの感情
  '1/c102_0040': { msg: 'kokoro_0100', part: 0, line: 5 },
  // 「美風さん、机につっぷして」（c004_0020）= 「楽屋に入ったら、机に突っ伏して‥‥」
  '3/c004_0010': { msg: 'kokoro_0300', part: 0, line: 3 },
  // 「楽屋に入る時に、怒りの感情」「部屋に入る時に足の小指をぶつけた」（c004_0040）= 「障子をあけた時は」
  '3/c004_0030': { msg: 'kokoro_0300', part: 1, line: 3 },
  // 「師匠の死に気付いた後に、もう一度驚いています」（c004_0080）= 気付いた行（5）の次
  '3/c004_0070': { msg: 'kokoro_0300', part: 2, line: 6 },
  // 「暴走の原因はダイイングメッセージ」（c004_0100）= 「散らかった机の上で‥‥」。行は推測
  '3/c004_0090': { msg: 'kokoro_0300', part: 3, line: 6 },
  // 「師匠の顔に、ポタポタと血が滴って」（c005_0060）。行は推測
  '3/c005_0050': { msg: 'kokoro_0301', part: 0, line: 1 },
  // 「真犯人の凶行を目にしながらも安堵」「あなたはダレを見たの？」（c005_0140）。行は推測（5 は「殺した人が立っていた」）
  '3/c005_0130': { msg: 'kokoro_0301', part: 2, line: 5 },
};

const clean = (s: string) => s.replace(/<[^>]*>/g, '').replace(/[\s　]+/g, '');

/**
 * みぬくを「証言の行を選ぶ」選択肢にする。sce は話の番号 - 1、file は台本のファイル（c102_0040 など。_sceNN_ は付けない）。
 * 正解の行は ok、ほかの行は ng（goto などのステップ。ng は KS_NG に行き、KS_START に戻る）。
 * 正解が分からないファイル・文が読めないときは null（呼ぶ側は今までどおり「解けたもの」にする）
 */
export function perceive(sce: number, file: string, go: { ok: Step[]; ng: Step[] }): Step | null {
  const a = ANSWERS[`${sce}/${file}`];
  const path = a && join(ARCHIVE, `${a.msg}_jpn/msg/${a.msg}_jpn.txt`);
  if (!a || !path || !existsSync(path)) return null;
  const lines: [number, string][] = [];
  for (const e of readGmdText(path)) {
    const m = e.label?.match(/^TEXT_(\d+)_(\d+)$/);
    if (m && Number(m[1]) === a.part && clean(e.text)) lines.push([Number(m[2]), clean(e.text)]);
  }
  if (!lines.some(([n]) => n === a.line)) return null;
  return {
    choice: lines.map(([n, text]) => ({
      text: `「${text}」の感情`,
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      then: n === a.line ? go.ok : go.ng,
    })),
  };
}
