// 法廷記録の人物ファイル（変換済み YAML の characters.<ID>.profile）から、人物ごと・話ごとの名前と年齢を集める。
// 説明文は公式の文なので扱わない（名前と年齢の数だけを出す）。

import { who } from './charstats.ts';
import { type Episode, GAME_NAME } from './corpus.ts';
import { table } from './stats.ts';

export interface ProfileRow {
  /** '蘇る逆転 第2話' */
  episode: string;
  /** 人物ファイルの名前（年齢の括弧を除いたもの） */
  name: string;
  /** 年齢。人物ファイルに無ければ undefined */
  age?: number;
}

/** 人物 ID（ALIAS でまとめたもの）→ 話ごとの人物ファイル。同じ話で名前と年齢が同じものは 1 つにする */
export function collectProfiles(eps: Episode[]): Map<string, ProfileRow[]> {
  const out = new Map<string, ProfileRow[]>();
  for (const e of eps) {
    const episode = `${GAME_NAME[e.game]} 第${e.ep}話`;
    for (const [id, ch] of Object.entries<{ profile?: { name?: string; age?: number } }>(
      e.data.characters ?? {},
    )) {
      const p = ch?.profile;
      if (!p?.name) continue;
      const rows = out.get(who(id)) ?? [];
      const row: ProfileRow = { episode, name: p.name, age: p.age };
      if (!rows.some((r) => r.episode === episode && r.name === row.name && r.age === row.age))
        rows.push(row);
      out.set(who(id), rows);
    }
  }
  return out;
}

/** 自動の部分に入れる「人物ファイルの年齢」の節 */
export function renderProfiles(rows: ProfileRow[] | undefined): string {
  const out = ['### 人物ファイルの年齢\n'];
  if (!rows?.length) {
    out.push('- 法廷記録の人物ファイルなし（年齢の公式の値は無い）');
    return out.join('\n');
  }
  out.push('法廷記録の人物ファイルにある名前と年齢（話ごと）。年齢の無いものは「なし」。\n');
  out.push(
    table(
      ['話', '人物ファイルの名前', '年齢'],
      rows.map((r) => [r.episode, r.name, r.age ?? 'なし']),
    ),
  );
  return out.join('\n');
}
