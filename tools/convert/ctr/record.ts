// 3DS 版（逆転裁判6）の法廷記録。名前・説明は msg_cmn の evidence_*・cast_*、持ち物の増減は _sceNN_preset。
//
// _sceNN_preset は「途中から始めるときの法廷記録」の表で、<E750 0 章 番号> が地点（ファイル c{章}_{番号} と対応。
// 3 61 → c003_0061）、その後ろの <E751 種類 番号> が加える物、<E756 種類 旧 新> が差し替え（種類 0 証拠品・1 人物ファイル）。
// 台本には法廷記録を増やす命令が無いので、地点の後ろに書かれた増減をそのファイルの終わりで行うことにする。
import { join } from 'node:path';
import type { Step } from './convert.ts';
import { labelMap, readGmdText, tokenize } from './gmd.ts';

export type Record = {
  /** 番号 → 証拠品 ID（item0_02_1 など） */
  evidenceIds: (string | null)[];
  /** 番号 → 人物 ID（cast201_0_n → p201） */
  profileIds: (string | null)[];
  evidence: { [id: string]: { name: string; description: string } };
  profiles: { [id: string]: { name: string; age?: number; description: string } };
};

const stripTags = (s: string) =>
  s
    .replace(/<RT>[^<]*<\/RT>/g, '')
    .replace(/<\/?[A-Z]+[^>]*>/g, '')
    .trim();

export function loadRecord(cmn: string): Record {
  const names = readGmdText(join(cmn, 'evidence_name_00_jpn.txt'));
  const captions = labelMap(readGmdText(join(cmn, 'evidence_caption_00_jpn.txt')));
  const castNames = readGmdText(join(cmn, 'cast_name_00_jpn.txt'));
  const castCaptions = labelMap(readGmdText(join(cmn, 'cast_caption_00_jpn.txt')));
  const r: Record = { evidenceIds: [], profileIds: [], evidence: {}, profiles: {} };
  for (const e of names) {
    const id = e.label && e.label !== 'null' ? e.label.replace(/_n$/, '') : null;
    r.evidenceIds.push(id);
    if (id) r.evidence[id] = { name: e.text, description: captions.get(`${id}_c`) ?? '' };
  }
  for (const e of castNames) {
    const m = e.label?.match(/^cast(\d+)_(\d+)_n$/);
    const id = m ? `p${m[1]}` : null;
    r.profileIds.push(id);
    if (!id || r.profiles[id]) continue;
    const age = e.text.match(/\((\d+)\)/);
    r.profiles[id] = {
      name: stripTags(e.text.replace(/<SIZE[^>]*>.*?<\/SIZE>/, '')),
      ...(age ? { age: Number(age[1]) } : {}),
      description: castCaptions.get(e.label!.replace(/_n$/, '_c')) ?? '',
    };
  }
  return r;
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
      if (t.name === 'E750' && a[0] === 0) {
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
