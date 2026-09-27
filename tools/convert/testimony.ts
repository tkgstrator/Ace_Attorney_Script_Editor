// 証言と尋問（court.json の cross_examinations）を、YAML の証言シーンにする。
//
// 元の台本の形（第 1 話 §25〜§58）:
//   T 証言のタイトル → R 証言の文（1 区画 1 文、読むだけ）→ A 会話 → C 尋問のタイトル
//   → S 尋問の文（21 で操作を渡す）… → L 最後の文の後（助言）→ S の最初へ
//   P ゆさぶり（15 の区画）、つきつけの正解は court.json の表、外れは共通の台本 §45〜48 から乱数で 1 つ。
// YAML の証言シーンでは、証言（読む）と尋問が同じ文を使うので、R は捨てて S の文を使う（ずれとして数える）。
// T は「証言開始」の前のシーン（sT）にし、その終わりで証言シーン（tC）へ移る。A と C は after、L は loop。
import { commandSchemas } from '../../packages/script/src/schema.ts';
import type { Context } from './context.ts';
import { native, stripTilde } from './mapping.ts';
import { newMemory } from './ops.ts';
import { localClosure, statementRoutes } from './flow.ts';
import { convertOps } from './section.ts';
import type { CourtPart, Entry, Step } from './types.ts';

type Cross = CourtPart['cross_examinations'][number];

/** ステップのコマンド名（これ以外の 1 つの鍵は `人物: 文` の省略形） */
const COMMANDS = new Set(Object.keys(commandSchemas));

/** 台詞のステップか（省略形 `人物: 文` も含む） */
export const isSayStep = (s: Step): boolean => sayOf(s) !== null || 'card' in s;

/** 台詞のステップ → (話し手, 文) */
function sayOf(s: Step): { who: string | null; text: string } | null {
  if ('say' in s) return { who: s.say as string | null, text: s.text as string };
  if ('narrate' in s) return { who: null, text: s.narrate as string };
  const k = Object.keys(s);
  if (k.length === 1 && !COMMANDS.has(k[0]!)) return { who: k[0]!, text: s[k[0]!] as string };
  return null;
}

export interface BuiltTestimony { id: string; scene: Record<string, unknown> }

/** 共通の台本（項目 072/073）の外れの区画から、乱数で 1 つを選ぶ wrong にする（元のゲームと同じ） */
function commonWrong(ctx: Context, common: Entry | null): Step[] {
  const secs = ctx.t.court.common_wrong.map(w => w.section);
  if (!common || secs.length === 0) return [native('common_wrong', secs)];
  const bodies = secs.map(s => convertOps(ctx, s, common.body[s]!.ops, { gotoSteps: () => [], structural: new Set([15, 41]) }));
  return [{ random: bodies }];
}

export function buildTestimonies(ctx: Context, common: Entry | null): Map<number, BuiltTestimony> {
  const court = ctx.court;
  const out = new Map<number, BuiltTestimony>();
  if (!court) return out;
  const wrongChain = commonWrong(ctx, common);
  const body = (s: number) => ctx.entry.body[s]?.ops ?? [];
  // 文の無い尋問（表の読み違い）は扱わない
  const crosses = court.cross_examinations.filter(x => x.statements.length > 0);
  // どの尋問の区画（タイトル・読む・文・助言）にも入らない、ゆさぶり・助言から続く枝は、その尋問のブロックに取り込む
  const stop = new Set<number>();
  for (const x of crosses) {
    const reading = x.testimony === null ? [] : court.testimonies.find(t => t.section === x.testimony)?.statements ?? [];
    [x.section, x.after_last, ...(x.testimony === null ? [] : [x.testimony]), ...reading, ...x.statements.map(s => s.section)]
      .forEach(v => stop.add(v));
  }
  // 証言（読む）のタイトルの区画 T: 尋問の区画 C 自身に「証言開始」（40 1）があれば C、なければ court.json の testimony
  // （ほかの尋問の C ではなく、まだどの尋問も使っていないもの）。同じ T を 2 つ目の尋問が使うなら読まない
  const crossSecs = new Set(crosses.map(x => x.section));
  const hasMark = (sec: number) => body(sec).some(o => o.op === 40 && o.args[0] === 1);
  const claimedT = new Set<number>();
  const plan = crosses.map(x => {
    let T: number | null = null;
    if (hasMark(x.section)) T = x.section;
    else if (x.testimony !== null && !crossSecs.has(x.testimony) && !claimedT.has(x.testimony)) T = x.testimony;
    if (T !== null) claimedT.add(T);
    const reading = T === null ? [] : T === x.section ? [T] : [T, ...(court.testimonies.find(t => t.section === T)?.statements ?? [])];
    return { x, T, reading };
  });
  // 先に、取り込む区画と行き先の付け替えを全部決める（ほかの尋問から C へ飛ぶことがあるため）
  for (const { x, T, reading } of plan) {
    for (const s of [...reading.slice(1), x.section, ...x.statements.map(v => v.section), x.after_last,
      ...x.statements.flatMap(v => (v.press === null ? [] : [v.press]))]) {
      if (s !== T) ctx.consumed.add(s);
    }
    ctx.redirect.set(x.section, T === x.section ? ctx.sid(x.section) : ctx.tid(x.section));
    // 尋問の文・助言へ外から戻るとき（「証言に戻ってもらいます」など）は、証言シーンへ（ずれ: 証言開始からやり直す）
    for (const v of [...x.statements.map(q => q.section), x.after_last]) if (!ctx.redirect.has(v)) ctx.redirect.set(v, ctx.tid(x.section));
  }
  for (const { x, reading } of plan) {
    const S = x.statements.map(v => v.section);
    const starts = [...reading, x.after_last, ...x.statements.flatMap(v => (v.press === null ? [] : [v.press]))];
    const local = localClosure(ctx.entry, starts, stop);
    local.forEach(v => ctx.consumed.add(v));
    out.set(x.section, { id: ctx.tid(x.section), scene: buildOne(ctx, x, reading, S, wrongChain, body, local) });
  }
  return out;
}

/** 尋問の文の前に実行できる（止まらない）命令 */
const BEFORE_KEYS = new Set(['show', 'location', 'bgm', 'se', 'shake', 'flash', 'set', 'add', 'give', 'take', 'giveProfile',
  'takeProfile', 'showEvidence', 'textbox', 'ui', 'bgmPause']);

/** ステップの中に goto があるか */
const hasGoto = (s: unknown): boolean => JSON.stringify(s).includes('"goto"');

function buildOne(
  ctx: Context, x: Cross, reading: number[], S: number[], wrongChain: Step[], body: (s: number) => CmdOps,
  local: Set<number>,
): Record<string, unknown> {
  const st = ctx.stats;
  const inlining: number[] = [];
  /** 証言の中へ戻る移動（同じ文なら resume: stay、ほかの文・助言なら空 = エンジンが次の文へ）。取り込む枝はその場に */
  const back = (from: number | null) => (t: number): Step[] => {
    if (from !== null && t === from) return [{ resume: 'stay' }];
    if (S.includes(t) || t === x.after_last || t === x.section) return [];
    if (local.has(t) && !inlining.includes(t)) {
      inlining.push(t);
      try { return convertOps(ctx, t, body(t), { gotoSteps: back(from), structural: new Set([41]) }); } finally { inlining.pop(); }
    }
    return ctx.jump(t, from ?? x.section);
  };
  // 証言（読む）と、その後（40 0 の後）。T の「証言開始」の前は証言の前のシーン（sT）にする
  const { pre, readingOps, tailOps } = splitReading(reading, body);
  if (reading[0] !== undefined) {
    ctx.preScenes.set(reading[0], [...convertOps(ctx, reading[0], pre, { dropCards: true, gotoSteps: () => [] }), { goto: ctx.tid(x.section) }]);
  }
  const readingSteps = readingOps.flatMap(([r, ops]) => convertOps(ctx, r, ops, { gotoSteps: () => [], structural: new Set([40]) }));
  const tailSteps = tailOps
    ? convertOps(ctx, tailOps[0], tailOps[1], { dropCards: tailOps[0] === x.section, gotoSteps: back(null), structural: new Set([40, 41, 111]) })
    : [];

  const statements: Record<string, unknown>[] = [];
  /** 文に入ったときのフラグの分岐（53 のラベルへの飛び）。ゆさぶり・助言の終わりで調べる（ずれ） */
  const entryChecks: Step[] = [];
  let witness = '';
  let pose: { id: string; talk: number; idle: number } | null = null;
  const blocks: Step[][] = [];
  // 文の並びと出る条件（42 でフラグにより分かれる尋問）
  const routes = statementRoutes(x.statements);
  const ordered = routes.order.map(sec => x.statements.find(v => v.section === sec)!);
  // 文の区画の中に「フラグが立っていれば区画の途中へ」（53 のラベル）があれば、その前と後を別の文にする
  // （ゆさぶりの後に言い直す文など）。後の文はフラグが立っているとき、前の文は立っていないときに出る
  const variants = ordered.flatMap(s => statementVariants(ctx, s.section, body(s.section)).map(v => ({ s, ...v })));
  variants.forEach((v, k) => {
    const s = v.s;
    const mem = newMemory();
    // フラグで行き先の変わるゆさぶりの 53 は、ゆさぶりのブロックで表す（文の分岐にしない）
    const alt = flagPress(v.ops);
    const ops = alt ? v.ops.filter(o => !(o.op === 53 && alt.jumps.includes(o.at))) : v.ops;
    const steps = convertOps(ctx, s.section, ops, {
      statement: true, gotoSteps: back(null), structural: new Set([15, 41]), memory: mem,
    });
    const say = steps.map(sayOf).find(x => x !== null);
    if (k === 0) pose = mem.char;
    if (say?.who && !witness) witness = say.who;
    const before = steps.filter(x => sayOf(x) === null && Object.keys(x).some(key => BEFORE_KEYS.has(key)));
    const checks = steps.filter(x => 'if' in x && hasGoto(x));
    if (checks.length) {
      st.gap('尋問の文に入ったときのフラグの分岐を、ゆさぶり・助言の終わりで調べる', s.section);
      entryChecks.push(...checks);
    }
    const st1: Record<string, unknown> = { id: `s${s.section}${v.at ? `_${v.at}` : ''}`, text: say?.text ?? s.text };
    const cond = routes.when.get(s.section);
    const whens: string[] = [];
    if (cond) {
      whens.push(cond.map(c => Object.entries(c).map(([f, val]) => (val ? ctx.fname(0, Number(f)) : `not ${ctx.fname(0, Number(f))}`)).join(' and '))
        .map((w, _i, all) => (all.length > 1 ? `(${w})` : w)).join(' or '));
    }
    if (v.when) whens.push(v.when);
    if (whens.length) st1.when = whens.map(w => (whens.length > 1 && / or /.test(w) ? `(${w})` : w)).join(' and ');
    if (before.length) st1.before = before;
    const press = v.press ?? s.press;
    const pressBlock = (p: number) => convertOps(ctx, p, body(p), { gotoSteps: back(s.section), structural: new Set([41]) });
    if (alt) {
      // フラグで行き先の変わるゆさぶり（53 で 2 つ目の 15 へ飛ぶ）
      st.gap('フラグで行き先の変わるゆさぶり（15 が 2 つ）', s.section);
      const a = pressBlock(alt.a), b = pressBlock(alt.b);
      blocks.push(a, b);
      st1.press = [{ if: ctx.fname(0, alt.flag), then: alt.want ? b : a, else: alt.want ? a : b }];
    } else if (press !== null) {
      const block = pressBlock(press);
      blocks.push(block);
      st1.press = block;
    }
    // フラグつきの正解は、その条件の文にだけ付ける
    const sameFlag = (p: { flag: number | null }) => v.flag !== null && p.flag === v.flag.index;
    const presents = s.present.filter(p => !sameFlag(p) || v.flag!.want);
    if (presents.length > 0) {
      st1.present = Object.fromEntries(presents.map(p => {
        const go = ctx.jump(p.goto, s.section);
        const steps = p.flag === null || sameFlag(p) ? go : [{ if: ctx.fname(0, p.flag), then: go, else: [...wrongChain, ...poseStep()] }];
        return [ctx.evidenceId(p.item), steps];
      }));
    }
    statements.push(st1);
  });
  function poseStep(): Step[] {
    const p = pose as { id: string; talk: number; idle: number } | null;
    return p ? [{ show: p.id, talk: p.talk, ...(p.idle !== p.talk ? { idle: p.idle } : {}) }] : [];
  }
  if (!witness) witness = ctx.speaker(2)!;
  // 尋問の区画 C（読むと同じ区画なら、40 0 の後にすでに入っている）
  const afterSteps = [
    ...tailSteps,
    ...(reading[0] === x.section ? [] : convertOps(ctx, x.section, body(x.section), { dropCards: true, gotoSteps: back(null), structural: new Set([41, 111]) })),
  ];
  const loop = convertOps(ctx, x.after_last, body(x.after_last), { gotoSteps: back(null), structural: new Set([41]) });
  blocks.push(loop);
  // 文に入ったときの分岐は、各ブロックの終わり（証言に戻る前）に置く
  if (entryChecks.length) {
    for (const b of blocks) {
      const i = b.findIndex(v => 'resume' in v);
      b.splice(i < 0 ? b.length : i, 0, ...entryChecks);
    }
  }
  const scene: Record<string, unknown> = { testimony: stripTilde(x.title), witness };
  if (readingSteps.length) scene.reading = readingSteps;
  scene.statements = statements;
  if (afterSteps.length) scene.after = afterSteps;
  if (loop.length) scene.loop = loop;
  scene.wrong = [...wrongChain, ...poseStep()];
  return scene;
}

type CmdOps = Entry['body'][number]['ops'];

/**
 * 文の区画に 15（ゆさぶる先）が 2 つあり、1 つ目の前の 53 が 2 つ目の 15 へ飛ぶ形（例: 042 §12 = フラグ 50 が立っていれば §31）。
 * a = 飛ばないときのゆさぶり、b = 飛んだとき。flag / want = 53 の条件
 */
export function flagPress(ops: CmdOps): { a: number; b: number; flag: number; want: boolean; jumps: number[] } | null {
  const presses = ops.flatMap((o, i) => (o.op === 15 ? [i] : []));
  if (presses.length !== 2) return null;
  const [i, j] = presses as [number, number];
  const jump = ops.slice(0, i).find(o => o.op === 53 && !(o.args[0]! & 0x80) && o.target?.offset === ops[j]!.at);
  const sec = (o: CmdOps[number]) => (o.op === 'text' ? -1 : o.targets?.[0]?.section ?? o.args[0]! - 128);
  if (!jump || jump.op === 'text') return null;
  // 2 つの 15 の間の、2 つ目を飛び越す 53 も（「立っていなければ文へ」）
  const jumps = ops.slice(0, j).filter(o => o.op === 53 && !(o.args[0]! & 0x80)).map(o => o.at);
  return { a: sec(ops[i]!), b: sec(ops[j]!), flag: jump.args[0]! >> 8, want: (jump.args[0]! & 1) === 1, jumps };
}

/** 尋問の文の区画の、言い直しの前後（53 のラベルで同じ区画の途中へ飛ぶもの） */
interface Variant { ops: CmdOps; at: number; when: string | null; flag: { index: number; want: boolean } | null; press: number | null }

export function statementVariants(ctx: Context, section: number, ops: CmdOps): Variant[] {
  const k = ops.findIndex(o => o.op === 53 && o.target?.section === section && (o.target?.offset ?? 0) > 2);
  const pressOf = (xs: CmdOps) => {
    const p = xs.find(o => o.op === 15);
    return p && p.op !== 'text' ? p.targets?.[0]?.section ?? p.args[0]! - 128 : null;
  };
  if (k < 0) return [{ ops, at: 0, when: null, flag: null, press: null }];
  const o = ops[k]!;
  if (o.op === 'text') return [{ ops, at: 0, when: null, flag: null, press: null }];
  const index = o.args[0]! >> 8, want = (o.args[0]! & 1) === 1;
  const at = o.target!.offset;
  const flag = ctx.fname(0, index);
  const cond = want ? flag : `not ${flag}`;
  const first = ops.filter((x, i) => i !== k && x.at < at);
  const second = [ops[0]!, ...ops.filter(x => x.at >= at)];
  ctx.stats.gap('尋問の文の言い直し（区画の途中へのラベル）を 2 つの文にした', section);
  return [
    { ops: first, at: 0, when: want ? `not ${flag}` : flag, flag: { index, want: !want }, press: pressOf(first) },
    { ops: second, at, when: cond, flag: { index, want }, press: pressOf(second) },
  ];
}

/**
 * 証言の区画を分ける: pre = T の「証言開始」（40 1）とタイトルのページまで、readingOps = そこから 40 0 まで（区画ごと）、
 * tailOps = 40 0 の後（その区画の残り）
 */
export function splitReading(reading: number[], body: (s: number) => CmdOps) {
  const pre: CmdOps = [];
  const readingOps: [number, CmdOps][] = [];
  let tailOps: [number, CmdOps] | null = null;
  let phase: 'pre' | 'title' | 'read' | 'tail' = 'pre';
  for (const r of reading) {
    const cur: CmdOps = [];
    for (const o of body(r)) {
      if (phase === 'tail') { tailOps![1].push(o); continue; }
      if (o.op === 40 && o.args[0] === 1 && phase === 'pre') { phase = 'title'; continue; }
      if (o.op === 40 && o.args[0] === 0) { phase = 'tail'; tailOps = [r, []]; continue; }
      if (phase === 'pre' || phase === 'title') {
        pre.push(o);
        if (phase === 'title' && (o.op === 2 || o.op === 45)) phase = 'read';
        continue;
      }
      cur.push(o);
    }
    if (cur.length) readingOps.push([r, cur]);
  }
  return { pre, readingOps, tailOps };
}

