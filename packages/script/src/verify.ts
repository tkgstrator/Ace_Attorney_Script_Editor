// シナリオの整合性チェック。エンジンで選べる操作をすべて試し、たどり着ける状態を網羅して調べる。
//
// - ライフは減らないものとして調べる（ライフが尽きてのゲームオーバーは正しい動きなので除く）。
//   それでも終わり（end か、シナリオに書いた gameover）にたどり着けない状態は「詰み」。
//   詰みに入る最初の場面を報告する（例: 探索編で手に入らない証拠品を、先に進む条件にしている）
// - どう遊んでもクリア（end）にたどり着けないときも報告する
// - 一度も到達しないシーン・場所・「調べる」「話す」を報告する
// - 乱数で飛ぶ所（random）は、すべての行き先を試す
//
// 状態が増えすぎないよう、次の工夫をしている。どれも近似ではなく、詰み・到達しないものの判定は変わらない。
// - この先の動きに関係しない違い（表示・ライフ・もう読まれないフラグ・値によらない条件の変数）は見分けない
//   （verify-key.ts・verify-flow.ts・verify-region.ts）
// - 文章送りしかできない場面は状態として持たず、選ぶ場面までまとめて進める（step）
// - 見当違いのつきつけは 1 つだけ試す（証拠品から。証拠品がすべて正解なら人物ファイルから）。「調べる」は結果が変わりうる点だけを試す
// - 証拠品を詳しく調べるのは、状態を変えうる場所だけを、選ぶところまで 1 つの操作として試す（verify-inspect.ts）。
//   台詞・証言を聞く途中では、後に回せない・試すと状態が変わる場所があるときだけ止まって試す（verify-inspect-sim.ts）
// - 同じ場面で同じ操作をして、実行中に読んだ変数の値も同じなら、覚えておいた結果を使う（verify-memo.ts）
// - 展開し終えた状態は捨て、キーと番号・辺だけを持つ（詰みの説明は、操作をたどり直して作る）
import {
  type Beat,
  type CompiledScenario,
  Engine,
  type Expr,
  type GameState,
  holds,
  recordName,
} from '@gyakusai/core';
import { actions, step } from './verify-actions.ts';
import { analyzeFlow } from './verify-flow.ts';
import { Graph, IntList, traps } from './verify-graph.ts';
import { flagBounds, keyMaker, prepare } from './verify-key.ts';
import { apply, Memo, Recorder } from './verify-memo.ts';
import { packer } from './verify-pack.ts';

export interface Finding {
  severity: 'error' | 'warning';
  message: string;
  /** 関係するシーン・場所の ID */
  scene?: string;
}

export interface VerifyResult {
  findings: Finding[];
  /** 調べた状態の数 */
  states: number;
  /** 状態が多すぎて途中で打ち切ったか */
  truncated: boolean;
}

export interface VerifyOptions {
  /** 調べる状態の数の上限（既定 DEFAULT_LIMIT） */
  limit?: number;
  /** 途中経過（調べた状態の数）を、およそ every 個ごとに知らせる */
  onProgress?: (states: number) => void;
  progressEvery?: number;
  /** false にすると、生きている変数だけをキーに入れる工夫をやめる（結果が変わらないことの確かめ用。遅い） */
  liveness?: boolean;
  /** false にすると、操作の結果のメモを使わない（確かめ用） */
  memo?: boolean;
}

const IMMORTAL = 1e9;
export const DEFAULT_LIMIT = 3_000_000;
/** 展開を待つ状態がこれより多いときは、詰めて持つ */
const PACK_ABOVE = 10_000;

/** 操作を始める場面（メモの見分けに使う） */
function control(s: GameState): string {
  const f = s.inspectFrom;
  const back = f ? `${f.scene}:${f.pc}:${f.mode}:${f.phase ?? ''}:${f.statement ?? ''}` : '';
  return `${s.scene}\u0003${s.pc}\u0003${s.mode}\u0003${s.phase}\u0003${s.statement}\u0003${back}\u0003`;
}

/**
 * 条件式で、ライフを小さな数との比べ以外に使っているか。
 * 調べるときのライフは IMMORTAL から減るだけなので、小さな数との比べ（life <= 0 など）は結果が変わらない
 */
function usesLife(sc: CompiledScenario): boolean {
  let bad = false;
  const small = (e: Expr) =>
    e.t === 'lit' && typeof e.v === 'number' && Math.abs(e.v) < IMMORTAL / 10;
  const walk = (e: Expr | undefined): void => {
    if (!e) return;
    if (e.t === 'var' && e.name === 'life') bad = true;
    if (e.t === 'not') walk(e.e);
    if (e.t === 'bin') {
      const isLife = (x: Expr) => x.t === 'var' && x.name === 'life';
      if ((isLife(e.l) && small(e.r)) || (isLife(e.r) && small(e.l))) return;
      walk(e.l);
      walk(e.r);
    }
  };
  for (const scene of Object.values(sc.scenes)) {
    for (const ins of scene.program) {
      if (ins.op === 'jumpUnless') walk(ins.cond);
      if (ins.op === 'choice')
        ins.options.forEach((o) => {
          walk(o.when);
        });
    }
    if (scene.kind === 'testimony')
      scene.statements.forEach((st) => {
        walk(st.when);
      });
    if (scene.kind === 'place')
      [...scene.person, ...scene.move, ...scene.talk, ...scene.examine].forEach((x) => {
        walk(x.when);
      });
  }
  return bad;
}

/** 詰みの場面の説明（何を求められていて、何が足りないか） */
function describe(sc: CompiledScenario, e: Engine, b: Beat): string {
  const s = e.state;
  const held = new Set(s.evidence);
  const name = (id: string) => sc.evidence[id]?.name ?? id;
  const missing = (ids: string[]) => ids.filter((id) => !held.has(id)).map(name);
  const scene = sc.scenes[s.scene];
  if (b.kind === 'demand') {
    const ins = scene?.program[s.pc];
    // 正解は証拠品・人物ファイルの順
    const answers =
      ins?.op === 'demand'
        ? [
            ...Object.keys(ins.options).map((id) => [id, 'evidence'] as const),
            ...Object.keys(ins.profiles ?? {}).map((id) => [id, 'profile'] as const),
          ]
        : [];
    const lack = answers.filter(([id, k]) => !holds(sc, s, id, k));
    const names = (list: typeof answers) => list.map(([id, k]) => recordName(sc, id, k)).join('・');
    return (
      `つきつけの要求「${b.prompt}」の正解（${names(answers)}）を持っていません` +
      (lack.length === answers.length ? '' : `（持っていない: ${names(lack)}）`)
    );
  }
  if (scene?.kind === 'testimony') {
    const answers = [...new Set(scene.statements.flatMap((st) => Object.keys(st.present)))];
    return `尋問「${scene.title}」から先へ進めません（つきつけで使う ${answers.map(name).join('・')} のうち、持っていない: ${missing(answers).join('・') || 'なし'}）`;
  }
  if (b.kind === 'investigate')
    return `探索編の「${b.name}」から先へ進めません（移動先・話題・調べる所の条件を満たせない可能性）`;
  return `シーン「${s.scene}」から先へ進めません（${b.kind}）`;
}

/** 詰みの説明に使う場面の優先度（小さいほど、プレイヤーが止まっている理由を表しやすい） */
function rank(b: Beat): number {
  return b.kind === 'demand'
    ? 0
    : b.kind === 'statement'
      ? 1
      : b.kind === 'investigate'
        ? 2
        : b.kind === 'choice'
          ? 3
          : 4;
}

export function verifyScenario(scenario: CompiledScenario, opts: VerifyOptions = {}): VerifyResult {
  const sc: CompiledScenario = prepare({ ...scenario, maxLife: IMMORTAL });
  const limit = opts.limit ?? DEFAULT_LIMIT;
  const flow = analyzeFlow(sc, { all: opts.liveness === false });
  const keyOf = keyMaker(sc, flow, flagBounds(sc));
  const load = (state: GameState) => new Engine(sc, { version: 1, scenario: sc.id, state });
  // ライフを読む条件があると、ライフの値（キーに入れない）で結果が変わりうるので、操作の結果のメモを使わない
  const memo = opts.memo === false || usesLife(sc) ? undefined : new Memo();

  // 状態は見つけた順に番号を付け、深さ優先で展開する（展開を待つ状態が少なくて済む）。展開し終えた状態の中身は捨て、
  // 詰みの説明に要るときは、最初の状態から操作をたどり直して作る（parent・via）
  const ids = new Map<string, number>();
  // 展開を待つ状態が多いときは、小さな文字列に詰めて持つ（verify-pack.ts）
  const pending: (GameState | string | undefined)[] = [];
  const { pack, unpack } = packer(sc);
  const stack = new IntList();
  const parent = new IntList(),
    via = new IntList();
  const ranks = new IntList();
  const graph = new Graph();
  const goals = new Set<number>();
  const visitedScenes = new Set<string>();
  const seenIds = new Set<string>();
  const findings: Finding[] = [];
  const crashes = new Set<string>();
  let cleared = false;
  let truncated = false;

  /** 状態を見つけたときの番号。新しい状態なら、make で本物の状態を作って展開を待つ列に入れる */
  const found = (k: string, from: number, act: number, make: () => GameState): number => {
    let id = ids.get(k);
    if (id === undefined) {
      id = ids.size;
      ids.set(k, id);
      pending[id] = stack.length > PACK_ABOVE ? pack(make()) : make();
      stack.push(id);
      parent.push(from);
      via.push(act);
    }
    return id;
  };
  const first = new Engine(sc);
  first.state.visited.forEach((v) => {
    visitedScenes.add(v);
  });
  visitedScenes.add(first.state.scene);
  found(keyOf(first.state as GameState), -1, -1, () => first.state as GameState);

  let processed = 0;
  while (stack.length > 0) {
    if (processed >= limit) {
      truncated = true;
      break;
    }
    if (opts.onProgress && processed % (opts.progressEvery ?? 100_000) === 0)
      opts.onProgress(processed);
    processed++;
    const i = stack.at(--stack.length);
    const held = pending[i]!;
    const state = typeof held === 'string' ? unpack(held) : held;
    pending[i] = undefined;
    const e = load(state);
    graph.open(i);
    ranks.set(i, rank(e.beat));
    if (e.beat.kind === 'end' || e.beat.kind === 'gameover') {
      goals.add(i);
      if (e.beat.kind === 'end') cleared = true;
      continue;
    }
    const acts = actions(sc, e, visitedScenes);
    const where = control(state);
    acts.forEach((act, a) => {
      // 同じ場面で同じ操作をして、読んだ変数の値も同じなら、覚えておいた結果を使う（verify-memo.ts）
      let d = memo?.get(where + act.d, state);
      let next: GameState | undefined;
      if (!d) {
        // 最後の操作は、操作を選ぶのに使ったエンジンをそのまま使う（状態の複製を 1 回減らす）
        const x = a === acts.length - 1 ? e : load(state);
        const rec = memo && new Recorder();
        rec?.attach(x.state as GameState);
        try {
          step(flow, x, act.f, visitedScenes);
        } catch (err) {
          const msg = `実行中にエラーになりました: ${(err as Error).message}`;
          if (!crashes.has(msg)) {
            crashes.add(msg);
            findings.push({ severity: 'error', message: msg, scene: state.scene });
          }
          return;
        }
        next = x.state as GameState;
        if (rec) {
          d = rec.finish(next);
          if (!rec.unknown) memo!.set(where + act.d, rec.reads, d);
        }
      }
      // 通ったシーン・調べた印を記録する（途中で止まらずに通り過ぎたシーンも、visited に残る）。
      // 見つけたときに記録するのは、キーが同じで展開しない状態の通り道も数えるため
      if (next) {
        for (let j = state.visited.length; j < next.visited.length; j++)
          visitedScenes.add(next.visited[j]!);
        for (let j = state.seen.length; j < next.seen.length; j++) seenIds.add(next.seen[j]!);
        visitedScenes.add(next.scene);
      } else {
        d!.visited.forEach((v) => {
          visitedScenes.add(v);
        });
        d!.seen.forEach((v) => {
          seenIds.add(v);
        });
        visitedScenes.add(d!.control.scene);
      }
      const k = next ? keyOf(next) : keyOf(state, d);
      graph.add(
        i,
        found(k, i, a, () => next ?? apply(state, d!)),
      );
    });
  }
  const states = truncated ? processed : ids.size;

  /** 状態 id を、最初の状態から操作をたどり直して作る */
  const rebuild = (id: number): Engine => {
    const path: number[] = [];
    for (let x = id; parent.at(x) >= 0; x = parent.at(x)) path.push(via.at(x));
    const e = new Engine(sc);
    for (const a of path.reverse()) step(flow, e, actions(sc, e)[a]!.f);
    return e;
  };

  if (!truncated) {
    if (!cleared)
      findings.push({ severity: 'error', message: 'どう遊んでもクリア（end）にたどり着けません' });
    // 詰み: 抜け出せない状態のかたまり（出ていく先がなく、終わりでもない強連結成分）ごとに、判断の場面を 1 つ報告する
    const reported = new Set<string>();
    for (const trap of traps(graph, ids.size, (v) => goals.has(v))) {
      const best = trap.reduce((a, b) => (ranks.at(b) < ranks.at(a) ? b : a));
      const pick = rebuild(best);
      const where = `${pick.state.scene}:${pick.beat.kind}`;
      if (reported.has(where)) continue;
      reported.add(where);
      findings.push({
        severity: 'error',
        message: `詰み: ${describe(sc, pick, pick.beat)}`,
        scene: pick.state.scene,
      });
    }

    // 一度も到達しないもの（打ち切ったときは、調べきれていないので出さない）
    for (const [id, scene] of Object.entries(sc.scenes)) {
      if (id.startsWith('__') || id === sc.gameoverScene || sc.lifeOutScenes?.includes(id))
        continue; // ライフが尽きたときのシーンは、ライフを減らさずに調べるので除く
      if (!visitedScenes.has(id)) {
        findings.push({
          severity: 'warning',
          message: `${scene.kind === 'place' ? '場所' : 'シーン'}「${id}」には、どう遊んでもたどり着きません`,
          scene: id,
        });
        continue;
      }
      if (scene.kind !== 'place') continue;
      const items = [...scene.examine, ...scene.talk];
      const title = (x: (typeof items)[number]) => ('topic' in x ? x.topic : (x.name ?? x.id));
      for (const x of items) {
        if (!seenIds.has(x.id)) {
          // 同じ場所に同じ名前の話題・調べる所があるときは、どれかわかるよう ID も添える
          const same =
            items.filter((y) => title(y) === title(x) && 'topic' in y === 'topic' in x).length > 1;
          const label = `${'topic' in x ? '話題' : '調べる所'}「${title(x)}」${same ? `（${x.id}）` : ''}`;
          findings.push({
            severity: 'warning',
            message: `場所「${scene.name}」の${label}は、どう遊んでも選べません`,
            scene: id,
          });
        }
      }
    }
  }
  if (truncated)
    findings.push({
      severity: 'warning',
      message: `状態が ${limit} 個を超えたため、途中で調べるのをやめました（結果は不完全です）`,
    });
  return { findings, states, truncated };
}
