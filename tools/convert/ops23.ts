// 逆転裁判2・3 にだけある命令（サイコ・ロック・ライフのゲージなど）の変換。命令の意味は tools/rom/game.py と
// assets/extracted/aa2/tables/ の説明（サイコ・ロックの記録 game+0x268、ゲージ game+0x66 など）。
//   79 ロックを決める（枠, 錠の数, 人物, 場所, 開始, やめた, ゲージ 0。0xffff = 変えない）→ psycheLock
//   81 場所の状態（つきつけの表の [1] と比べる）→ 数のフラグ
//   82 / 83 つきつけてよい・やめてよい / 戻す（次の 21 がつきつけの要求になる。section.ts）
//   84 ゲージ（0 = 動き: 出す・引っ込める・予告した量を減らす、2 = 減る量の予告）
//   87 / 88 / 98 / 99 錠の表示、89 / 90 話題の錠の印、96 / 97 挑戦中のつきつけの正解、100 / 113 錠を壊す・解除
import type { Context } from './context.ts';
import { talkAddFlag } from './invest23.ts';
import { native } from './mapping.ts';
import type { Hands, Memory } from './ops.ts';
import type { CmdOp, Op, Step } from './types.ts';

const KEEP = 0xffff;

/** ロックの枠 → ID */
export const lockId = (slot: number) => `lock${slot}`;

/** 区画（+128）→ シーン ID（そこへ移るシーンとして登録する） */
function sceneOf(ctx: Context, raw: number, from: number): string | null {
  const steps = ctx.jump(raw - 128, from, 'scene');
  const g = steps.length === 1 ? (steps[0] as { goto?: string }).goto : undefined;
  return g ?? null;
}

/** 話題の錠の印（89 k の k → 区画）のフラグ */
export function lockIconFlag(ctx: Context, section: number): string {
  return ctx.flag(`${ctx.gpfx}lockicon_${section}`, false);
}

/** 89 k の k 番目の区画（パートの表 init.op89_sections） */
function iconSection(ctx: Context, k: number): number | null {
  const list = (ctx.inv?.init as { op89_sections?: { section: number }[] } | undefined)
    ?.op89_sections;
  return list?.[k]?.section ?? null;
}

/**
 * 2・3 の命令なら変換して true。ゲージの動き（84 0 n）の番号は 2 と 3 で違う
 * （2: 1・5 出す、2・4 引っ込める、3 減らす。3: 1・9 出す、2・3・5 引っ込める、4 減らす）
 */
export function op23(o: CmdOp, ctx: Context, h: Hands, mem: Memory, section: number): boolean {
  if (ctx.t.game === 'aa1') return false;
  const a = o.args;
  const st = ctx.stats;
  const aa3 = ctx.t.game === 'aa3';
  const put = (s: Step) => h.put(s);
  switch (o.op) {
    case 43: // 2・3 では何もしない（ゲージは 84）
    case 80:
    case 85: // 背景の先読み
    case 91: // 探偵のメニューのカーソル（戻るのは 21）
    case 103: // 台本の読み直し
    case 104: // 人物の色の効果のかけ直し
    case 110: // 行の高さ（スタッフロール）
      st.hit(o.name, 'ignored');
      return true;
    case 79: {
      const s: Step = { psycheLock: lockId(a[0]!) };
      if (a[1] !== KEEP) s.locks = a[1];
      if (a[2] !== KEEP) s.person = ctx.character(a[2]!);
      if (a[3] !== KEEP) s.place = ctx.placeId(a[3]!);
      for (const [k, v] of [
        ['start', a[4]],
        ['quit', a[5]],
        ['gaugeOut', a[6]],
      ] as const) {
        if (v === KEEP) continue;
        const id = sceneOf(ctx, v!, section);
        if (id) s[k] = id;
        else st.gap('サイコ・ロックの行き先の区画をシーンにできない', section);
      }
      ctx.shared.lockKeys = true;
      put(s);
      return true;
    }
    case 81:
      put({ set: { [ctx.flag(`${ctx.gpfx}pstate_${a[0]}`, 0)]: a[1] } });
      return true;
    case 82:
      mem.lockPresent = true;
      st.hit(o.name, 'structure');
      return true;
    case 83:
      mem.lockPresent = false;
      st.hit(o.name, 'structure');
      return true;
    case 84: {
      const [kind, v] = [a[0]!, a[1]!];
      if (kind === 2) put({ lifeRisk: v });
      else if (kind === 0) {
        const show = aa3 ? [1, 9] : [1, 5];
        const hide = aa3 ? [2, 3, 5] : [2, 4];
        if (v === (aa3 ? 4 : 3)) put({ penalty: 'risk' });
        else if (show.includes(v)) put({ ui: { life: true } });
        else if (hide.includes(v)) put({ ui: { life: null } });
        else st.hit(o.name, 'ignored');
      } else if (aa3 && kind === 3) put({ heal: true });
      else if (aa3 && kind === 5) put({ ui: { life: true } });
      else if (aa3 && kind === 4) put({ ui: { life: null } });
      else st.hit(o.name, 'ignored');
      return true;
    }
    case 87:
      put({ ui: { locks: Math.max(1, a[0]!) } });
      return true;
    case 88:
    case 98:
      put({ ui: { locks: false } });
      return true;
    case 99:
      put({ ui: { locks: true } });
      return true;
    case 89:
    case 90: {
      const s = iconSection(ctx, a[0]!);
      if (s === null) {
        st.gap('話題の錠の印の表（init.op89_sections）が無い', section);
        st.hit(o.name, 'ignored');
      } else put({ set: { [lockIconFlag(ctx, s)]: o.op === 89 } });
      return true;
    }
    case 96: {
      mem.answers = { list: [{ item: a[1]!, goto: a[2]! - 128 }], wrong: a[3]! - 128 };
      // 正解を決めてから挑戦中のつきつけへ飛ぶ区画が複数あれば、どれを通ったかを覚える
      const ops = ctx.entry.body[section]?.ops ?? [];
      const to = ops.map(jumpTarget).find((t) => t !== null);
      if (to != null && answerSetters(ctx, to).length > 1)
        put({ set: { [answerFlag(ctx)]: section } });
      st.hit(o.name, 'structure');
      return true;
    }
    case 97:
      if (mem.answers) mem.answers.list.push({ item: a[1]!, goto: a[2]! - 128 });
      else st.gap('サイコ・ロックの正解（97）の前に 96 が無い', section);
      st.hit(o.name, 'structure');
      return true;
    case 100:
      put({ breakLock: true });
      return true;
    case 113:
      put(a[1] === 1 ? { unlock: true } : { breakLock: 'hold' });
      return true;
    case 102: // 挑むロックの枠と BGM（BGM は台本の bgm でも鳴らしている）
      st.hit(o.name, 'ignored');
      return true;
    case 108:
      // 3: 決め打ちの話題を足す（invest23.ts の talkAdds23）。足した印のフラグを立てる
      if (aa3 && ctx.inv) {
        put({ set: { [talkAddFlag(ctx, section)]: true } });
        return true;
      }
      h.put(native(o.name, a));
      return true;
    case 109:
    case 124:
    case 125:
    case 126:
      h.put(native(o.name, a));
      return true;
    default:
      return false;
  }
}

type Answers = NonNullable<Memory['answers']>;

/** 区画の 96 / 97 の正解の表 */
function answersIn(ops: Op[]): Answers | null {
  let ans: Answers | null = null;
  for (const o of ops) {
    if (o.op === 'text') continue;
    if (o.op === 96)
      ans = { list: [{ item: o.args[1]!, goto: o.args[2]! - 128 }], wrong: o.args[3]! - 128 };
    if (o.op === 97 && ans) ans.list.push({ item: o.args[1]!, goto: o.args[2]! - 128 });
  }
  return ans;
}

/** 飛ぶ命令（44 / 54 / 10）の行き先の区画 */
const jumpTarget = (o: Op): number | null =>
  o.op !== 'text' && (o.op === 44 || o.op === 54 || o.op === 10)
    ? (o.targets?.[0]?.section ?? o.target?.section ?? o.args[0]! - 128)
    : null;

/**
 * 96 / 97 で正解を決めてから区画 target（挑戦中のつきつけ）へ飛ぶ区画。2 つ以上あれば、どれを通ったかで正解が変わる
 * （逆転裁判3 の第 2 話 §228 の選択肢 → §229 / §230 → §231 など）
 */
export function answerSetters(ctx: Context, target: number): number[] {
  return ctx.entry.body
    .filter(
      (sec) => sec.ops.some((o) => o.op === 96) && sec.ops.some((o) => jumpTarget(o) === target),
    )
    .map((sec) => sec.section);
}

/** どの区画の正解を使うか（数のフラグ。区画の番号） */
export const answerFlag = (ctx: Context): string => ctx.flag(`${ctx.gpfx}lockans`, -1);

/** 正解の区画ごとの表（answerSetters が 2 つ以上のとき） */
export function answerSets(ctx: Context, target: number): { section: number; ans: Answers }[] {
  const setters = answerSetters(ctx, target);
  if (setters.length < 2) return [];
  return setters.flatMap((s) => {
    const ans = answersIn(ctx.entry.body[s]?.ops ?? []);
    return ans ? [{ section: s, ans }] : [];
  });
}

/** 21 のつきつけ（82 の後）: 正解の表は、この区画か前の区画の 96 / 97 */
export function lockAnswers(ctx: Context, section: number, mem: Memory): Memory['answers'] {
  if (mem.answers) return mem.answers;
  for (let s = section - 1; s >= 0; s--) {
    const ops = ctx.entry.body[s]?.ops ?? [];
    if (ops.some((o) => o.op === 96)) return answersIn(ops);
  }
  return null;
}
