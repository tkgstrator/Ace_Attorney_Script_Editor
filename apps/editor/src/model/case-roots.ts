// 章の置き場所（server/cases-api.ts の roots と同じ名前）。章は「置き場所/ファイル名」で表す。
export const CASE_ROOTS: Record<string, { label: string; dir: string }> = {
  sample: { label: 'サンプル', dir: 'apps/player/cases' },
  official: { label: '公式（変換）', dir: 'assets/extracted/converted' },
};

const split = (name: string) => {
  const i = name.indexOf('/');
  return i < 0 ? { root: '', file: name } : { root: name.slice(0, i), file: name.slice(i + 1) };
};

/** 一覧に出す名前（例: 公式（変換）: ep1.yaml） */
export function caseLabel(name: string): string {
  const { root, file } = split(name);
  return CASE_ROOTS[root] ? `${CASE_ROOTS[root].label}: ${file}` : name;
}

/** リポジトリの中のパス（例: assets/extracted/converted/ep1.yaml） */
export function casePath(name: string): string {
  const { root, file } = split(name);
  return CASE_ROOTS[root] ? `${CASE_ROOTS[root].dir}/${file}` : name;
}
