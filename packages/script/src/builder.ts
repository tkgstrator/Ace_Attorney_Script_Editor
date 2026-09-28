import type { Instr } from '@gyakusai/core';

/** 命令の元になったステップの位置（YAML のパス）。ステップの外で足した命令は null */
export type SourcePath = (string | number)[] | null;

/** 命令列から、それを作った Builder を引く（シーンを作る各所を変えずに、元の位置を集めるため） */
const builders = new WeakMap<Instr[], Builder>();

/** 命令列を組み立てる */
export class Builder {
  code: Instr[] = [];
  /** code と同じ並びの、各命令の元になったステップの位置（エディタの「ここから再生」で使う） */
  src: SourcePath[] = [];
  /** 今変換しているステップの位置 */
  at: SourcePath = null;
  constructor() {
    builders.set(this.code, this);
  }
  emit(i: Instr): number {
    this.code.push(i);
    this.src.push(this.at);
    return this.code.length - 1;
  }
  get pc(): number {
    return this.code.length;
  }
}

/** 命令列の各命令の、元になったステップの位置（その命令列を Builder で作っていなければ null） */
export function sourcesOf(code: Instr[]): SourcePath[] | null {
  return builders.get(code)?.src ?? null;
}

/** 後から飛び先が決まるジャンプ命令の飛び先を書き込む */
export function patch(b: Builder, at: number, to: number) {
  const ins = b.code[at];
  if (ins && (ins.op === 'jump' || ins.op === 'jumpUnless')) ins.to = to;
}
