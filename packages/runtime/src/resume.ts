// 台詞の途中で証拠品を詳しく調べて戻ったとき、台詞を最初から打ち直さず、調べ始めたページを出し切った形で続ける。
import type { Beat, Engine } from '@gyakusai/core';
import type { Typewriter } from './typewriter.ts';

export class LineResume {
  #at: { scene: string; pc: number; page: number } | null = null;

  /** 法廷記録の操作の後に呼ぶ。台詞の途中で詳しく調べ始めたら、戻り先の台詞とページを覚える */
  remember(engine: Engine, before: Beat, page: number) {
    const f = engine.state.inspectFrom;
    if (f && before.kind === 'line' && !this.#at) this.#at = { scene: f.scene, pc: f.pc, page };
  }

  /** Beat が変わったときに呼ぶ。調べ終えて調べ始めた台詞に戻ったら、そのページまで進めて出し切る */
  apply(engine: Engine, beat: Beat, tw: Typewriter | null) {
    const at = this.#at;
    const s = engine.state;
    if (!at || s.inspectFrom) return;
    this.#at = null;
    if (beat.kind !== 'line' || !tw || s.scene !== at.scene || s.pc !== at.pc) return;
    for (let i = 0; i < at.page && !tw.lastPage; i++) tw.nextPage();
    tw.finish();
  }
}
