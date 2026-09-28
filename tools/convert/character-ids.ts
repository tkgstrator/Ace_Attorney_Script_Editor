// 人物 ID の対応表（character-ids.json）: ゲーム × ROM の番号 → 人が読める人物 ID。
//
// ROM の中の番号（名前の番号・人物の番号・法廷記録の番号）はゲームや ROM の版で変わるので、ID には使わない。
// 同じ人物は 1・2・3 で同じ ID にし（phoenix、edgeworth、maya）、絵や音の違う版は意味のある接尾辞を付ける
// （mia_channeled など。意味の分からない版は 名前_alt）。表には番号と ID だけを書き、ROM の文は書かない。
// 表に無い番号が出たら、変換は警告を出して仮の ID（番号入り）を使う。
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { GameKey } from './tables.ts';

/** 1 つのゲームの対応表 */
export interface IdTable {
  /** 名前の番号（命令 14 name）→ ID */
  names: Record<string, string>;
  /** 人物の番号（命令 30 char）→ ID。名札の無い人物（大写しの顔・群衆など）と、名前の番号と別の人物にするもの */
  chars: Record<string, string>;
  /** 法廷記録の人物ファイルの番号 → ID。話し手に結び付かない人物（台詞の無い被害者など） */
  profiles: Record<string, string>;
}

export type IdTables = Record<GameKey, IdTable>;

export const ID_TABLE_PATH = join(import.meta.dir, 'character-ids.json');

/** ID に使える形（英小文字で始まり、英小文字・数字・_） */
export const ID_PATTERN = /^[a-z][a-z0-9_]*$/;

/** character-ids.json を読む（_about などの _ で始まる鍵は除く） */
export function loadIdTables(path = ID_TABLE_PATH): IdTables {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(raw).filter(([k]) => !k.startsWith('_')),
  ) as unknown as IdTables;
}

/** 表を引く種類（警告の文に使う） */
const KIND_LABEL: Record<keyof IdTable, string> = {
  names: '名前の番号',
  chars: '人物の番号',
  profiles: '人物ファイルの番号',
};

/**
 * 表を引く。表が無ければ（テストの小さな表など）null。表に無い番号なら警告を足して null
 * （呼ぶ側は番号入りの仮の ID にする）
 */
export function lookupId(
  table: IdTable | undefined,
  kind: keyof IdTable,
  n: number,
  warnings: Set<string>,
  opts: { warn?: boolean } = {},
): string | null {
  if (!table) return null;
  const id = table[kind][String(n)];
  if (id !== undefined) return id;
  if (opts.warn !== false)
    warnings.add(`人物 ID の表（tools/convert/character-ids.json）に無い${KIND_LABEL[kind]}: ${n}`);
  return null;
}
