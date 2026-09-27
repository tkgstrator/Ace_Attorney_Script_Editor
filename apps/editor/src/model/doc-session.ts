// 開いている章の YAML を、読み込んだ Document のまま持ち続けて編集する。
// 1 回の編集では、その Document に操作を当て、プレーンなデータ（画面に出すもの）は変わった所だけ作り直す。
// テキストに戻す（stringify）のは、保存・YAML の表示・コンパイルのときだけ。
//
// 書き出すときは、元のテキスト（base）にあった行と中身が同じ行は元の行に戻す（restoreLines）ので、
// 書き換えていない行はそのまま残る。
import { isNode, isPair, isScalar, type Document } from 'yaml';
import { DocEditor, lookup, reapply, revert, type Change } from './doc-edit.ts';
import { parse, restoreLines, STRINGIFY, type Op, type Path } from './yaml-doc.ts';

export type Data = Record<string, unknown>;

/** Document と、それを読んだテキスト（base）と、プレーンなデータの組 */
interface DocState {
  doc: Document;
  base: string;
  /** base をそのまま書き出してよい状態の id */
  baseId: number;
  data: Data | null;
  error: string | null;
}

/** 履歴の 1 件。Document への書き換えの記録か、テキストの丸ごと置き換え（swap） */
export interface Entry {
  before: number;
  after: number;
  changes: Change[];
  /** プレーンなデータを作り直す場所 */
  scopes: Path[];
  swap?: { before: DocState; after: DocState };
}

let nextId = 1;

function readState(text: string, id: number): DocState {
  const doc = parse(text);
  if (doc.errors.length > 0) return { doc, base: text, baseId: id, data: null, error: doc.errors[0]!.message.split('\n')[0]! };
  const js = doc.toJS() as unknown;
  if (js === null || js === undefined) return { doc, base: text, baseId: id, data: {}, error: null };
  if (typeof js !== 'object' || Array.isArray(js)) return { doc, base: text, baseId: id, data: null, error: '一番上がマップ（key: value）になっていません' };
  return { doc, base: text, baseId: id, data: js as Data, error: null };
}

export class DocSession {
  private state: DocState;
  /** 今の状態の id（編集のたびに新しくなり、元に戻すと前の id に戻る） */
  id: number;
  private cache: { id: number; text: string } | null = null;

  constructor(text: string) {
    this.id = nextId++;
    this.state = readState(text, this.id);
  }

  get data(): Data | null { return this.state.data; }
  get error(): string | null { return this.state.error; }
  get doc(): Document { return this.state.doc; }

  /** 今の内容のテキスト。書き換えていなければ読んだテキストそのもの */
  text(): string {
    if (this.id === this.state.baseId) return this.state.base;
    if (this.cache?.id === this.id) return this.cache.text;
    const text = serialize(this.state.doc, this.state.base);
    this.cache = { id: this.id, text };
    return text;
  }

  /** text() がすぐに返せるか（書き出しの手間がかからないか） */
  textReady(): boolean {
    return this.id === this.state.baseId || this.cache?.id === this.id;
  }

  /** 保存したテキストを、以後の書き出しの基準にする */
  markSaved(text: string): void {
    this.state.base = text;
    this.state.baseId = this.id;
  }

  /** 操作を当てる。失敗したら何も変えずに例外を投げる */
  edit(ops: Op[]): Entry | null {
    const s = this.state;
    if (s.doc.errors.length > 0 || !s.data) throw new Error('YAML の構文エラーがあるため、編集できません');
    const ed = new DocEditor(s.doc);
    try {
      for (const op of ops) ed.apply(op);
    } catch (e) {
      ed.rollback();
      throw e;
    }
    if (ed.changes.length === 0) return null;
    const entry: Entry = { before: this.id, after: nextId++, changes: ed.changes, scopes: ed.scopes };
    s.data = patchData(s.data, s.doc, ed.scopes);
    this.id = entry.after;
    return entry;
  }

  /** テキストを丸ごと置き換える（YAML の直接編集） */
  replaceText(text: string): Entry | null {
    if (text === this.text()) return null;
    const before = this.state;
    const id = nextId++;
    const after = readState(text, id);
    const entry: Entry = { before: this.id, after: id, changes: [], scopes: [], swap: { before, after } };
    this.state = after;
    this.id = id;
    return entry;
  }

  undo(e: Entry): void {
    if (e.swap) this.state = e.swap.before;
    else {
      for (let i = e.changes.length - 1; i >= 0; i--) revert(e.changes[i]!);
      this.state.data = patchData(this.state.data!, this.state.doc, e.scopes);
    }
    this.id = e.before;
  }

  redo(e: Entry): void {
    if (e.swap) this.state = e.swap.after;
    else {
      for (const c of e.changes) reapply(c);
      this.state.data = patchData(this.state.data!, this.state.doc, e.scopes);
    }
    this.id = e.after;
  }
}

/** 続けての入力を 1 件にまとめる（まとめられなければ null） */
export function mergeEntries(a: Entry, b: Entry): Entry | null {
  if (a.after !== b.before) return null;
  if (a.swap || b.swap) {
    if (!a.swap || !b.swap) return null;
    return { before: a.before, after: b.after, changes: [], scopes: [], swap: { before: a.swap.before, after: b.swap.after } };
  }
  const changes = [...a.changes];
  for (const c of b.changes) {
    const last = changes.at(-1);
    // 同じスカラーへの続けての書き換えは 1 つにする
    if (last?.k === 'scalar' && c.k === 'scalar' && last.node === c.node) changes[changes.length - 1] = { ...last, after: c.after };
    else changes.push(c);
  }
  const seen = new Set(a.scopes.map(p => JSON.stringify(p)));
  const scopes = [...a.scopes, ...b.scopes.filter(p => !seen.has(JSON.stringify(p)))];
  return { before: a.before, after: b.after, changes, scopes };
}

/** Document をテキストにする。base にあった行と中身が同じ行は、base の行に戻す */
export function serialize(doc: Document, base: string): string {
  const out = doc.toString(STRINGIFY);
  const restored = restoreLines(base, out);
  // 空白を戻したことで意味が変わってしまったら（引用符の中の空白など）、戻さない
  if (restored !== out && JSON.stringify(parse(restored).toJS()) !== JSON.stringify(doc.toJS())) return out;
  return restored;
}

/** テキストに操作を順に当てて、新しいテキストを返す（テスト・一度きりの変換用） */
export function applyOps(text: string, ops: Op[]): string {
  const doc = parse(text);
  if (doc.errors.length > 0) throw new Error('YAML の構文エラーがあるため、編集できません');
  const ed = new DocEditor(doc);
  for (const op of ops) ed.apply(op);
  if (ed.changes.length === 0) return text;
  return serialize(doc, text);
}

// ---- プレーンなデータを、変わった場所だけ作り直す ----

const MISSING = Symbol('missing');

function nodeToJS(doc: Document, node: unknown): unknown {
  if (isPair(node)) {
    const k = isScalar(node.key) ? node.key.value : node.key;
    return { [String(k)]: nodeToJS(doc, node.value) };
  }
  return isNode(node) ? node.toJS(doc) : node ?? null;
}

const isPrefix = (a: Path, b: Path) => a.length <= b.length && a.every((k, i) => b[i] === k);

/** scopes の場所の値を Document から作り直す。ほかの部分は同じオブジェクトをそのまま使う */
export function patchData(data: Data, doc: Document, scopes: Path[]): Data {
  const roots: Path[] = [];
  for (const s of [...scopes].sort((a, b) => a.length - b.length)) {
    if (!roots.some(r => isPrefix(r, s))) roots.push(s);
  }
  let out: unknown = data;
  for (const path of roots) {
    if (path.length === 0) { out = doc.toJS() ?? {}; continue; }
    const r = lookup(doc, path);
    out = assocIn(out, path, 0, r.found ? nodeToJS(doc, r.node) : MISSING, doc);
  }
  return out as Data;
}

function assocIn(cur: unknown, path: Path, i: number, value: unknown, doc: Document): unknown {
  if (cur === null || typeof cur !== 'object') {
    // データの側に途中の入れ物がない（ふつうは起きない）: その場所を丸ごと作り直す
    const r = lookup(doc, path.slice(0, i));
    return r.found ? nodeToJS(doc, r.node) : cur;
  }
  const k = path[i]!;
  const last = i === path.length - 1;
  if (Array.isArray(cur)) {
    const idx = typeof k === 'number' ? k : Number(k);
    const copy = cur.slice();
    if (last && value === MISSING) copy.splice(idx, 1);
    else copy[idx] = last ? value : assocIn(cur[idx], path, i + 1, value, doc);
    return copy;
  }
  const copy = { ...(cur as Record<string, unknown>) };
  if (last && value === MISSING) delete copy[k];
  else copy[k] = last ? value : assocIn(copy[k], path, i + 1, value, doc);
  return copy;
}
