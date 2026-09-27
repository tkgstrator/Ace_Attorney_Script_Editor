import type { DialogueScene, EvidenceDef, Instr, Scene } from '@gyakusai/core';
import { Builder, patch } from './builder.ts';
import type { PlaceContext } from './compile-place.ts';
import type { RawScenario } from './schema.ts';

/** 詳しく調べるシーンの ID（YAML の ID には使えない形なので、書いたシーンと重ならない） */
export const inspectScene = (evidence: string) => `@inspect:${evidence}`;

/** 選択肢の最後に足す、何も調べずに戻る項目 */
export const INSPECT_CANCEL = 'やめる';

/**
 * 証拠品の examine（詳しく調べる）を、調べる場所の選択肢から始まるシーンにする。
 * 各場所のブロックと「やめる」は、最後に inspectEnd（調べ始めた場面に戻る）を置く。
 * 返すのは examine を除いた証拠品の定義（inspect にシーンの ID を入れたもの）
 */
export function compileInspect(
  ctx: PlaceContext, evidence: RawScenario['evidence'], scenes: Record<string, Scene>,
): Record<string, EvidenceDef> {
  const out: Record<string, EvidenceDef> = {};
  for (const [id, raw] of Object.entries(evidence)) {
    const { examine, ...def } = raw;
    out[id] = def;
    if (!examine) continue;
    const b = new Builder();
    const choice: Extract<Instr, { op: 'choice' }> = { op: 'choice', options: [] };
    b.emit(choice);
    const exits: number[] = [];
    examine.forEach((e, i) => {
      const path = ['evidence', id, 'examine', i];
      const when = e.when !== undefined ? ctx.cond(e.when, [...path, 'when']) : undefined;
      choice.options.push({ text: e.spot, ...(when ? { when } : {}), to: b.pc });
      ctx.compileSteps(e.then, [...path, 'then'], b);
      exits.push(b.emit({ op: 'jump', to: -1 }));
    });
    choice.options.push({ text: INSPECT_CANCEL, to: b.pc });
    for (const j of exits) patch(b, j, b.pc);
    b.emit({ op: 'inspectEnd' });
    const scene = inspectScene(id);
    scenes[scene] = { kind: 'dialogue', id: scene, program: b.code } satisfies DialogueScene;
    out[id] = { ...def, inspect: scene };
  }
  return out;
}
