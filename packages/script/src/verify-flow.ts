// 整合性チェックの下調べ: シナリオの流れ（命令・尋問・探偵メニューのつながり）を 1 つのグラフにして、
// 各地点で「この先で値を読むかもしれない変数」（生きている変数）を求める。
//
// 状態を見分けるキーには、今いる地点で生きている変数だけを入れる。死んでいる変数（この先、読まれる前に
// 必ず上書きされるか、二度と読まれない）の値が違うだけの状態は、この先の動きがまったく同じなので、
// 1 つにまとめても詰みの判定は変わらない（近似ではない）。
// 例: 探偵パートで立てた話題のフラグは、次の法廷パートでは読まれないので、法廷パートの状態を増やさない。
//
// 変数は、フラグ名・visited の ID（"v:" を付ける）・seen の ID（"s:" を付ける）。証拠品は扱わない（キーに常に入れる）。
import type { CompiledScenario, Expr, Instr, PlaceScene, TestimonyScene } from '@gyakusai/core';
import { inspectInfo } from './verify-inspect.ts';
import { booleanFlags, exprDeps, summarize } from './verify-region.ts';

/** 変数を読む式から、読んでいる変数の名前を集める（life はライフで、調べるときは減らないので除く） */
export function exprVars(e: Expr | undefined, out: Set<string>): Set<string> {
  if (!e) return out;
  switch (e.t) {
    case 'var':
      if (e.name !== 'life') out.add(e.name);
      break;
    case 'call':
      if (e.fn === 'visited') out.add(`v:${e.arg}`);
      else if (e.fn === 'seen') out.add(`s:${e.arg}`);
      break;
    case 'not':
      exprVars(e.e, out);
      break;
    case 'bin':
      exprVars(e.l, out);
      exprVars(e.r, out);
      break;
    case 'lit':
      break;
  }
  return out;
}

/** グラフの辺。kill は、辺を通るときに必ず書き込まれる変数（入った場所の visited・調べた印の seen） */
interface Edge {
  to: number;
  kill: number;
}

export interface Flow {
  /** シーンの命令の地点の番号 = base[シーン] + pc */
  base: Map<string, number>;
  /** 尋問の画面（証言・尋問の開始の表示を含む）の地点 */
  testimony: Map<string, number>;
  /** 探偵メニューの地点 */
  menu: Map<string, number>;
  /** 地点ごとの、生きている変数の名前（順番は固定。キーを作るときにこの順に並べる） */
  live(node: number): string[];
}

/** 状態が今いる地点 */
export function nodeOf(flow: Flow, s: { scene: string; pc: number; mode: string }): number {
  if (s.mode === 'testimony') return flow.testimony.get(s.scene)!;
  if (s.mode === 'investigate') return flow.menu.get(s.scene)!;
  return flow.base.get(s.scene)! + s.pc;
}

/** all: 生きているかを調べず、式で読まれる変数をすべての地点で生きているとみなす（確かめ用） */
export function analyzeFlow(sc: CompiledScenario, opts: { all?: boolean } = {}): Flow {
  const base = new Map<string, number>(),
    testimony = new Map<string, number>(),
    menu = new Map<string, number>();
  let n = 0;
  for (const [id, scene] of Object.entries(sc.scenes)) {
    base.set(id, n);
    n += scene.program.length;
  }
  for (const [id, scene] of Object.entries(sc.scenes)) {
    if (scene.kind === 'testimony') testimony.set(id, n++);
    if (scene.kind === 'place') menu.set(id, n++);
  }

  // 変数に番号を付ける（式で読まれている変数だけ。読まれない変数は、どこでも死んでいる）
  const names: string[] = [];
  const index = new Map<string, number>();
  const idOf = (v: string) => index.get(v) ?? -1;
  const collect = (e: Expr | undefined) => {
    for (const v of exprVars(e, new Set()))
      if (!index.has(v)) {
        index.set(v, names.length);
        names.push(v);
      }
  };
  for (const scene of Object.values(sc.scenes)) {
    for (const ins of scene.program) {
      if (ins.op === 'jumpUnless') collect(ins.cond);
      if (ins.op === 'choice' || ins.op === 'pick')
        ins.options.forEach((o) => {
          collect(o.when);
        });
    }
    if (scene.kind === 'testimony')
      scene.statements.forEach((st) => {
        collect(st.when);
      });
    if (scene.kind === 'place') {
      scene.person.forEach((p) => {
        collect(p.when);
      });
      scene.move.forEach((m) => {
        collect(m.when);
      });
      scene.talk.forEach((t) => {
        collect(t.when);
      });
      scene.examine.forEach((x) => {
        collect(x.when);
      });
    }
  }

  const gen: number[][] = Array.from({ length: n }, () => []);
  const def: number[][] = Array.from({ length: n }, () => []);
  const bool = booleanFlags(sc);
  const succ: Edge[][] = Array.from({ length: n }, () => []);
  // 式が本当に読む変数だけを読むとする（verify-region.ts）
  const uses = (node: number, e: Expr | undefined) => {
    for (const v of exprDeps(e, bool)) if (idOf(v) >= 0) gen[node]!.push(idOf(v));
  };
  const edge = (from: number, to: number | undefined, kill = -1) => {
    if (to !== undefined) succ[from]!.push({ to, kill });
  };

  /** シーンに入ったときの行き先（場所なら、来たときのブロックか探偵メニュー） */
  const entry = (id: string): { to: number | undefined; kill: number } => {
    const scene = sc.scenes[id];
    if (!scene) return { to: undefined, kill: -1 };
    if (scene.kind === 'testimony') return { to: testimony.get(id), kill: idOf(`v:${id}`) };
    if (scene.kind === 'place')
      return scene.enter !== undefined
        ? { to: base.get(id)! + scene.enter, kill: -1 }
        : { to: menu.get(id), kill: idOf(`v:${id}`) };
    return { to: base.get(id), kill: idOf(`v:${id}`) };
  };
  const enter = (from: number, id: string) => {
    const e = entry(id);
    edge(from, e.to, e.kill);
  };
  /** 証拠品を詳しく調べられる所（つきつけの要求・探偵メニュー）から、調べるシーンへの辺 */
  const inspectScenes = [
    ...new Set(Object.values(sc.evidence).flatMap((ev) => (ev.inspect ? [ev.inspect] : []))),
  ];
  const inspects = (from: number) =>
    inspectScenes.forEach((id) => {
      enter(from, id);
    });
  /**
   * 台詞・日時の表示・選択肢・証言の途中から、調べるシーンへの辺。調べて状態が変わりうる証拠品（verify-inspect.ts の
   * effective）のシーンだけ（ほかの証拠品は、そこでは調べる操作を試さない）
   */
  const effectiveScenes = [
    ...new Set(inspectInfo(sc).effective.map((id) => sc.evidence[id]!.inspect!)),
  ];
  const inspectsAnywhere = (from: number) =>
    effectiveScenes.forEach((id) => {
      enter(from, id);
    });

  for (const [id, scene] of Object.entries(sc.scenes)) {
    const b = base.get(id)!;
    scene.program.forEach((ins: Instr, pc) => {
      const node = b + pc;
      const next = () => edge(node, pc + 1 < scene.program.length ? node + 1 : undefined);
      switch (ins.op) {
        case 'jump':
          edge(node, b + ins.to);
          break;
        case 'jumpUnless': {
          // 止まって選ぶ場面のない if のかたまりは、出口への 1 本の辺にまとめる（verify-region.ts）
          const sum = summarize(scene.program, pc, bool);
          if (sum) {
            for (const v of sum.gen) if (idOf(v) >= 0) gen[node]!.push(idOf(v));
            for (const v of sum.def) if (idOf(v) >= 0) def[node]!.push(idOf(v));
            edge(node, b + sum.exit);
            // かたまりの中の台詞・日時の表示で詳しく調べられるので、調べるシーンで読む変数もここで読むとみなす
            if (scene.program.slice(pc, sum.exit).some((x) => x.op === 'say' || x.op === 'card'))
              inspectsAnywhere(node);
          } else {
            uses(node, ins.cond);
            next();
            edge(node, b + ins.to);
          }
          break;
        }
        case 'random':
          ins.to.forEach((t) => {
            edge(node, b + t);
          });
          if (ins.to.length === 0) next();
          break;
        case 'choice':
          ins.options.forEach((o) => {
            uses(node, o.when);
            edge(node, b + o.to);
          });
          inspectsAnywhere(node);
          break;
        // 範囲を選ぶ間は法廷記録を開けない（詳しく調べられない）
        case 'pick':
          ins.options.forEach((o) => {
            uses(node, o.when);
            edge(node, b + o.to);
          });
          break;
        case 'say':
        case 'card':
          next();
          inspectsAnywhere(node);
          break;
        case 'demand':
          [...Object.values(ins.options), ...Object.values(ins.profiles ?? {})].forEach((t) => {
            edge(node, b + t);
          });
          edge(node, b + ins.wrong);
          if (ins.giveUp !== undefined) edge(node, b + ins.giveUp);
          inspects(node);
          break;
        case 'goto':
          enter(node, ins.scene);
          break;
        case 'investigate':
          enter(node, ins.place);
          break;
        case 'menu':
          edge(node, menu.get(id), idOf(`v:${id}`));
          break;
        case 'resume':
          edge(node, testimony.get(id));
          break;
        case 'end':
        case 'gameover':
          break;
        // 詳しく調べ終えたら、調べ始めた場面へ戻る。戻り先はキーに入れ、戻り先で生きている変数もキーに入れるので、
        // ここからの辺は作らない（調べ始める所から、調べるシーンへの辺を作る）
        case 'inspectEnd':
          break;
        case 'set':
          if (idOf(ins.flag) >= 0) def[node]!.push(idOf(ins.flag));
          next();
          break;
        // add は、足した後の値が生きているときだけ前の値を読む。どちらでも生きている変数の集まりは変わらない
        default:
          next();
      }
    });
    if (scene.kind === 'testimony') addTestimony(scene, testimony.get(id)!, b);
    if (scene.kind === 'place') addPlace(scene, menu.get(id)!, b);
  }

  function addTestimony(t: TestimonyScene, node: number, b: number) {
    for (const st of t.statements) {
      uses(node, st.when);
      for (const pc of [
        st.press,
        st.before,
        ...Object.values(st.present),
        ...Object.values(st.presentProfile ?? {}),
      ])
        if (pc !== undefined) edge(node, b + pc);
    }
    for (const pc of [t.wrong, t.after, t.reading, t.loop])
      if (pc !== undefined) edge(node, b + pc);
    inspectsAnywhere(node);
  }

  function addPlace(p: PlaceScene, node: number, b: number) {
    p.person.forEach((x) => {
      uses(node, x.when);
    });
    p.examine.forEach((x) => {
      uses(node, x.when);
      edge(node, b + x.pc, idOf(`s:${x.id}`));
    });
    p.talk.forEach((x) => {
      uses(node, x.when);
      edge(node, b + x.pc, idOf(`s:${x.id}`));
    });
    edge(node, b + p.examineDefault);
    for (const pc of [
      ...Object.values(p.present),
      ...Object.values(p.presentProfile ?? {}),
      p.presentWrong,
    ])
      edge(node, b + pc);
    p.move.forEach((m) => {
      uses(node, m.when);
      enter(node, m.to);
    });
    inspects(node);
  }

  const live = opts.all
    ? Object.assign(
        new Uint32Array(n * Math.max(1, Math.ceil(names.length / 32))).fill(0xffffffff),
        { words: Math.max(1, Math.ceil(names.length / 32)) },
      )
    : solve(n, names.length, gen, def, succ);
  const cache = new Map<number, string[]>();
  return {
    base,
    testimony,
    menu,
    live(node) {
      let v = cache.get(node);
      if (!v) {
        v = [];
        for (let i = 0; i < names.length; i++)
          if (live[node * live.words + (i >>> 5)]! & (1 << (i & 31))) v.push(names[i]!);
        cache.set(node, v);
      }
      return v;
    },
  };
}

/**
 * 後ろ向きのデータフロー解析（生きている変数）。
 * in(n) = gen(n) ∪ (out(n) − def(n))、out(n) = ∪ (in(辺の先) − 辺の kill)。変わらなくなるまで繰り返す
 */
function solve(
  n: number,
  vars: number,
  gen: number[][],
  def: number[][],
  succ: Edge[][],
): Uint32Array & { words: number } {
  const words = Math.max(1, Math.ceil(vars / 32));
  const live = Object.assign(new Uint32Array(n * words), { words });
  const preds: number[][] = Array.from({ length: n }, () => []);
  succ.forEach((es, from) => {
    es.forEach((e) => {
      preds[e.to]!.push(from);
    });
  });
  for (let v = 0; v < n; v++)
    for (const g of gen[v]!) live[v * words + (g >>> 5)]! |= 1 << (g & 31);
  const tmp = new Uint32Array(words);
  const queued = new Uint8Array(n).fill(1);
  const work: number[] = [];
  for (let v = n - 1; v >= 0; v--) work.push(v);
  while (work.length > 0) {
    const v = work.pop()!;
    queued[v] = 0;
    tmp.fill(0);
    for (const e of succ[v]!) {
      for (let w = 0; w < words; w++) tmp[w]! |= live[e.to * words + w]!;
      // 辺の kill は、辺の先で読む前に必ず書き込まれるので、前の値は読まれない
      if (e.kill >= 0) tmp[e.kill >>> 5]! &= ~(1 << (e.kill & 31));
    }
    for (const d of def[v]!) tmp[d >>> 5]! &= ~(1 << (d & 31));
    let changed = false;
    for (let w = 0; w < words; w++) {
      const nv = (live[v * words + w]! | tmp[w]!) >>> 0;
      if (nv !== live[v * words + w]) {
        live[v * words + w] = nv;
        changed = true;
      }
    }
    if (changed)
      for (const p of preds[v]!)
        if (!queued[p]) {
          queued[p] = 1;
          work.push(p);
        }
  }
  return live;
}
