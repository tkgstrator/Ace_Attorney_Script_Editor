// 3DS 版（逆転裁判6）の、正解が台本の外にある遊び。表は tools/rom/mt_xfs.py で JSON にしたものを読む:
//   uv run tools/rom/mt_xfs.py --out assets/extracted-rs/aa6/tables assets/extracted-rs/aa6/romfs/table/*.prp
//   uv run tools/rom/mt_xfs.py --out assets/extracted-rs/aa6/hit $(find assets/extracted-rs/aa6/romfs/hit -name '*.h2d')
//
// 1. 絵の 1 点を指し示す（L_PO_*）: <E306 番号 …> の番号 → APP_PARAM_POINTOUT → hit/N/poNN_*.h2d。
//    h2d は「イベントカット」（APP_PARAM_EVENTCUT の番号 → UI/2_doc/22_evtcut/tex の絵）と当たり 16 個
//    （アタリ領域 [x1, y1, x2, y2]（512×256 のテクスチャの画素。HD の絵でも同じ）、アタリフラグ、条件フラグ）。
//    当たりを選ぶとフラグ（組 = フラグ種類、番号 = アタリフラグ）が立ち、L_PO_CHECK の <E030 組 番号 1 L_MAIN2> で分かれる。
//    第 1 話の 7 か所とも、フラグの番号が L_PO_CHECK の <E030> と一致する
// 2. 証拠品を 3D で調べる（L_INV）: 所は当たり用モデル（evidence3d の *_atari）の部品の番号で、名前は無い。
//    <E026 n> は同じファイルのラベル n を呼び出して戻る命令（L_INV_LOCK・L_INV_BLOODSTAIN など、所の台詞を共有する）。
//    所の名前は、所のブロックかその呼び出し先の最初の台詞から取る（spotLabel）。<E327 2 …> の 2 は APP_PARAM_INV_EVI の番号
// 3. 霊媒ビジョン（L_SPIRIT*）: <E530 回> の回の託宣（spirit_jpn の AST_回_行_版）から、ムジュンする行と感覚を選ぶ。
//    指摘すると書き換わる行には版 1（AST_回_行_1）があるので、それを正解の行とする。書き換わらない回と感覚は
//    台本の後の台詞から決めて ANSWERS に書いた。映像の当たり（movie/hit/sp_*.xfs）はコマの範囲なので使わない
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { flagName, type Step } from './convert.ts';
import { readGmdText } from './gmd.ts';

const ROOT = join(import.meta.dir, '../../..');
const AA6 = join(ROOT, 'assets/extracted-rs/aa6');

const readJson = (path: string): unknown => JSON.parse(readFileSync(path, 'utf8'));

type ParamArray<T> = { mParamArray: { mpArray: T[] } };
type Hit = { アタリ領域: number[]; アタリフラグ: number; 条件フラグ: number };
type H2d = { イベントカット: number; フラグ種類: number; アタリ: Hit[] };

/** テクスチャのパス（UI\2_doc\22_evtcut\tex\event0_02_0_BM_HQ_NOMIP）→ 絵のキー（evtcut_event0_02_0） */
const imageKey = (path: string) =>
  `evtcut_${path
    .split('\\')
    .at(-1)!
    .replace(/(_HD)?_BM.*$/, '')}`;

/**
 * 絵の 1 点を指し示す遊びを pick にする。po は <E306 番号 1 …> の最初の番号（APP_PARAM_POINTOUT の番号）。
 * 当たりを選ぶとフラグを立て、ほかを選ぶと何もせずに次へ進む（続く L_PO_CHECK の <E030> が分ける）。
 * 絵の無いもの（3D の上面図、第 1 話の c006）・表が無いときは null
 */
export function pointOut(po: number): Step | null {
  const table = join(AA6, 'tables/APP_PARAM_POINTOUT.prp.json');
  const cuts = join(AA6, 'tables/APP_PARAM_EVENTCUT.prp.json');
  if (!existsSync(table) || !existsSync(cuts)) return null;
  const path = (readJson(table) as ParamArray<{ path: string }>).mParamArray.mpArray[po]?.path;
  if (!path) return null;
  const hitFile = join(AA6, 'hit', `${path.split('\\').at(-1)}.h2d.json`);
  if (!existsSync(hitFile)) return null;
  const h = readJson(hitFile) as H2d;
  const cut = (readJson(cuts) as ParamArray<{ path: string }>).mParamArray.mpArray[
    h.イベントカット
  ];
  if (!cut?.path) return null;
  const flag = (id: number) => flagName(h.フラグ種類, id);
  const areas = h.アタリ
    .filter((a) => a.アタリフラグ >= 0)
    .map((a) => {
      const [x1, y1, x2, y2] = a.アタリ領域 as [number, number, number, number];
      return {
        area: [x1, y1, x2 - x1, y2 - y1],
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        then: [{ set: { [flag(a.アタリフラグ)]: true } }],
      };
    });
  // 外れ（範囲の外）も選べて、フラグを立てずに次へ進む（元のゲームでは外れの台詞とペナルティ）
  // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
  areas.push({ area: [0, 0, 512, 256], then: [] });
  return { pick: '', images: [imageKey(cut.path)], areas };
}

/** pointOut で立てるフラグ（シナリオの flags に足す） */
export function pointOutFlags(po: number): string[] {
  const p = pointOut(po);
  if (!p) return [];
  const flags = (p.areas as { then: Step[] }[]).flatMap((a) =>
    a.then.flatMap((s) => Object.keys(s.set ?? {})),
  );
  return [...new Set(flags)];
}

/**
 * 3D で調べる所の選択肢の文。entries は台本のファイルの文、label は <E327 2 所 ラベル> のラベルの番号。
 * そのブロックの最初の台詞（（こじあけられてしまった箱のフタか‥‥） → こじあけられてしまった箱のフタか）。
 * 台詞が無ければ、<E026 n>（ラベル n を呼び出して戻る。L_INV_LOCK などの同じ所の台詞を共有する）の先の台詞。
 * どちらも無ければ「調べる所 N」（N は所の番号）
 */
export function spotLabel(entries: { text: string }[], label: number, spot: number): string {
  const firstLine = (text: string) => {
    const first = text.match(/<E795>(.*?)<E796>/s)?.[1] ?? '';
    const line = first.replace(/<[^>]*>/g, '').replace(/[\n\s　]/g, '');
    return line
      .replace(/^（/, '')
      .replace(/[‥。）]+$/, '')
      .slice(0, 16);
  };
  const text = entries[label]?.text ?? '';
  const call = text.match(/<E026 (\d+)>/);
  return (
    firstLine(text) ||
    (call ? firstLine(entries[Number(call[1])]?.text ?? '') : '') ||
    `調べる所 ${spot}`
  );
}

/** 霊媒ビジョンの正解（台本の後の台詞から決めたもの）。キーは「話の番号 - 1:回」 */
const ANSWERS: { [key: string]: { line?: number; sense: string } } = {
  // 「殴られた瞬間に視界が真っ暗に‥‥まちがいありませんか？」、ヒント「《痛い》という感覚がオカシイ」
  '0:1': { line: 2, sense: '痛み' },
  // 「停電した後も儀式の歌は聞こえている！」
  '0:2': { line: 3, sense: '儀式の歌' },
};

/** 霊媒ビジョンで選べる感覚（第 1 話。spirit_jpn の image00_sense の絵の文字と、触覚の「痛み」） */
const SENSES: { [ep: number]: string[] } = { 0: ['儀式の歌', '少年の声', 'お香の匂い', '痛み'] };

/**
 * 霊媒ビジョンを「託宣を選ぶ → 感覚を選ぶ」の選択肢にする。ep は話の番号 - 1（sce00 → 0）、round は <E530 回>。
 * 正解なら main2、託宣の外れは failOracle、感覚の外れは failSense（それぞれ goto などのステップ）。分からなければ null
 */
export function seance(
  ep: number,
  round: number,
  go: { main2: Step[]; failOracle: Step[]; failSense: Step[] },
): Step[] | null {
  const file = join(AA6, `script/arc/archive/spirit_jpn/msg/spirit${ep}0_jpn.txt`);
  const senses = SENSES[ep];
  if (!existsSync(file) || !senses) return null;
  const lines = new Map<number, string>();
  const changed = new Set<number>();
  for (const e of readGmdText(file)) {
    const m = e.label?.match(/^AST_(\d+)_(\d+)_(\d+)$/);
    if (!m || Number(m[1]) !== round) continue;
    if (m[3] === '0') lines.set(Number(m[2]), e.text.replace(/\n/g, ''));
    else changed.add(Number(m[2]));
  }
  const answer = ANSWERS[`${ep}:${round}`];
  const line = answer?.line ?? (changed.size === 1 ? [...changed][0] : undefined);
  if (!answer || line === undefined || !lines.has(line)) return null;
  const pickSense: Step = {
    choice: senses.map((s) => ({
      text: s,
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      then: s === answer.sense ? go.main2 : go.failSense,
    })),
  };
  return [
    {
      choice: [...lines]
        .sort(([a], [b]) => a - b)
        .map(([k, text]) => ({
          text,
          // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
          then: k === line ? [pickSense] : go.failOracle,
        })),
    },
  ];
}
