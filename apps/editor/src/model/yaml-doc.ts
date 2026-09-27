// YAML の編集操作（Op）の型と、YAML まわりの小さな道具。
// 操作は読み込んだ Document にその場で当てる（doc-edit.ts）。テキストに戻すのは保存などのときだけ（doc-session.ts）。
// こうするとキーの順番・コメント・引用符の種類・フロー形式（{ } や [ ]）がほぼそのまま残る。
//
// 制限:
// - 行末コメントの前の空白（位置揃え）や [ ] の内側の空白は yaml が 1 通りに直してしまうので、
//   元の行と同じ内容の行だけ元に戻している（書き換えた行の揃えは崩れる）
// - 新しく作ったノード（ステップの追加・複製など）は、この editor の決めた書式（短い値はフロー形式）で書かれる
// - ステップの話し手を変えるなど、ノードごと置き換える操作では、そのノードの中のコメントは消える
import { isCollection, isPair, isScalar, parseDocument, type Document, type Node } from 'yaml';

export type Path = (string | number)[];

export type Op =
  /** 値を入れる（途中の入れ物がなければ作る） */
  | { op: 'set'; path: Path; value: unknown }
  /** 値を消す。undefined や '' を入れたいときの「省略」にも使う */
  | { op: 'delete'; path: Path }
  /** 列（配列）の index の位置に差し込む。index を省略すると末尾 */
  | { op: 'insert'; path: Path; index?: number; value: unknown }
  /** 列の要素、またはマップのキーの順番を入れ替える */
  | { op: 'move'; path: Path; from: number; to: number }
  /** マップのキーの名前を変える（位置と値・コメントはそのまま） */
  | { op: 'renameKey'; path: Path; from: string; to: string }
  /** 値を丸ごと別の場所へ移す（ノードごと移すのでコメントも付いていく） */
  | { op: 'relocate'; from: Path; to: Path }
  /** シーン・場所の ID を参照している所（goto・start.scene・investigate など）も書き換える */
  | { op: 'renameRefs'; target: 'scene' | 'place'; from: string; to: string };

export const STRINGIFY = { lineWidth: 0 } as const;

export function parse(text: string): Document {
  return parseDocument(text, { keepSourceTokens: false });
}

/** 編集用のプレーンなデータ（エラーがあれば error に入る） */
export function toData(text: string): { data: Record<string, unknown> | null; error: string | null } {
  const doc = parse(text);
  if (doc.errors.length > 0) return { data: null, error: doc.errors[0]!.message.split('\n')[0]! };
  const js = doc.toJS();
  if (js === null || js === undefined) return { data: {}, error: null };
  if (typeof js !== 'object' || Array.isArray(js)) return { data: null, error: '一番上がマップ（key: value）になっていません' };
  return { data: js as Record<string, unknown>, error: null };
}

/**
 * JS の値から YAML のノードを作る。
 * マップの値になる、スカラーだけの短い入れ物（set: { a: true } や give: [a, b]）はフロー形式にする。
 */
export function createNode(doc: Document, value: unknown, isMapValue: boolean): Node {
  const node = doc.createNode(value) as Node;
  const walk = (n: unknown, parentIsPair: boolean) => {
    if (!isCollection(n)) return;
    const scalarsOnly = n.items.every(i => (isPair(i) ? isScalar(i.value) : isScalar(i)));
    const short = n.items.length > 0 && n.items.length <= 5 && n.items.every(i => {
      const v = isPair(i) ? i.value : i;
      return !isScalar(v) || typeof v.value !== 'string' || v.value.length <= 16;
    });
    if (parentIsPair && scalarsOnly && short) n.flow = true;
    for (const i of n.items) {
      if (isPair(i)) walk(i.value, true);
      else walk(i, false);
    }
  };
  walk(node, isMapValue);
  return node;
}

/**
 * 元のテキストにあった行と中身が同じ行は、元の行に戻す。
 * yaml は行末コメントの位置揃えの空白や、[ ] の内側の空白を 1 通りに直してしまうため
 */
export function restoreLines(before: string, after: string): string {
  const norm = (line: string) => line.replace(/\s+#/, ' #').replace(/([[{])\s+/g, '$1').replace(/\s+([\]}])/g, '$1');
  const original = new Map<string, string>();
  for (const line of before.split('\n')) original.set(norm(line), line);
  // 新しい行: 列は [a, b]、マップは { a: b } と書く（サンプルの書き方に合わせる）
  const tidy = (line: string) => (/["'#]/.test(line) ? line : line.replace(/\[ ([^[\]{}]*?) \]/g, '[$1]'));
  return after.split('\n').map(line => original.get(norm(line)) ?? tidy(line)).join('\n');
}

/** パスが指す値（プレーンなデータから） */
export function getIn(data: unknown, path: Path): unknown {
  let cur = data;
  for (const k of path) {
    if (cur === null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string | number, unknown>)[k];
  }
  return cur;
}
