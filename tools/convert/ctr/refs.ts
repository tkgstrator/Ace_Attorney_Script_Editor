// 台本の中でラベルの番号を行き先にする命令（同じファイルの n 番目のラベルへ飛ぶ・呼ぶ・並べる）。
// 出力で goto されなくなったシーンが、元の台本からは参照されていたか（展開されて不要になったか）を調べるのに使う。
import type { Token } from './gmd.ts';

/** 命令が行き先にしているラベルの番号 */
export function jumpTargets(name: string, a: number[]): number[] {
  switch (name) {
    case 'E004': // 飛ぶ
    case 'E026': // 呼ぶ
    case 'E242': // 尋問の最後の証言の後
    case 'E244': // つきつけの正解
    case 'E567': // 映像の指し示しの正解
    case 'E573': // 箱の成功
    case 'E574': // 箱の失敗
      return a.slice(0, 1);
    case 'E030': // フラグなら飛ぶ
      return a.slice(3, 4);
    case 'E222': // 選択肢
    case 'E393': // 探偵パートへ
    case 'E050': // 並べたフラグがそろったら
      return a.slice(1, 2);
    case 'E225': // つきつけの正解の飛び先
    case 'E327': // 3D で調べる所
      return a.slice(2, 3);
    case 'E241': // 証言（証言・ゆさぶり・正解・外れ）
      return a.slice(2, 6);
    case 'E177': // みぬく（開始・成功・やめる・外れ）
      return a.slice(0, 4);
    case 'E249': // 乱数
    case 'E022':
      return a;
    default:
      return [];
  }
}

/** ブロックの並びが行き先にしているラベルの番号の集まり */
export function referencedLabels(blocks: Token[][]): Set<number> {
  const out = new Set<number>();
  for (const b of blocks)
    for (const t of b)
      if (t.kind === 'cmd') for (const n of jumpTargets(t.name, t.args)) out.add(n);
  return out;
}

/** <E033 話 番号 ラベル名> で呼ばれているラベルの名前（`L_` を除いた小文字。シーン ID の後ろの部分） */
export function calledNames(blocks: Token[][]): Set<string> {
  const out = new Set<string>();
  for (const b of blocks)
    for (const t of b)
      if (t.kind === 'cmd' && t.name === 'E033' && t.label)
        out.add(t.label.replace(/^L_/, '').toLowerCase());
  return out;
}

/** 入口のラベルから、飛ぶ・呼ぶ・選ぶ命令だけでたどれるラベルの番号の集まり（入口自身を含む） */
export function reachableFrom(blocks: Token[][], entry: number): Set<number> {
  const seen = new Set<number>();
  const todo = [entry];
  for (let n = todo.pop(); n !== undefined; n = todo.pop()) {
    if (seen.has(n) || !blocks[n]) continue;
    seen.add(n);
    for (const t of blocks[n]!)
      if (t.kind === 'cmd') for (const to of jumpTargets(t.name, t.args)) todo.push(to);
  }
  return seen;
}
