// DS 版だけの演出（105 ds_fx）の変換。ops.ts から使う。
import type { Context } from './context.ts';
import { dsFx, native } from './mapping.ts';
import type { Hands, Memory } from './ops.ts';
import type { CmdOp } from './types.ts';

/** 105 ds_fx（107 の引数と組）。木槌は効果音と揺れで近づけ、証拠品の小窓を消すものは showEvidence: null */
export function dsEffect(o: CmdOp, ctx: Context, h: Hands, mem: Memory, section: number) {
  const [a0, a1 = 0] = o.args;
  const { stage, effect } = dsFx(a1);
  const args = [a0!, a1, ...mem.ds107];
  if (a0 !== 98) {
    h.put(native(o.name, args));
    return;
  }
  // 木槌: 22 フレーム後に SE 0x3a（107 の a ≠ 0 なら 0x6f）と揺れ（10 フレーム・強さ 1）。19 は 3 回（22, 32, 44）
  if (effect === 17 || effect === 19) {
    const se = ctx.sound(mem.ds107[0] ? 0x6f : 0x3a);
    const hits = effect === 17 ? [22] : [22, 32, 44];
    let t = 0;
    for (const at of hits) {
      h.put({ wait: at - t }, 'approx');
      h.put({ se }, 'approx');
      h.put({ shake: 10, strength: 1 }, 'approx');
      t = at;
    }
    ctx.stats.gap('DS の木槌の演出（105 の効果 17/19）を待ち・効果音・揺れにした', section);
    return;
  }
  if (effect === 67) {
    h.put({ showEvidence: null }, 'approx');
    return;
  }
  // 下画面だけの演出（選択肢の見出し・下画面の背景と明るさ）は上画面に影響しないので捨てる
  if ([101, 113, 114, 115].includes(effect)) {
    ctx.stats.hit(o.name, 'ignored');
    return;
  }
  void stage;
  h.put(native(o.name, args));
}
