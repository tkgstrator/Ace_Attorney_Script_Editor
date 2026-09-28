// 区画（または区画の一部）を、シナリオのステップ列にする。流れを変える命令（ページ・飛ぶ・選択肢・つきつけ・終わり）もここ。
// 選択肢・つきつけの要求などのステップの形は section-branch.ts。
import type { Context } from './context.ts';
import { EXAMINE_WAIT, examineWaitAt, luminolTutorial } from './examine3d.ts';
import { nextDayPlace as nextDay0 } from './investigation.ts';
import { ifFlagArg, inlineOf, native } from './mapping.ts';
import { type Hands, type Memory, newMemory, simpleOp } from './ops.ts';
import {
  choiceStep,
  demandSteps,
  labelGoto,
  minigameChoice,
  pointChoice,
} from './section-branch.ts';
import type { How } from './stats.ts';
import type { CmdOp, Op, Step } from './types.ts';
import { type TextState, Writer } from './writer.ts';

export interface SectionOptions {
  /** 日時・場所の表示（揃え 1・名前なし）を捨てる（証言・尋問のタイトル） */
  dropCards?: boolean;
  /** 区画への移動をどう書くか（証言の中のブロックでは「証言に戻る」を空にする） */
  gotoSteps?: (target: number) => Step[];
  /** 状態を引き継ぐ（同じ区画を分けたとき）・後で見る（最後の人物の動き） */
  memory?: Memory;
  /** 構造（証言など）で表したので、捨てて数えるだけの命令 */
  structural?: Set<number>;
  /** 21 player_turn で台詞を閉じ（ボタン待ち）、そこで終える（尋問の証言の文） */
  statement?: boolean;
  /** 文字の状態を引き継ぐ（53 のブロックの中） */
  state?: TextState;
  /** 探偵メニューへ戻る（21）ときのステップ（既定は ctx.menuReturn()） */
  menuReturn?: Step[];
  /**
   * 53 の飛び越しのブロックで、ブロックのすぐ後が区画の終わり（13）のとき、外側の「次の区画」。
   * ブロックの中で次の区画を決めた（44 / 32 / 42）なら、ブロックの最後でそこへ移る
   */
  nextAtEnd?: number;
}

/**
 * i の 53 から先の位置（ops[j]）への飛び越しを、ブロックにしてよいか:
 * 間にある 53 のバイト位置の飛び先が、すべて at 以下で前向き
 */
export function nested(ops: Op[], i: number, j: number, at: number): boolean {
  for (let k = i + 1; k < j; k++) {
    const o = ops[k]!;
    if (o.op !== 53) continue;
    const t = o.target;
    if (!t || t.section !== null) continue;
    if (t.offset > at || t.offset <= o.at) return false;
  }
  return true;
}

/** ページを閉じる命令 */
const CLOSERS = new Set([2, 7, 10, 45, 46, 44, 13, 54, 120, 8, 9, 17, 33, 21, 69, 121, 22, 36]);

/** 区画の命令列（ops）をステップ列にする */
export function convertOps(
  ctx: Context,
  section: number,
  ops: Op[],
  opts: SectionOptions = {},
): Step[] {
  const st = ctx.stats;
  const w = new Writer(st, section, (n) => ctx.speaker(n), opts.dropCards);
  w.blipOf = (n) => (n === 0 ? 0 : (ctx.t.blipKinds[n] ?? 0));
  if (opts.state) Object.assign(w.st, opts.state);
  const mem = opts.memory ?? newMemory();
  const gotoSteps = opts.gotoSteps ?? ((t: number) => ctx.jump(t, section));
  let next: number = opts.nextAtEnd ?? section + 1;
  let nextCond: { flag: string; a: number; b: number } | null = null;
  let dayEnd = false;
  let minigame: number | null = null;
  let i = 0;

  const textFollows = (from: number) => {
    for (let j = from + 1; j < ops.length; j++) {
      const o = ops[j]!;
      if (o.op === 'text') return true;
      if (CLOSERS.has(o.op)) return false;
    }
    return false;
  };
  const hands: Hands = {
    w,
    put(s: Step, how?: How) {
      const o = ops[i] as CmdOp;
      const h = how ?? ('native' in s ? 'native' : 'step');
      if (w.open) {
        // 文の途中・ページの終わり（ボタンの前）なら、できるだけ文中コマンドにする
        const cmd = inlineOf(s);
        if (cmd && w.inline(cmd)) {
          st.hit(o.name, h === 'native' ? 'native' : 'inline');
          return;
        }
        if (textFollows(i))
          st.gap(`台詞の途中の命令を台詞の後に回した（${o.op} ${o.name}）`, section);
        else {
          w.enterTail();
          st.gap('ページの終わり（文の後・ボタンの前）の命令をボタンの後にした', section);
        }
      }
      w.step(s);
      st.hit(o.name, h);
    },
    putInline(_cmd: string, s: Step) {
      hands.put(s);
    },
    nextSpeaker() {
      for (let j = i + 1; j < ops.length; j++) {
        const o = ops[j]!;
        if (o.op === 14) return ((o as CmdOp).args[0]! >> 8) & 0x7f;
      }
      return 2;
    },
  };
  const flow = (o: CmdOp, how: How = 'structure') => st.hit(o.name, how);
  const nextDay = (sec: number) => nextDay0(ctx, sec);
  const out = () => w.out;

  for (; i < ops.length; i++) {
    const o = ops[i]!;
    if (o.op === 'text') {
      w.text(o.text);
      st.hit('text', 'step');
      continue;
    }
    const a = o.args;
    if (opts.structural?.has(o.op)) {
      flow(o);
      continue;
    }
    if (opts.statement && o.op === 21) {
      w.close('input');
      flow(o);
      return finish(ctx, section, ops, i, out());
    }
    const tgt = (k = 0) => o.targets?.[k]?.section ?? a[k]! - 128;
    switch (o.op) {
      case 2:
      case 45:
        if (!w.open) {
          out().push(native(o.name, []));
          flow(o, 'native');
          st.gap('文の無いボタン待ち（2 page）', section);
          break;
        }
        w.close('input');
        flow(o);
        break;
      case 7:
        w.close('keep');
        flow(o);
        break;
      case 46:
        w.close('auto');
        flow(o);
        break;
      case 44:
        next = tgt();
        nextCond = null;
        w.close('auto');
        flow(o);
        break;
      case 32:
        next = tgt();
        nextCond = null;
        flow(o);
        break;
      case 42:
        nextCond = {
          flag: ctx.fname(0, a[0]!),
          a: o.targets?.[0]?.section ?? a[1]! - 128,
          b: o.targets?.[1]?.section ?? a[2]! - 128,
        };
        flow(o);
        break;
      case 10:
        w.close('input');
        flow(o);
        out().push(...gotoSteps(tgt()));
        return finish(ctx, section, ops, i, out());
      case 13:
        w.close('auto');
        flow(o);
        if (nextCond)
          out().push({
            if: nextCond.flag,
            // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
            then: gotoSteps(nextCond.a),
            else: gotoSteps(nextCond.b),
          });
        // 探偵パートの始め: 着いたときの会話（event）の区画へ落ちていくなら、探偵メニュー（着いたときの処理）へ
        else if (ctx.inv && !opts.gotoSteps && next === section + 1 && ctx.eventSections.has(next))
          out().push({ goto: ctx.menuScene() });
        else out().push(...gotoSteps(next));
        return finish(ctx, section, ops, i, out());
      case 54:
      case 120: {
        w.close('auto');
        flow(o);
        out().push(...labelGoto(ctx, o, gotoSteps));
        return finish(ctx, section, ops, i, out());
      }
      case 53: {
        const f = ifFlagArg(a[0]!);
        const flag = ctx.fname(0, f.index);
        const cond = f.want ? flag : `not ${flag}`;
        if (f.label) {
          // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
          hands.put({ if: cond, then: labelGoto(ctx, o, gotoSteps) }, 'structure');
          break;
        }
        // 区画の中の先の位置へ飛ぶ: 間の命令を「条件が合わなければ」のブロックにする（入れ子になっていれば）
        const at = o.target!.offset;
        // 飛び先がこの命令列の終わり（外側のブロックの終わり）なら、残り全部がブロック
        let j = ops.findIndex((x, k) => k > i && x.at >= at);
        if (j < 0 && at > (ops.at(-1)?.at ?? 0)) j = ops.length;
        if (j > i && nested(ops, i, j, at)) {
          w.close('auto');
          flow(o);
          const endsAfter = ops[j]?.op === 13 && !nextCond;
          const inner = convertOps(ctx, section, ops.slice(i + 1, j), {
            ...opts,
            memory: mem,
            state: { ...w.st },
            ...(endsAfter ? { nextAtEnd: next } : { nextAtEnd: undefined }),
          });
          // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
          if (inner.length) out().push({ if: f.want ? `not ${flag}` : flag, then: inner });
          i = j - 1;
          break;
        }
        ctx.pieces.add(`${section}:${at}`);
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        hands.put({ if: cond, then: [{ goto: ctx.sid(section, at) }] }, 'structure');
        break;
      }
      case 122:
        // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
        hands.put({ if: 'life <= 0', then: labelGoto(ctx, o, gotoSteps) }, 'structure');
        break;
      case 8:
      case 9: {
        w.close('keep');
        flow(o);
        out().push(
          choiceStep(
            ctx,
            section,
            o,
            opts.gotoSteps ?? ((t: number) => ctx.jump(t, section, 'choice')),
          ),
        );
        return finish(ctx, section, ops, i, out());
      }
      case 63: {
        // 写真の一点を指す（62 の問題）→ 選択肢で近づける
        w.close('keep');
        flow(o);
        out().push(pointChoice(ctx, section, mem.point, gotoSteps));
        return finish(ctx, section, ops, i, out());
      }
      case 17:
      case 33: {
        const say = w.close('auto', false);
        flow(o);
        out().push(
          ...demandSteps(
            ctx,
            section,
            say ? say.text.replace(/(\[color white\])+$/, '') : '',
            say?.speaker ?? null,
            gotoSteps,
            o.op === 33,
          ),
        );
        return finish(ctx, section, ops, i, out());
      }
      case 116: // 下画面の画面。9 = 指紋などの遊び、10 = 人物の指名（第 5 話）。結果の区画は ARM9 の未解明の表
        if (a[0] === 9 || a[0] === 10) minigame = a[0]!;
        hands.put(native(o.name, a));
        break;
      case 52: // 下画面の画面（セーブ）を待つ。探偵パートでは一日の終わり
        // 第 5 話ではセーブの画面を出すだけで、その後の台本（21 なら探偵メニュー）へそのまま続く
        if (ctx.inv && ctx.part < 17) {
          dayEnd = true;
          hands.put(native(o.name, a));
          break;
        }
        hands.put(native(o.name, a));
        break;
      case 21:
      case 69:
      case 121:
        w.close('auto');
        if (o.op === 21) {
          const turn = ctx.turnGoto.get(section);
          const lum = turn === undefined ? luminolTutorial(ctx, section, gotoSteps) : null;
          if (turn !== undefined || lum) {
            flow(o);
            out().push(...(lum ?? gotoSteps(turn!)));
            return finish(ctx, section, ops, i, out());
          }
        }
        if (o.op === 21 && examineWaitAt(ctx, section)) {
          flow(o);
          st.gap(
            '法廷で 3D の画面を開いて待つ所を、正解のないつきつけの要求にした（証拠品を詳しく調べると進む）',
            section,
          );
          out().push(EXAMINE_WAIT);
          return finish(ctx, section, ops, i, out());
        }
        // 116 8 n の直後の 21 も、下画面の遊び（字を書くなど）の結果待ち
        {
          const prev = ops[i - 1];
          if (prev && prev.op === 116 && prev.args[0] === 8) minigame = 8;
        }
        if (minigame !== null && minigameChoice(ctx, section, minigame, gotoSteps, out())) {
          flow(o);
          return finish(ctx, section, ops, i, out());
        }
        if (opts.menuReturn && o.op !== 121) {
          flow(o);
          out().push(...opts.menuReturn);
        } else if (ctx.inv && dayEnd && nextDay(section) !== null) {
          flow(o);
          st.gap('一日の終わりの後に行く場所を推測した（52 wait_ui15 の後）', section);
          out().push(
            { set: { [ctx.returnFlag()]: false } },
            { investigate: ctx.placeId(nextDay(section)!) },
          );
        } else if (ctx.inv && o.op !== 121) {
          flow(o);
          out().push(...ctx.menuReturn());
        } else {
          flow(o, 'native');
          out().push(native(o.name, []));
        }
        return finish(ctx, section, ops, i, out());
      case 22:
        w.close('auto');
        flow(o);
        out().push(...ctx.nextPart);
        return finish(ctx, section, ops, i, out());
      case 106: {
        // 次の語（次の命令の番号）の値のパートの台本を読み、その §0 へ（第 5 話の法廷の日の途中の区切り）
        const nx = ops[i + 1];
        if (!nx || nx.op === 'text') {
          hands.put(native(o.name, a));
          break;
        }
        w.close('auto');
        flow(o);
        out().push(...ctx.toPart(nx.op));
        return finish(ctx, section, ops, i, out());
      }
      case 36:
        w.close('auto');
        flow(o);
        out().push(ctx.court?.gameover_section === section ? { gameover: true } : { end: true });
        return finish(ctx, section, ops, i, out());
      case 15:
      case 40:
      case 41:
      case 111:
        hands.put(native(o.name, a)); // 証言の外に出てきたときだけ（証言の中は testimony.ts が構造にする）
        break;
      default:
        simpleOp(o, ctx, hands, mem, section);
    }
  }
  w.close('auto');
  // 53 のブロックの中で次の区画を決めたなら、ブロックの最後でそこへ（ブロックのすぐ後が区画の終わり）
  if (opts.nextAtEnd !== undefined && (next !== opts.nextAtEnd || nextCond)) {
    if (nextCond)
      // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
      out().push({ if: nextCond.flag, then: gotoSteps(nextCond.a), else: gotoSteps(nextCond.b) });
    else out().push(...gotoSteps(next));
  }
  return out();
}

/** 流れが終わった後の命令は数えるだけ */
function finish(ctx: Context, _section: number, ops: Op[], i: number, out: Step[]): Step[] {
  for (const o of ops.slice(i + 1)) ctx.stats.hit(o.op === 'text' ? 'text' : o.name, 'ignored');
  return out;
}
