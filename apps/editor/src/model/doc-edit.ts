// 読み込んだ YAML の Document に、編集操作（Op）をその場で当てる。
// 書き換えはすべて Change として記録するので、逆順に戻せば元の Document とまったく同じ形に戻る
// （元に戻す・やり直すはこの記録を使う。テキストを作り直したり、読み直したりしない）。
//
// Change はノードそのもの（参照）を持つ。元に戻す・やり直すは必ず後ろから順に行うので、
// ある Change を戻すときには、それより後の書き換えはすべて戻っていて、ノードは記録したときと同じ状態にある。
import {
  isCollection, isMap, isPair, isScalar, isSeq, Pair,
  type Document, type Node, type Scalar, type YAMLMap, type YAMLSeq,
} from 'yaml';
import { createNode, type Op, type Path } from './yaml-doc.ts';

type Coll = YAMLMap | YAMLSeq;

export type Change =
  /** スカラー（値かキー）の値を変えた */
  | { k: 'scalar'; node: Scalar; before: unknown; after: unknown }
  /** 入れ物の items の index から、removed を消して inserted を入れた */
  | { k: 'items'; coll: Coll; index: number; removed: unknown[]; inserted: unknown[] }
  /** マップの 1 組の値を別のノードにした */
  | { k: 'value'; pair: Pair; before: unknown; after: unknown }
  /** マップの 1 組のキーを別のノードにした */
  | { k: 'key'; pair: Pair; before: unknown; after: unknown }
  /** フロー形式（{ } や [ ]）かどうかを変えた */
  | { k: 'flow'; coll: Coll; before: boolean | undefined; after: boolean | undefined }
  /** 一番上のノードを置き換えた */
  | { k: 'contents'; doc: Document; before: unknown; after: unknown };

export function revert(c: Change): void {
  switch (c.k) {
    case 'scalar': c.node.value = c.before; return;
    case 'items': (c.coll.items as unknown[]).splice(c.index, c.inserted.length, ...c.removed); return;
    case 'value': c.pair.value = c.before; return;
    case 'key': c.pair.key = c.before; return;
    case 'flow': c.coll.flow = c.before; return;
    case 'contents': c.doc.contents = c.before as Node; return;
  }
}

export function reapply(c: Change): void {
  switch (c.k) {
    case 'scalar': c.node.value = c.after; return;
    case 'items': (c.coll.items as unknown[]).splice(c.index, c.removed.length, ...c.inserted); return;
    case 'value': c.pair.value = c.after; return;
    case 'key': c.pair.key = c.after; return;
    case 'flow': c.coll.flow = c.after; return;
    case 'contents': c.doc.contents = c.after as Node; return;
  }
}

const keyOf = (p: Pair) => (isScalar(p.key) ? p.key.value : p.key);

export function findPair(map: YAMLMap, key: unknown): Pair | undefined {
  return map.items.find(p => p.key === key || keyOf(p) === key);
}

const seqIndex = (key: string | number) => (typeof key === 'number' ? key : /^\d+$/.test(key) ? Number(key) : NaN);

/** パスの指すノード。found が false ならその場所はない（値が null の組は found: true, node: null） */
export function lookup(doc: Document, path: Path): { found: boolean; node: unknown } {
  let cur: unknown = doc.contents;
  for (const key of path) {
    // フロー形式の列の中の「a: b」は Pair のまま入っている
    if (isPair(cur)) {
      if (keyOf(cur) !== key) return { found: false, node: undefined };
      cur = cur.value;
    } else if (isMap(cur)) {
      const pair = findPair(cur, key);
      if (!pair) return { found: false, node: undefined };
      cur = pair.value;
    } else if (isSeq(cur)) {
      const i = seqIndex(key);
      if (!(i >= 0 && i < cur.items.length)) return { found: false, node: undefined };
      cur = cur.items[i];
    } else {
      return { found: false, node: undefined };
    }
  }
  return { found: true, node: cur };
}

/** パスの一番長い「いまある」ところ（書き換えの影響がそこから下に収まる場所） */
function existingPrefix(doc: Document, path: Path): Path {
  let n = path.length;
  while (n > 0 && !lookup(doc, path.slice(0, n)).found) n--;
  return path.slice(0, n);
}

/**
 * 1 回の編集（Op の列）を当てる。
 * 書き換えの記録（changes）と、プレーンなデータを作り直すべき場所（scopes）がたまる
 */
export class DocEditor {
  readonly changes: Change[] = [];
  readonly scopes: Path[] = [];
  readonly doc: Document;

  constructor(doc: Document) {
    this.doc = doc;
  }

  apply(op: Op): void {
    switch (op.op) {
      case 'set': return this.set(op.path, op.value);
      case 'delete':
        if (lookup(this.doc, op.path).found) {
          this.scopes.push(op.path.slice(0, -1));
          this.remove(op.path);
        }
        return;
      case 'insert': return this.insert(op.path, op.index, op.value);
      case 'move': return this.move(op.path, op.from, op.to);
      case 'renameKey': return this.renameKey(op.path, op.from, op.to);
      case 'relocate': return this.relocate(op.from, op.to);
      case 'renameRefs': return this.renameRefs(op.target, op.from, op.to);
    }
  }

  /** 途中で失敗したときなど、この編集で書き換えたものをすべて戻す */
  rollback(): void {
    for (let i = this.changes.length - 1; i >= 0; i--) revert(this.changes[i]!);
    this.changes.length = 0;
  }

  private set(path: Path, value: unknown): void {
    if (path.length === 0) throw new Error('ルートは置き換えられません');
    const existing = lookup(this.doc, path);
    this.scopes.push(this.scopeOf(path));
    // 既存のスカラーは値だけ変える（引用符の種類や行末コメントを残すため）
    if (existing.found && isScalar(existing.node) && (value === null || typeof value !== 'object')) {
      this.setScalar(existing.node, value);
      return;
    }
    this.ensureParents(path);
    this.setNode(path, createNode(this.doc, value, typeof path.at(-1) === 'string'));
    if (typeof value === 'object' && value !== null) this.unflowParents(path);
  }

  private insert(path: Path, index: number | undefined, value: unknown): void {
    this.scopes.push(this.scopeOf(path));
    let seq = lookup(this.doc, path).node;
    if (!isSeq(seq)) {
      this.ensureParents([...path, 0]);
      this.setNode(path, this.doc.createNode([]));
      seq = lookup(this.doc, path).node;
    }
    const s = seq as YAMLSeq;
    const at = Math.max(0, Math.min(index ?? s.items.length, s.items.length));
    this.splice(s, at, 0, [createNode(this.doc, value, false)]);
    // 空の [] に足したときはブロック形式にする
    if (typeof value === 'object' && value !== null) this.unflowParents([...path, 0]);
  }

  private move(path: Path, from: number, to: number): void {
    const c = lookup(this.doc, path).node;
    if (!isCollection(c)) throw new Error(`入れ物がありません: ${path.join('.')}`);
    if (from < 0 || from >= c.items.length) return;
    const dest = Math.max(0, Math.min(to, c.items.length - 1));
    this.scopes.push(path);
    const [item] = this.splice(c, from, 1, []);
    this.splice(c, dest, 0, [item]);
  }

  private renameKey(path: Path, from: string, to: string): void {
    if (from === to) return;
    const map = lookup(this.doc, path).node;
    if (!isMap(map)) throw new Error(`マップがありません: ${path.join('.')}`);
    if (map.has(to)) throw new Error(`「${to}」はすでにあります`);
    const pair = findPair(map, from);
    if (!pair) throw new Error(`「${from}」がありません`);
    this.scopes.push(path);
    if (isScalar(pair.key)) this.setScalar(pair.key, to);
    else {
      const key = this.doc.createNode(to);
      this.changes.push({ k: 'key', pair, before: pair.key, after: key });
      pair.key = key;
    }
  }

  private relocate(from: Path, to: Path): void {
    const r = lookup(this.doc, from);
    if (!r.found) return;
    this.scopes.push(from.slice(0, -1));
    this.remove(from);
    this.scopes.push(existingPrefix(this.doc, to));
    this.ensureParents(to);
    this.setNode(to, r.node);
  }

  /** シーン・場所の ID を参照している所（goto・start.scene・investigate など）も書き換える */
  private renameRefs(target: 'scene' | 'place', from: string, to: string): void {
    const replace = (n: unknown, path: Path) => {
      if (isScalar(n) && n.value === from) {
        this.scopes.push(path);
        this.setScalar(n, to);
      }
    };
    if (target === 'scene') {
      replace(lookup(this.doc, ['start', 'scene']).node, ['start', 'scene']);
      replace(lookup(this.doc, ['gameover']).node, ['gameover']);
    }
    const onPair = (pair: Pair, path: Path) => {
      const k = keyOf(pair);
      const p = [...path, k as string];
      if (target === 'scene' && k === 'goto') replace(pair.value, p);
      if (target === 'place' && (k === 'investigate' || k === 'to')) replace(pair.value, p);
      if (target === 'place' && k === 'move' && isSeq(pair.value)) pair.value.items.forEach((it, i) => replace(it, [...p, i]));
      walk(pair.value, p);
    };
    const walk = (n: unknown, path: Path) => {
      if (isMap(n)) for (const pair of n.items) onPair(pair, path);
      else if (isSeq(n)) {
        n.items.forEach((it, i) => {
          // フロー形式の列の中の「a: b」は Pair のまま入っている
          if (isPair(it)) onPair(it, [...path, i]);
          else walk(it, [...path, i]);
        });
      }
    };
    walk(this.doc.contents, []);
  }

  /**
   * path に値を置く編集で、データを作り直す場所。
   * 親の入れ物があれば（なければ末尾に足すだけなので）path だけでよい。大きなマップを丸ごと作り直さないため
   */
  private scopeOf(path: Path): Path {
    if (lookup(this.doc, path).found || isCollection(lookup(this.doc, path.slice(0, -1)).node)) return path;
    return existingPrefix(this.doc, path);
  }

  // ---- 記録しながら書き換える小さな操作 ----

  private setScalar(node: Scalar, value: unknown): void {
    if (node.value === value) return;
    this.changes.push({ k: 'scalar', node, before: node.value, after: value });
    node.value = value;
  }

  private splice(coll: Coll, index: number, count: number, inserted: unknown[]): unknown[] {
    const removed = (coll.items as unknown[]).splice(index, count, ...inserted);
    this.changes.push({ k: 'items', coll, index, removed, inserted });
    return removed;
  }

  /** パスの場所にノードを置く（親はあること）。マップになければ末尾に足す */
  private setNode(path: Path, node: unknown): void {
    if (path.length === 0) {
      this.changes.push({ k: 'contents', doc: this.doc, before: this.doc.contents, after: node });
      this.doc.contents = node as Node;
      return;
    }
    const parent = lookup(this.doc, path.slice(0, -1)).node;
    const key = path.at(-1)!;
    if (isMap(parent)) {
      const pair = findPair(parent, key);
      if (pair) {
        this.changes.push({ k: 'value', pair, before: pair.value, after: node });
        pair.value = node;
      } else {
        this.splice(parent, parent.items.length, 0, [new Pair(key, node)]);
      }
      return;
    }
    if (isSeq(parent)) {
      const i = seqIndex(key);
      if (!(i >= 0 && i <= parent.items.length)) throw new Error(`列の位置が正しくありません: ${path.join('.')}`);
      this.splice(parent, i, i < parent.items.length ? 1 : 0, [node]);
      return;
    }
    throw new Error(`入れ物がありません: ${path.slice(0, -1).join('.')}`);
  }

  private remove(path: Path): void {
    const parent = lookup(this.doc, path.slice(0, -1)).node;
    const key = path.at(-1)!;
    if (isMap(parent)) {
      const pair = findPair(parent, key);
      if (pair) this.splice(parent, parent.items.indexOf(pair), 1, []);
    } else if (isSeq(parent)) {
      const i = seqIndex(key);
      if (i >= 0 && i < parent.items.length) this.splice(parent, i, 1, []);
    }
  }

  /** 途中の入れ物がなければ（null も）ブロックの入れ物を作る。フロー形式の親に足すと崩れることがあるため */
  private ensureParents(path: Path): void {
    for (let n = 1; n < path.length; n++) {
      const sub = path.slice(0, n);
      const r = lookup(this.doc, sub);
      if (!r.found || r.node === null || r.node === undefined || (isScalar(r.node) && r.node.value === null)) {
        this.setNode(sub, this.doc.createNode(typeof path[n] === 'number' ? [] : {}));
      }
    }
  }

  /** 入れ物を入れる先の親がフロー形式（{ } や [ ]）なら、ブロック形式にする */
  private unflowParents(path: Path): void {
    for (let n = 0; n < path.length; n++) {
      const node = n === 0 ? this.doc.contents : lookup(this.doc, path.slice(0, n)).node;
      if (isCollection(node) && node.flow) {
        this.changes.push({ k: 'flow', coll: node, before: node.flow, after: false });
        node.flow = false;
      }
    }
  }
}
