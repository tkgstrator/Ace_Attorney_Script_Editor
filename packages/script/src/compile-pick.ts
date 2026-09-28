// pick（絵の上の範囲を選ぶ）と nominate（人物を選ぶ）のステップを命令にする。compile-step.ts から使う。
// 命令の並び: pick → 範囲ごとの then（→ 終わりへ）→ 範囲の外（→ pick へ戻る）→ やめる（→ 終わりへ）
// nominate も pick の命令にする（人物ごとの範囲に顔を出す。正解の人物 → 終わりへ、ほかの人物 → wrong → pick へ戻る）
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
  checkCharacter(id: string, path: Path): void;
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

interface NominateStep {
  nominate: string;
  people: string[];
  present: Record<string, unknown[]>;
  wrong?: unknown[];
}

/**
 * 人物を選ぶ顔の並び（DS 版の人物を選ぶ画面の枠 0x020b1518: 44×44 の枠を 48 ドットおきに 4 人ずつ 2 段）。
 * 人数が少なければ前から使う
 */
export const PEOPLE_SLOTS: Area[] = Array.from({ length: 8 }, (_, i) => [
  34 + 48 * (i % 4),
  62 + 48 * Math.floor(i / 4),
  44,
  44,
]);

export function compileNominate(s: NominateStep, path: Path, b: Builder, ctx: PickContext): void {
  const { compileSteps, checkCharacter, checkText, error } = ctx;
  if (s.nominate !== '') checkText(s.nominate, [...path, 'nominate']);
  s.people.forEach((id, i) => {
    checkCharacter(id, [...path, 'people', i]);
    if (s.people.indexOf(id) !== i) error([...path, 'people', i], `${id} が二度並んでいます`);
  });
  for (const id of Object.keys(s.present))
    if (!s.people.includes(id))
      error([...path, 'present', id], `正解の ${id} が people にありません`);
  if (s.people.every((id) => s.present[id]))
    error([...path, 'wrong'], '正解でない人物がいません（people に正解のほかの人物も並べる）');
  const ins: Extract<Instr, { op: 'pick' }> = {
    op: 'pick',
    prompt: s.nominate,
    images: [],
    options: [],
  };
  const at = b.emit(ins);
  const exits: number[] = [];
  // 正解の人物
  s.people.forEach((id, i) => {
    const body = s.present[id];
    if (!body) return;
    ins.options[i] = { kind: 'area', to: b.pc, area: PEOPLE_SLOTS[i]!, person: id };
    compileSteps(body, [...path, 'present', id], b);
    exits.push(b.emit({ op: 'jump', to: -1 }));
  });
  // ほかの人物（まとめて wrong へ）
  const wrong = b.pc;
  s.people.forEach((id, i) => {
    if (!s.present[id])
      ins.options[i] = { kind: 'area', to: wrong, area: PEOPLE_SLOTS[i]!, person: id };
  });
  if (s.wrong) compileSteps(s.wrong, [...path, 'wrong'], b);
  b.emit({ op: 'jump', to: at });
  for (const j of exits) patch(b, j, b.pc);
}
