import type { CharacterDef, Description, Expr } from '@gyakusai/core';
import type { Path } from './compile.ts';
import type { RawScenario } from './schema.ts';

/** 説明（文字列か、when つきの配列）を IR にする。条件式は cond（ほかの when と同じ参照チェック）を通す */
export function compileDescription(
  raw: string | { when?: string | undefined; text: string }[],
  path: Path,
  cond: (src: string, path: Path) => Expr | undefined,
): Description {
  if (typeof raw === 'string') return raw;
  return raw.map((c, i) => {
    const when = c.when !== undefined ? cond(c.when, [...path, i, 'when']) : undefined;
    return { ...(when ? { when } : {}), text: c.text };
  });
}

/** 人物の定義を IR にする（profile.description の条件式をコンパイルする。それ以外はそのまま） */
export function compileCharacters(
  characters: RawScenario['characters'],
  cond: (src: string, path: Path) => Expr | undefined,
): Record<string, CharacterDef> {
  const out: Record<string, CharacterDef> = {};
  for (const [id, c] of Object.entries(characters)) {
    const { profile, ...rest } = c;
    out[id] = {
      ...rest,
      ...(profile
        ? {
            profile: {
              ...profile,
              description: compileDescription(
                profile.description,
                ['characters', id, 'profile', 'description'],
                cond,
              ),
            },
          }
        : {}),
    };
  }
  return out;
}
