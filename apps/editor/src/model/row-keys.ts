// 列（ステップ・証言・選択肢など）の行に、並べ替えや追加の後も変わらないキーを付ける。
// YAML の列には ID がないので、前の列と中身を比べて対応を決める:
//   1. 中身が同じ行は、前の行のキーを引き継ぐ（並べ替え・追加・削除・元に戻す）
//   2. 残りの行は、同じ位置の前の行のキーを引き継ぐ（その行を書き換えたとき）
//   3. それもなければ、新しいキー
// 中身が同じ行は前の行のオブジェクトをそのまま使うので、変わっていない行は描き直さずに済む

export interface Rows<T> {
  items: T[];
  keys: string[];
  /** 中身の比較用の文字列 */
  prints: string[];
}

let serial = 0;
const newKey = () => `r${++serial}`;

const print = (v: unknown): string => {
  try {
    return JSON.stringify(v) ?? String(v);
  } catch {
    return String(v);
  }
};

export function reconcileRows<T>(prev: Rows<T> | null, next: readonly T[]): Rows<T> {
  if (prev && prev.items.length === next.length && prev.items.every((x, i) => x === next[i]))
    return prev;
  const prints = next.map((v, i) => (prev?.items[i] === v ? prev.prints[i]! : print(v)));
  const free = new Map<string, number[]>();
  prev?.prints.forEach((p, i) => {
    const q = free.get(p);
    if (q) q.push(i);
    else free.set(p, [i]);
  });
  const used = new Set<number>();
  const from: (number | null)[] = prints.map((p) => {
    const q = free.get(p);
    const i = q?.shift();
    if (i === undefined) return null;
    used.add(i);
    return i;
  });
  const keys = from.map((f, i) => {
    if (f !== null) return prev!.keys[f]!;
    if (prev && i < prev.keys.length && !used.has(i)) {
      used.add(i);
      return prev.keys[i]!;
    }
    return newKey();
  });
  const items = next.map((v, i) => (from[i] !== null ? prev!.items[from[i]!]! : v));
  return { items, keys, prints };
}
