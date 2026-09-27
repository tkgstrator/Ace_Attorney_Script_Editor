// 整合性チェックで使う、状態のグラフ（状態は 0 からの番号）の入れ物と、抜け出せない状態のかたまりの検出。
// 状態が数百万になっても軽いよう、辺は型付き配列に詰めて持つ。

/** 伸ばせる Int32Array */
export class IntList {
  data = new Int32Array(1024);
  length = 0;
  push(v: number): void {
    this.reserve(this.length + 1);
    this.data[this.length++] = v;
  }
  /** i 番目に書く（足りなければ伸ばし、間は 0 で埋める） */
  set(i: number, v: number): void {
    this.reserve(i + 1);
    this.data[i] = v;
    if (this.length <= i) this.length = i + 1;
  }
  at(i: number): number { return this.data[i]!; }
  private reserve(n: number) {
    if (n <= this.data.length) return;
    let size = this.data.length;
    while (size < n) size *= 2;
    const d = new Int32Array(size);
    d.set(this.data);
    this.data = d;
  }
}

/**
 * 状態のグラフ。状態 i の行き先は targets の from(i)〜to(i) に並ぶ（展開した順に詰めて入れる）。
 * 展開していない状態（打ち切り・終わり）は行き先なし
 */
export class Graph {
  private first = new IntList();
  private last = new IntList();
  targets = new IntList();
  /** 状態 i の行き先を並べ始める。続けて add で行き先を足す */
  open(i: number): void {
    this.first.set(i, this.targets.length);
    this.last.set(i, this.targets.length);
  }
  add(i: number, to: number): void {
    this.targets.push(to);
    this.last.set(i, this.targets.length);
  }
  from(i: number): number { return i < this.first.length ? this.first.at(i) : 0; }
  to(i: number): number { return i < this.last.length ? this.last.at(i) : 0; }
}

/**
 * 出ていく先のない、終わりを含まない強連結成分（抜け出せない状態のかたまり）。
 * Tarjan の方法を、再帰を使わずに書いたもの。goal(i) が真の状態（end・gameover）を含むかたまりは除く
 */
export function traps(g: Graph, n: number, goal: (i: number) => boolean): number[][] {
  const index = new Int32Array(n).fill(-1), low = new Int32Array(n), comp = new Int32Array(n).fill(-1);
  const onStack = new Uint8Array(n);
  const stack = new IntList();
  // 作業用: 調べている状態と、次に見る辺の位置
  const workV = new IntList(), workE = new IntList();
  const found: number[][] = [];
  let counter = 0, comps = 0;
  for (let root = 0; root < n; root++) {
    if (index[root] !== -1) continue;
    const open = (v: number) => {
      index[v] = low[v] = counter++;
      stack.push(v); onStack[v] = 1;
      workV.push(v); workE.push(g.from(v));
    };
    open(root);
    while (workV.length > 0) {
      const top = workV.length - 1;
      const v = workV.at(top);
      const e = workE.at(top);
      if (e < g.to(v)) {
        workE.data[top] = e + 1;
        const w = g.targets.at(e);
        if (index[w] === -1) open(w);
        else if (onStack[w]) low[v] = Math.min(low[v]!, index[w]!);
        continue;
      }
      workV.length--; workE.length--;
      if (workV.length > 0) { const p = workV.at(workV.length - 1); low[p] = Math.min(low[p]!, low[v]!); }
      if (low[v] === index[v]) {
        // かたまりが決まった時点で、行き先のかたまりもすべて決まっている（先に見つかる）ので、ここで判定する
        const c: number[] = [];
        for (;;) { const x = stack.at(--stack.length); onStack[x] = 0; comp[x] = comps; c.push(x); if (x === v) break; }
        if (isTrap(c, comps)) found.push(c);
        comps++;
      }
    }
  }
  return found;

  function isTrap(c: number[], ci: number): boolean {
    for (const v of c) {
      if (goal(v)) return false;
      for (let e = g.from(v); e < g.to(v); e++) if (comp[g.targets.at(e)] !== ci) return false;
    }
    return true;
  }
}
