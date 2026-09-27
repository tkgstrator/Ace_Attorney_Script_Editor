// 区画（または区画の一部）を、シナリオのステップ列にする。流れを変える命令（ページ・飛ぶ・選択肢・つきつけ・終わり）もここ。
import type { Context } from './context.ts';
import { ifFlagArg, inlineOf, native } from './mapping.ts';
import { newMemory, simpleOp, type Hands, type Memory } from './ops.ts';
import type { How } from './stats.ts';
import type { CmdOp, Op, Step } from './types.ts';
import { Writer, type TextState } from './writer.ts';
import { nextDayPlace as nextDay0 } from './investigation.ts';
import { nominationResults, orphanSections } from './flow.ts';
import { EXAMINE_WAIT, examineWaitAt, luminolTutorial } from './examine3d.ts';

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
export function convertOps(ctx: Context, section: number, ops: Op[], opts: SectionOptions = {}): Step[] {
  const st = ctx.stats;
  const w = new Writer(st, section, n => ctx.speaker(n), opts.dropCards);
  w.blipOf = n => (n === 0 ? 0 : ctx.t.blipKinds[n] ?? 0);
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
        if (cmd && w.inline(cmd)) { st.hit(o.name, h === 'native' ? 'native' : 'inline'); return; }
        if (textFollows(i)) st.gap(`台詞の途中の命令を台詞の後に回した（${o.op} ${o.name}）`, section);
        else { w.enterTail(); st.gap('ページの終わり（文の後・ボタンの前）の命令をボタンの後にした', section); }
      }
      w.step(s);
      st.hit(o.name, h);
    },
    putInline(_cmd: string, s: Step) { hands.put(s); },
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
    if (o.op === 'text') { w.text(o.text); st.hit('text', 'step'); continue; }
    const a = o.args;
    if (opts.structural?.has(o.op)) { flow(o); continue; }
    if (opts.statement && o.op === 21) { w.close('input'); flow(o); return finish(ctx, section, ops, i, out()); }
    const tgt = (k = 0) => o.targets?.[k]?.section ?? a[k]! - 128;
    switch (o.op) {
      case 2: case 45:
        if (!w.open) { out().push(native(o.name, [])); flow(o, 'native'); st.gap('文の無いボタン待ち（2 page）', section); break; }
        w.close('input'); flow(o);
        break;
      case 7: w.close('keep'); flow(o); break;
      case 46: w.close('auto'); flow(o); break;
      case 44: next = tgt(); nextCond = null; w.close('auto'); flow(o); break;
      case 32: next = tgt(); nextCond = null; flow(o); break;
      case 42: nextCond = { flag: ctx.fname(0, a[0]!), a: o.targets?.[0]?.section ?? a[1]! - 128, b: o.targets?.[1]?.section ?? a[2]! - 128 }; flow(o); break;
      case 10:
        w.close('input'); flow(o);
        out().push(...gotoSteps(tgt()));
        return finish(ctx, section, ops, i, out());
      case 13:
        w.close('auto'); flow(o);
        if (nextCond) out().push({ if: nextCond.flag, then: gotoSteps(nextCond.a), else: gotoSteps(nextCond.b) });
        // 探偵パートの始め: 着いたときの会話（event）の区画へ落ちていくなら、探偵メニュー（着いたときの処理）へ
        else if (ctx.inv && !opts.gotoSteps && next === section + 1 && ctx.eventSections.has(next)) out().push({ goto: ctx.menuScene() });
        else out().push(...gotoSteps(next));
        return finish(ctx, section, ops, i, out());
      case 54: case 120: {
        w.close('auto'); flow(o);
        out().push(...labelGoto(ctx, o, gotoSteps));
        return finish(ctx, section, ops, i, out());
      }
      case 53: {
        const f = ifFlagArg(a[0]!);
        const flag = ctx.fname(0, f.index);
        const cond = f.want ? flag : `not ${flag}`;
        if (f.label) { hands.put({ if: cond, then: labelGoto(ctx, o, gotoSteps) }, 'structure'); break; }
        // 区画の中の先の位置へ飛ぶ: 間の命令を「条件が合わなければ」のブロックにする（入れ子になっていれば）
        const at = o.target!.offset;
        // 飛び先がこの命令列の終わり（外側のブロックの終わり）なら、残り全部がブロック
        let j = ops.findIndex((x, k) => k > i && x.at >= at);
        if (j < 0 && at > (ops.at(-1)?.at ?? 0)) j = ops.length;
        if (j > i && nested(ops, i, j, at)) {
          w.close('auto'); flow(o);
          const endsAfter = ops[j]?.op === 13 && !nextCond;
          const inner = convertOps(ctx, section, ops.slice(i + 1, j), {
            ...opts, memory: mem, state: { ...w.st }, ...(endsAfter ? { nextAtEnd: next } : { nextAtEnd: undefined }),
          });
          if (inner.length) out().push({ if: f.want ? `not ${flag}` : flag, then: inner });
          i = j - 1;
          break;
        }
        ctx.pieces.add(`${section}:${at}`);
        hands.put({ if: cond, then: [{ goto: ctx.sid(section, at) }] }, 'structure');
        break;
      }
      case 122: hands.put({ if: 'life <= 0', then: labelGoto(ctx, o, gotoSteps) }, 'structure'); break;
      case 8: case 9: {
        w.close('keep'); flow(o);
        out().push(choiceStep(ctx, section, o, opts.gotoSteps ?? ((t: number) => ctx.jump(t, section, 'choice'))));
        return finish(ctx, section, ops, i, out());
      }
      case 63: { // 写真の一点を指す（62 の問題）→ 選択肢で近づける
        w.close('keep'); flow(o);
        out().push(pointChoice(ctx, section, mem.point, gotoSteps));
        return finish(ctx, section, ops, i, out());
      }
      case 17: case 33: {
        const say = w.close('auto', false); flow(o);
        out().push(...demandSteps(ctx, section, say ? say.text.replace(/(\[color white\])+$/, '') : '', say?.speaker ?? null, gotoSteps, o.op === 33));
        return finish(ctx, section, ops, i, out());
      }
      case 116: // 下画面の画面。9 = 指紋などの遊び、10 = 人物の指名（第 5 話）。結果の区画は ARM9 の未解明の表
        if (a[0] === 9 || a[0] === 10) minigame = a[0]!;
        hands.put(native(o.name, a));
        break;
      case 52: // 下画面の画面（セーブ）を待つ。探偵パートでは一日の終わり
        // 第 5 話ではセーブの画面を出すだけで、その後の台本（21 なら探偵メニュー）へそのまま続く
        if (ctx.inv && ctx.part < 17) { dayEnd = true; hands.put(native(o.name, a)); break; }
        hands.put(native(o.name, a));
        break;
      case 21: case 69: case 121:
        w.close('auto');
        if (o.op === 21) {
          const turn = ctx.turnGoto.get(section);
          const lum = turn === undefined ? luminolTutorial(ctx, section, gotoSteps) : null;
          if (turn !== undefined || lum) { flow(o); out().push(...(lum ?? gotoSteps(turn!))); return finish(ctx, section, ops, i, out()); }
        }
        if (o.op === 21 && examineWaitAt(ctx, section)) {
          flow(o);
          st.gap('法廷で 3D の画面を開いて待つ所を、正解のないつきつけの要求にした（証拠品を詳しく調べると進む）', section);
          out().push(EXAMINE_WAIT);
          return finish(ctx, section, ops, i, out());
        }
        // 116 8 n の直後の 21 も、下画面の遊び（字を書くなど）の結果待ち
        { const prev = ops[i - 1]; if (prev && prev.op === 116 && prev.args[0] === 8) minigame = 8; }
        if (minigame !== null && minigameChoice(ctx, section, minigame, gotoSteps, out())) { flow(o); return finish(ctx, section, ops, i, out()); }
        if (opts.menuReturn && o.op !== 121) { flow(o); out().push(...opts.menuReturn); }
        else if (ctx.inv && dayEnd && nextDay(section) !== null) {
          flow(o);
          st.gap('一日の終わりの後に行く場所を推測した（52 wait_ui15 の後）', section);
          out().push({ set: { [ctx.returnFlag()]: false } }, { investigate: ctx.placeId(nextDay(section)!) });
        } else if (ctx.inv && o.op !== 121) { flow(o); out().push(...ctx.menuReturn()); }
        else { flow(o, 'native'); out().push(native(o.name, [])); }
        return finish(ctx, section, ops, i, out());
      case 22: w.close('auto'); flow(o); out().push(...ctx.nextPart); return finish(ctx, section, ops, i, out());
      case 106: { // 次の語（次の命令の番号）の値のパートの台本を読み、その §0 へ（第 5 話の法廷の日の途中の区切り）
        const nx = ops[i + 1];
        if (!nx || nx.op === 'text') { hands.put(native(o.name, a)); break; }
        w.close('auto'); flow(o);
        out().push(...ctx.toPart(nx.op));
        return finish(ctx, section, ops, i, out());
      }
      case 36:
        w.close('auto'); flow(o);
        out().push(ctx.court?.gameover_section === section ? { gameover: true } : { end: true });
        return finish(ctx, section, ops, i, out());
      case 15: case 40: case 41: case 111:
        hands.put(native(o.name, a)); // 証言の外に出てきたときだけ（証言の中は testimony.ts が構造にする）
        break;
      default:
        simpleOp(o, ctx, hands, mem, section);
    }
  }
  w.close('auto');
  // 53 のブロックの中で次の区画を決めたなら、ブロックの最後でそこへ（ブロックのすぐ後が区画の終わり）
  if (opts.nextAtEnd !== undefined && (next !== opts.nextAtEnd || nextCond)) {
    if (nextCond) out().push({ if: nextCond.flag, then: gotoSteps(nextCond.a), else: gotoSteps(nextCond.b) });
    else out().push(...gotoSteps(next));
  }
  return out();
}

/** 流れが終わった後の命令は数えるだけ */
function finish(ctx: Context, _section: number, ops: Op[], i: number, out: Step[]): Step[] {
  for (const o of ops.slice(i + 1)) ctx.stats.hit(o.op === 'text' ? 'text' : o.name, 'ignored');
  return out;
}

/** ラベルへの移動。区画の途中のラベルは「区画_位置」のシーン */
function labelGoto(ctx: Context, o: CmdOp, gotoSteps: (t: number) => Step[]): Step[] {
  const t = o.target;
  if (!t || t.section === null) return [native(o.name, o.args)];
  if (t.offset <= 2) return gotoSteps(t.section);
  ctx.referenced.add(t.section);
  ctx.pieces.add(`${t.section}:${t.offset}`);
  return [{ goto: ctx.sid(t.section, t.offset) }];
}

/**
 * DS 版の下画面の遊び（116 8 / 9 / 10）の結果を、続く「どこからも行き先にならない区画」から選ぶ選択肢にする（近似）。
 * 選択肢の文はその区画の最初の文。作れたら true
 */
function minigameChoice(ctx: Context, section: number, kind: number, gotoSteps: (t: number) => Step[], out: Step[]): boolean {
  const orphans = orphanSections(ctx.entry, ctx.tableRefs());
  const picks: number[] = [];
  // 人物の指名: 次の区画が外れ（ペナルティ）、外れから落ちていく区画の次が正解（flow.ts の nominationResults）。
  // 探偵パート（056 §40）も同じ。続く区画から選ぶと、話題の区画（§44）まで結果にしてしまい、話題の切り替えが狂って詰む
  if (kind === 10) picks.push(...nominationResults(ctx.entry, section));
  else {
    // 続く区画のうち、どこからも来ない区画（遊びの結果）。表の行き先や、次の遊びの区画まで（間の区画は飛ばす）
    const refs = ctx.tableRefs(true);
    // 次の遊びの始まり: 21 / 121 で待つ直前の 116 が 8 / 9 / 10（結果の区画の中の 116 8 n → 116 5 → 21 は含めない）
    const game = (s: number) => {
      const ops = ctx.entry.body[s]!.ops.filter((o): o is CmdOp => o.op !== 'text');
      const w = ops.findIndex(o => o.op === 21 || o.op === 121);
      const last = ops.slice(0, w < 0 ? ops.length : w).findLast(o => o.op === 116);
      return !!last && [8, 9, 10].includes(last.args[0]!);
    };
    for (let s = section + 1; ctx.entry.body[s] && picks.length < 8 && s <= section + 12; s++) {
      if (game(s)) break;
      // 表の行き先（つきつけの要求・尋問など）に着いたら、それも結果の 1 つにして終わる（映像の遊びの正解が尋問へ続くときなど）
      if (refs.has(s)) { picks.push(s); break; }
      if (orphans.has(s)) picks.push(s);
    }
  }
  if (!picks.length) return false;
  ctx.stats.gap(kind === 10 ? '人物の指名（116 10、第 5 話）を選択肢にした'
    : kind === 9 ? '指紋などの遊び（116 9、第 5 話）の結果を選択肢にした' : '下画面の遊び（116 8、映像・字を書くなど）の結果を選択肢にした', section);
  const label = (s: number) => {
    const t = ctx.entry.body[s]!.ops.find(o => o.op === 'text');
    return `（${t && t.op === 'text' ? t.text.slice(0, 14) : `結果 ${s}`}）`;
  };
  out.push({ choice: picks.map(s => ({ text: label(s), then: gotoSteps(s) })) });
  return true;
}

/** 四角形の位置の言い方（画面の左上など） */
export function whereOf(quad: number[][]): string {
  const cx = quad.reduce((a, p) => a + p[0]!, 0) / quad.length, cy = quad.reduce((a, p) => a + p[1]!, 0) / quad.length;
  const h = cx < 86 ? '左' : cx < 171 ? '中央' : '右';
  const v = cy < 64 ? '上' : cy < 128 ? '' : '下';
  return h === '中央' && !v ? 'まん中' : `${h}${v}`;
}

/** 63 写真の一点を指す: 正解の 2 つの四角形と外れを、選択肢にする */
function pointChoice(ctx: Context, section: number, k: number | null, gotoSteps: (t: number) => Step[]): Step {
  const p = ctx.t.courtPoints?.find(x => x.id === k);
  ctx.stats.gap('写真の一点を指す（62/63）を選択肢にした', section);
  if (!p) return { native: 'examine_wait', args: [k ?? -1] };
  const opts: { text: string; then: Step[] }[] = [];
  if (p.section_a.section !== p.miss.section) opts.push({ text: `${whereOf(p.quad_a)}を指す`, then: gotoSteps(p.section_a.section) });
  if (p.section_b.section !== p.miss.section && p.section_b.section !== p.section_a.section) {
    opts.push({ text: `${whereOf(p.quad_b)}を指す`, then: gotoSteps(p.section_b.section) });
  }
  opts.push({ text: 'ほかの所を指す', then: gotoSteps(p.miss.section) });
  return { choice: opts };
}

/** 8 / 9 選択肢。文は下画面のボタンの絵を文字認識したもの（script_json.py --ocr） */
function choiceStep(ctx: Context, section: number, o: CmdOp, gotoSteps: (t: number) => Step[]): Step {
  const texts = ctx.entry.choices?.[String(section)]?.text ?? [];
  if (texts.length === 0) ctx.stats.gap('選択肢の文が無い（script_json.py --ocr で読む）', section);
  const targets = (o.targets ?? []).map((t, k) => t?.section ?? o.args[k]! - 128);
  return {
    choice: targets.map((t, k) => ({ text: texts[k] ?? `選択肢 ${k + 1}`, then: gotoSteps(t) })),
  };
}

/**
 * 17 / 33 つきつけの要求。正解の表と外れの区画は court.json の present_requests。
 * 外れの区画は、最後に同じ要求へ戻るなら demand の wrong（もう一度求める）、別の所へ行くならその goto を付ける
 */
function demandSteps(
  ctx: Context, section: number, prompt: string, by: string | null, gotoSteps: (t: number) => Step[], life: boolean,
): Step[] {
  const req = ctx.court?.present_requests.find(r => r.section === section);
  if (!req) {
    ctx.stats.gap('つきつけの要求の表が無い', section);
    return [native(life ? 'present_life' : 'present', [])];
  }
  if (!life) ctx.stats.gap('体力ゲージを出さないつきつけ（17 present）', section);
  const present: Record<string, Step[]> = {};
  for (const c of req.correct) {
    if (c.flag !== null) ctx.stats.gap('フラグつきの正解（つきつけの表）', section);
    // 人物ファイルが正解なら人物 ID をキーにする（YAML では、それで人物ファイルもつきつけられる要求になる）
    present[ctx.shared.profileRecords.has(c.item) ? ctx.profile(c.item) : ctx.evidenceId(c.item)] = gotoSteps(c.goto);
  }
  const wrongSec = ctx.entry.body[req.wrong];
  const wrong = wrongSec
    ? convertOps(ctx, req.wrong, wrongSec.ops, { gotoSteps: t => (t === section ? [] : gotoSteps(t)) })
    : [];
  ctx.consumed.add(req.wrong);
  return [{ demand: prompt, ...(by ? { by } : {}), present, wrong }];
}
