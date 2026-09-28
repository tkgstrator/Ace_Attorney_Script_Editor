// ROM から取り出した素材（手元用・配布しない）のゲームごとの置き場所と、ゲームで違う番号。
//   aa1 = 逆転裁判 蘇る逆転（assets/extracted/）、aa2 = 逆転裁判2（assets/extracted/aa2/）、aa3 = 逆転裁判3（assets/extracted/aa3/）
// 2・3 の取り出し方は tools/rom/game_assets.py・tools/rom/extract_assets.py を参照（中の並び方は蘇る逆転と同じ）。

export type OfficialGame = 'aa1' | 'aa2' | 'aa3';

/** import.meta.glob の鍵の頭（ゲームの取り出し先） */
export const GAME_ROOT: Record<OfficialGame, string> = {
  aa1: '../../../assets/extracted',
  aa2: '../../../assets/extracted/aa2',
  aa3: '../../../assets/extracted/aa3',
};

/**
 * 法廷の立ち位置 → 背景の番号（台本の 27 の番号）。2・3 は蘇る逆転から 1 ずつずれ、裁判長は 7、8 は助手の席。
 * 机（OBJ）は弁護側・検察側・証言台に付く（tools/rom/ex_desks.py）
 */
export const COURT_BACKGROUNDS: Record<OfficialGame, Record<string, number>> = {
  aa1: { defense: 3, prosecution: 4, witness: 5, judge: 8 },
  aa2: { defense: 4, prosecution: 5, witness: 6, judge: 7, counsel: 8 },
  aa3: { defense: 4, prosecution: 5, witness: 6, judge: 7, counsel: 8 },
};

/** glob の鍵がそのゲームの取り出し先の中か（aa1 の頭は aa2・aa3 の頭も含むので、そこは除く） */
export function inGame(game: OfficialGame, key: string): boolean {
  if (!key.startsWith(`${GAME_ROOT[game]}/`)) return false;
  return game !== 'aa1' || !/\/extracted\/aa[23]\//.test(key);
}

/** 章の置き場所の名前（エディターの official2 など）や章の ID（aa2-ep1 など）からゲームを決める */
export function gameOf(name: string | null | undefined): OfficialGame {
  if (!name) return 'aa1';
  if (/^(official2\/|aa2-)/.test(name)) return 'aa2';
  if (/^(official3\/|aa3-)/.test(name)) return 'aa3';
  return 'aa1';
}
