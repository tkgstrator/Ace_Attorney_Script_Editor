// シナリオ YAML の構造の定義のうち、どこでも使う小さな部品（ID・フラグの値・条件式など）。
// 全体の入口は schema.ts。

import { z } from 'zod';

export const Id = z
  .string()
  .regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'ID は英字・数字・_ で、先頭は英字か _ にしてください');
export const FlagValue = z.union([z.boolean(), z.number(), z.string()]);
export const TextColor = z.enum(['white', 'blue', 'green', 'orange', 'red']);
export const ShoutKind = z.enum(['objection', 'hold', 'takethat']);
/** 条件式（例: `has(repair) and not bell_pressed`） */
export const Cond = z.string().min(1).describe('条件式。例: has(repair) and not pressed_s2');
