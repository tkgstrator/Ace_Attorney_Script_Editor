// pick（絵の上の範囲を選ぶ）のステップを命令にする。compile-step.ts から使う。
// 命令の並び: pick → 範囲ごとの then（→ 終わりへ）→ 範囲の外（→ pick へ戻る）→ やめる（→ 終わりへ）
import type { Area, Expr, Instr, PickOption } from '@gyakusai/core';
import { type Builder, patch } from './builder.ts';
import type { Path } from './compile.ts';

interface PickStep {
  pick: string;
  images?: string | string[];
  areas: { name?: string; area: Area; image?: number; when?: string; then?: unknown[] }[];
  miss?: unknown[];
  quit?: unknown[];
}

export interface PickContext {
  compileSteps(steps: unknown, path: Path, b: Builder): void;
  cond(src: string, path: Path): Expr | undefined;
  checkText(text: string, path?: Path): void;
  error(path: Path, msg: string): void;
}

export function compilePick(s: PickStep, path: Path, b: Builder, ctx: PickContext): void {
  const { compileSteps, cond, checkText, error } = ctx;
  if (s.pick !== '') checkText(s.pick, [...path, 'pick']);
  const images = s.images === undefined ? [] : ([] as string[]).concat(s.images);
  const ins: Extract<Instr, { op: 'pick' }> = { op: 'pick', prompt: s.pick, images, options: [] };
  const at = b.emit(ins);
  const exits: number[] = [];
  s.areas.forEach((a, i) => {
    const p = [...path, 'areas', i];
    if (a.image !== undefined && a.image >= Math.max(1, images.length))
      error([...p, 'image'], `images に ${a.image} 番の絵がありません（${images.length} 枚）`);
    const when = a.when !== undefined ? cond(a.when, [...p, 'when']) : undefined;
    const opt: PickOption = { kind: 'area', to: b.pc, area: a.area };
    if (a.image !== undefined) opt.image = a.image;
    if (when) opt.when = when;
    if (a.name !== undefined) opt.name = a.name;
    ins.options.push(opt);
    if (a.then) compileSteps(a.then, [...p, 'then'], b);
    exits.push(b.emit({ op: 'jump', to: -1 }));
  });
  if (s.miss !== undefined) {
    ins.options.push({ kind: 'miss', to: b.pc });
    compileSteps(s.miss, [...path, 'miss'], b);
    b.emit({ op: 'jump', to: at });
  }
  if (s.quit !== undefined) {
    ins.options.push({ kind: 'quit', to: b.pc });
    compileSteps(s.quit, [...path, 'quit'], b);
  }
  for (const j of exits) patch(b, j, b.pc);
}
