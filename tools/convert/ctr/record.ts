// 3DS 版（逆転裁判6）の法廷記録。名前・説明は msg_cmn の evidence_*・cast_*、持ち物の増減は _sceNN_preset。
//
// _sceNN_preset は「途中から始めるときの法廷記録」の表で、<E750 話 章 番号> が地点（ファイル c{章}_{番号} と対応。
// 3 61 → c003_0061）、その後ろの <E751 種類 番号> が加える物、<E756 種類 旧 新> が差し替え（種類 0 証拠品・1 人物ファイル）。
// 台本には法廷記録を増やす命令が無いので、地点の後ろに書かれた増減をそのファイルの終わりで行うことにする。
import { join } from 'node:path';
import type { CodeTables } from './code-tables.ts';
import type { Step } from './convert.ts';
import { readGmdText, tokenize } from './gmd.ts';

export type Record = {
  /** 番号 → 証拠品 ID（item0_02_1 など） */
  evidenceIds: (string | null)[];
  /** 番号 → 人物 ID（cast201_1_c → p201） */
  profileIds: (string | null)[];
  evidence: { [id: string]: { name: string; description: string } };
  profiles: { [id: string]: { name: string; age?: number; description: string } };
};

const stripTags = (s: string) =>
  s
    .replace(/<RT>[^<]*<\/RT>/g, '')
    .replace(/<\/?[A-Z]+[^>]*>/g, '')
    .trim();

export function loadRecord(cmn: string, tables: CodeTables): Record {
  const evNames = readGmdText(join(cmn, 'evidence_name_00_jpn.txt'));
  const evCaps = readGmdText(join(cmn, 'evidence_caption_00_jpn.txt'));
  const castNames = readGmdText(join(cmn, 'cast_name_00_jpn.txt'));
  const castCaps = readGmdText(join(cmn, 'cast_caption_00_jpn.txt'));
  const r: Record = { evidenceIds: [], profileIds: [], evidence: {}, profiles: {} };
  // 番号 → ゲーム本体の表の項目 → 名前・説明文の GMD の中の位置。証拠品の ID は説明文のラベル（item0_02_1）
  for (const t of tables.evidence) {
    const cap = t ? evCaps[t.caption] : undefined;
    const m = cap?.label?.match(/^(item\d+_\d+_\d+)_c$/);
    const id = m ? m[1]! : null;
    r.evidenceIds.push(id);
    if (id && t && cap)
      r.evidence[id] ??= { name: evNames[t.name]?.text ?? id, description: cap.text };
  }
  // 人物の ID は説明文のラベル（cast307_1_c、指紋の照合の札は cast308f_0_c）の番号から。版が違っても同じ人
  for (const t of tables.profiles) {
    const cap = t ? castCaps[t.caption] : undefined;
    const m = cap?.label?.match(/^cast(\d+)f?_(\d+)_c$/);
    const id = m ? profileId(m[1]!, m[2]!) : null;
    r.profileIds.push(id);
    if (!id || !t || !cap || r.profiles[id]) continue;
    const raw = castNames[t.name]?.text ?? '';
    const age = raw.match(/\((\d+)\)/);
    r.profiles[id] = {
      name: stripTags(raw.replace(/<SIZE[^>]*>.*?<\/SIZE>/, '').replace(/\s*\([^)]*\)\s*$/, '')),
      ...(age ? { age: Number(age[1]) } : {}),
      description: cap.text,
    };
  }
  return r;
}

/**
 * 人物ファイル（cast 番号）→ 人物 ID。ふつうは名前欄と同じ番号（NAME201 と cast201 → p201）で、
 * 番号のずれる人だけここに書く。cast204 は版によってミミ（0・1）とキキ（2）の別人
 */
const CAST_ALIAS: { [key: string]: string } = {
  cast001: 'p002',
  cast112: 'p100',
  cast204_0: 'p222',
  cast204_1: 'p222',
  cast204_2: 'p204',
};

function profileId(num: string, ver: string): string {
  return CAST_ALIAS[`cast${num}_${ver}`] ?? CAST_ALIAS[`cast${num}`] ?? `p${num}`;
}

/** ファイル（c003_0061 など）→ そのファイルの終わりで行う法廷記録の増減 */
export function loadGains(presetPath: string, r: Record): Map<string, Step[]> {
  const out = new Map<string, Step[]>();
  let cur: Step[] | null = null;
  const id = (kind: number, idx: number) =>
    (kind === 0 ? r.evidenceIds[idx] : r.profileIds[idx]) ?? null;
  const give = (kind: number, x: string) => ({ [kind === 0 ? 'give' : 'giveProfile']: x });
  const take = (kind: number, x: string) => ({ [kind === 0 ? 'take' : 'takeProfile']: x });
  for (const e of readGmdText(presetPath))
    for (const t of tokenize(e.text)) {
      if (t.kind !== 'cmd') continue;
      const a = t.args;
      if (t.name === 'E750') {
        const key = `c${String(a[1]).padStart(3, '0')}_${String(a[2]).padStart(4, '0')}`;
        cur = out.get(key) ?? [];
        out.set(key, cur);
      } else if (t.name === 'E751' && cur) {
        const x = id(a[0]!, a[1]!);
        if (x) cur.push(give(a[0]!, x));
      } else if (t.name === 'E756' && cur) {
        const [from, to] = [id(a[0]!, a[1]!), id(a[0]!, a[2]!)];
        if (from && to && from !== to) cur.push(take(a[0]!, from), give(a[0]!, to));
      }
    }
  return out;
}
