// シナリオ YAML の構造の定義。ここが「唯一の正」で、
// コンパイラの検証・TypeScript の型・エディタ補完用 JSON Schema のすべてをここから作る。
// 部品は schema-base.ts、ステップは schema-commands.ts、シナリオ全体は schema-scenario.ts に分けてある。

import { z } from 'zod';
import { Id } from './schema-base.ts';
import { makeCommands } from './schema-commands.ts';
import { makeScenario } from './schema-scenario.ts';

export { Cond, FlagValue, Id, ShoutKind, TextColor } from './schema-base.ts';
export { type CommandName, makeCommands } from './schema-commands.ts';
export { makeScenario } from './schema-scenario.ts';

/** 人物 ID と衝突してはいけない予約語（ステップ省略形の判定に使うため） */
export const RESERVED_KEYS = new Set<string>([
  ...Object.keys(makeCommands(z.array(z.unknown()))),
  'text',
  'color',
  'then',
  'else',
  'when',
  'by',
  'present',
  'wrong',
  'seen',
  'frames',
  'strength',
  'talk',
  'idle',
  'args',
  'auto',
  'nowait',
  'off',
  'side',
  'profiles',
]);

/** 検証用（ネストしたステップはコンパイラが個別に検証する） */
const Shallow = z.array(z.unknown());
export const commandSchemas = makeCommands(Shallow);
export const scenarioSchema = makeScenario(Shallow);
export type RawScenario = z.infer<typeof scenarioSchema>;
export type RawPart = NonNullable<RawScenario['parts']>[number];
export type RawPlace = NonNullable<RawPart['places']>[string];

/** エディタ補完用の、ネストまで含んだ完全なスキーマ */
export function fullScenarioSchema() {
  const Step: z.ZodType = z.lazy(() =>
    z.union([
      ...Object.values(makeCommands(Steps)),
      z.record(Id, z.string()).describe('台詞の省略形: `人物ID: 台詞`'),
    ] as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]),
  );
  const Steps = z.array(Step);
  return makeScenario(Steps);
}
