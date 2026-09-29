// 逆転裁判6 の台本 1 ファイルを変換するときの、ラベル・選択肢・証言の補助関数。
import type { Step } from './convert.ts';
import type { Entry, Token } from './gmd.ts';

/** L_INIT・L_LOAD（と L_LOAD_nn。読み込み時の準備）は変換しない */
export const skipLabel = (l: string | null | undefined) => !l || /^L_(INIT|LOAD)(_\d+)?$/.test(l);

/** ファイルの入口のラベル。飛ばさない最初のラベル */
export function mainLabel(entries: Entry[]): string {
  return entries.find((e) => !skipLabel(e.label))?.label ?? 'L_MAIN';
}

export function sceneId(file: string, label: string, main = 'L_MAIN'): string {
  return label === main ? file : `${file}_${label.replace(/^L_/, '').toLowerCase()}`;
}

export function testimonyTitle(blocks: Token[][]): string | null {
  for (const tokens of blocks) {
    const i = tokens.findIndex((t) => t.kind === 'cmd' && t.name === 'E205');
    if (i < 0) continue;
    const end = tokens.findIndex((t, k) => k > i && t.kind === 'cmd' && t.name === 'E206');
    const text = tokens
      .slice(i, end < 0 ? undefined : end)
      .map((t) => (t.kind === 'text' ? t.text : ''))
      .join('');
    return text.trim() || null;
  }
  return null;
}

/** 肢を並べて <E223> を出さずに <E004 n> で飛ぶブロック → n で出す肢 */
export function findChoicesAt(blocks: Token[][]): Map<number, { id: number; to: number }[]> {
  const out = new Map<number, { id: number; to: number }[]>();
  for (const tokens of blocks) {
    let list: { id: number; to: number }[] = [];
    for (const t of tokens) {
      if (t.kind !== 'cmd') continue;
      if (t.name === 'E221' || t.name === 'E223') list = [];
      else if (t.name === 'E222') list.push({ id: t.args[0]!, to: t.args[1]! });
      else if (t.name === 'E004' && list.length) {
        out.set(t.args[0]!, list);
        list = [];
      }
    }
  }
  return out;
}

/** ファイルの中で求める法廷記録が増減に含まれるか */
export function needsGain(
  blocks: Token[][],
  gains: Step[],
  recordId: (kind: number, idx: number) => string | null,
): boolean {
  const given = new Set(
    gains.flatMap((g) => [g.give, g.giveProfile].filter((x) => typeof x === 'string')),
  );
  for (const tokens of blocks)
    for (const t of tokens) {
      if (t.kind !== 'cmd') continue;
      const [kind, idx] =
        t.name === 'E244' ? [t.args[1], t.args[2]] : /^E22[56]$|^E255$/.test(t.name) ? t.args : [];
      const id = kind === undefined || idx === undefined ? null : recordId(kind, idx);
      if (id && given.has(id)) return true;
    }
  return false;
}

/** 証言のブロックから（話す人の番号, 文） */
export function statementLine(
  tokens: Token[],
  steps: Step[],
): { speaker: number | null; text: string } {
  const who = tokens.findLast((t) => t.kind === 'cmd' && (t.name === 'E260' || t.name === 'E041'));
  const speech = steps.findLast((s) => {
    const [k, v] = Object.entries(s)[0] ?? [];
    return Object.keys(s).length === 1 && typeof v === 'string' && k !== 'card';
  });
  const text = speech ? String(Object.values(speech)[0]) : '';
  return {
    speaker: who?.kind === 'cmd' ? (who.args[1] ?? null) : null,
    text: text.replace(/\[color green\]/g, ''),
  };
}
