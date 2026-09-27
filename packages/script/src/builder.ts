import type { Instr } from '@gyakusai/core';

/** 命令列を組み立てる */
export class Builder {
  code: Instr[] = [];
  emit(i: Instr): number { this.code.push(i); return this.code.length - 1; }
  get pc(): number { return this.code.length; }
}

/** 後から飛び先が決まるジャンプ命令の飛び先を書き込む */
export function patch(b: Builder, at: number, to: number) {
  const ins = b.code[at];
  if (ins && (ins.op === 'jump' || ins.op === 'jumpUnless')) ins.to = to;
}
