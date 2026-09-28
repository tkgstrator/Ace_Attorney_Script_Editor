// 話（エピソード）ごとの台本の項目の並び。ROM の ARM9 の「話の選択」で決まる、各話の最初のパートから求めたもの。
//
// 蘇る逆転（AGYJ）: パート = game(0x020ceda8)+0x69、項目 = 2 × パート（日本語）。
//   - 話の選択 0x0204ba24: 選んだ話（+0x23、0〜4）→ パート 0 / 1 / 5 / 0xb / 0x11（mov + strb [game, #0x69] の分岐）。
//   - パートを読むとき 0x0202719c: パートが 1 / 5 / 0xb / 0x11 なら、話の区切り（game+8 = (話 << 24) | 0x0c、
//     クリアデータの保存）へ。ほかのパートは種類の表 0x020aad1c（u8 × 35、3 = 法廷 / 4 = 探偵）の状態へ。
//   - 項目 070 は第 5 話の 3D で調べる台詞、072 は共通の台本（どちらも話のパートではない）。
// 逆転裁判2（A2GJ）: パート = game(0x020abb30)+0x85、項目 = 2 × パート。
//   - 話の選択 0x02048010: 選んだ話（0〜3）→ パート 0 / 2 / 8 / 0xe。項目 044 は共通の台本。
// 逆転裁判3（YG3J）: パート = game(0x020bf394)+0x85、項目 = 2 × T[パート]（T = u32 × 23、0x020a3cc0）。
//   - 話の選択 0x02042374: 選んだ話（0〜4）→ パート 0 / 2 / 7 / 0xc / 0xe
//     → 項目 0 / 6 / 26 / 46 / 54（T = 0, 3, 13, 23, 27）。パートの途中の項目（106 で読み替える）も話に含める。
//     項目 084 は共通の台本。
import type { GameKey } from './tables.ts';

export interface Episode {
  /** 話の番号（1 から） */
  ep: number;
  title: string;
  /** 台本の項目（日本語、偶数）。変換に渡す順 */
  items: number[];
}

interface GameEpisodes {
  /** 各話の最初の項目（日本語） */
  starts: number[];
  /** 最後の話の、最後の項目の次（ここから先はパートでない項目） */
  end: number;
  titles: string[];
}

export const EPISODE_TABLE: Record<GameKey, GameEpisodes> = {
  aa1: {
    starts: [0, 2, 10, 22, 34],
    end: 70,
    titles: [
      'はじめての逆転',
      '逆転姉妹',
      '逆転のトノサマン',
      '逆転、そして、サヨナラ',
      '蘇る逆転',
    ],
  },
  aa2: {
    starts: [0, 4, 16, 28],
    end: 44,
    titles: ['失われた逆転', '再会、そして逆転', '逆転サーカス', 'さらば、逆転'],
  },
  aa3: {
    starts: [0, 6, 26, 46, 54],
    end: 84,
    titles: ['思い出の逆転', '盗まれた逆転', '逆転のレシピ', '始まりの逆転', '華麗なる逆転'],
  },
};

/** そのゲームの全話 */
export function episodes(game: GameKey): Episode[] {
  const { starts, end, titles } = EPISODE_TABLE[game];
  return starts.map((s, i) => {
    const next = starts[i + 1] ?? end;
    const items: number[] = [];
    for (let n = s; n < next; n += 2) items.push(n);
    return { ep: i + 1, title: titles[i]!, items };
  });
}

/** 話の番号から（無ければ undefined） */
export function episode(game: GameKey, ep: number): Episode | undefined {
  return episodes(game).find((e) => e.ep === ep);
}

/** 項目（日本語・英語どちらも）が属する話の番号（話のパートでない項目は undefined） */
export function episodeOfItem(game: GameKey, item: number): number | undefined {
  const n = item & ~1;
  return episodes(game).find((e) => e.items.includes(n))?.ep;
}
