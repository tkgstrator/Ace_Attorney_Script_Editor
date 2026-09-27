import type { Instr, Statement, TestimonyScene } from '@gyakusai/core';
import { Builder } from './builder.ts';
import type { PlaceContext } from './compile-place.ts';
import type { Path } from './compile.ts';
import type { RawScenario } from './schema.ts';

/** 証言の前のブロックに書ける、止まらずに状態を変えるだけの命令 */
const SIMPLE_OPS = new Set<Instr['op']>([
  'bgm', 'se', 'shake', 'flash', 'set', 'add', 'give', 'take', 'giveProfile', 'takeProfile',
  'show', 'location', 'showEvidence', 'textbox', 'ui', 'bgmPause', 'scroll', 'pan', 'overlay', 'palette',
]);

type RawTestimony = Exclude<NonNullable<RawScenario['scenes']>[string], unknown[]>;

/**
 * 証言シーンを変換する。ゆさぶり・つきつけ・見当違い・after・loop の各ブロックを 1 つの命令列に並べ、
 * ブロックの終わりには証言に戻る命令（resume）を置く
 */
export function compileTestimony(
  ctx: PlaceContext, id: string, t: RawTestimony, path: Path,
  warn: (path: Path, message: string) => void,
  checkText: (text: string, path?: Path) => void,
  compileWrong: (steps: unknown, path: Path, b: Builder) => void,
): TestimonyScene {
  const { player, compileSteps, cond, checkCharacter, error } = ctx;
  const b = new Builder();
  checkCharacter(t.witness, [...path, 'witness']);
  checkText(t.testimony);
  const ids = new Set<string>();
  const statements: Statement[] = t.statements.map((raw, i) => {
    const p: Path = [...path, 'statements', i];
    const sid = raw.id ?? `s${i + 1}`;
    if (ids.has(sid)) error([...p, 'id'], `証言の ID が重複しています: ${sid}`);
    ids.add(sid);
    checkText(raw.text, [...p, 'text']);
    const st: Statement = { id: sid, text: raw.text, present: {} };
    if (raw.when !== undefined) { const e = cond(raw.when, [...p, 'when']); if (e) st.when = e; }
    if (raw.before !== undefined) {
      st.before = b.pc;
      compileSteps(raw.before, [...p, 'before'], b);
      for (const ins of b.code.slice(st.before)) {
        if (!SIMPLE_OPS.has(ins.op)) error([...p, 'before'], `before には止まる命令・移動する命令は書けません（${ins.op}）`);
      }
      b.emit({ op: 'resume', to: 'stay' }); // ブロックの終わりの印（実行はしない）
    }
    if (raw.press !== undefined) {
      st.press = b.pc;
      b.emit({ op: 'shout', kind: 'hold', by: player });
      compileSteps(raw.press, [...p, 'press'], b);
      b.emit({ op: 'resume', to: 'next' });
    } else {
      warn(p, `証言「${sid}」に press がありません（ゆさぶれない証言になります）`);
    }
    for (const [ev, steps] of Object.entries(raw.present ?? {})) {
      // 尋問では証拠品だけ（人物ファイルはつきつけられない）
      if (ctx.presentKind(ev, [...p, 'present', ev]) === 'profile') error([...p, 'present', ev], `尋問では人物ファイル（${ev}）はつきつけられません`);
      st.present[ev] = b.pc;
      b.emit({ op: 'shout', kind: 'objection', by: player });
      compileSteps(steps, [...p, 'present', ev], b);
      b.emit({ op: 'resume', to: 'stay' });
    }
    return st;
  });
  const scene: TestimonyScene = { kind: 'testimony', id, title: t.testimony, witness: t.witness, program: b.code, statements, wrong: -1 };
  scene.wrong = b.pc;
  b.emit({ op: 'shout', kind: 'objection', by: player });
  compileWrong(t.wrong, [...path, 'wrong'], b);
  b.emit({ op: 'resume', to: 'stay' });
  if (t.reading) { scene.reading = b.pc; compileSteps(t.reading, [...path, 'reading'], b); b.emit({ op: 'resume', to: 'afterReading' }); }
  if (t.after) { scene.after = b.pc; compileSteps(t.after, [...path, 'after'], b); b.emit({ op: 'resume', to: 'crossIntro' }); }
  if (t.loop) { scene.loop = b.pc; compileSteps(t.loop, [...path, 'loop'], b); b.emit({ op: 'resume', to: 'first' }); }
  if (statements.every(st => Object.keys(st.present).length === 0)) {
    warn(path, 'どの証言にも present がありません（尋問から抜け出せません）');
  }
  return scene;
}
