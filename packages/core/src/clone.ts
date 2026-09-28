// 状態の複製。状態は JSON で表せるデータ（オブジェクト・配列・文字列・数・真偽・null）だけなので、
// structuredClone より速い手書きの深い複製を使う（整合性チェックで状態を何百万回も複製するため）。

export function cloneData<T>(x: T): T {
  if (typeof x !== 'object' || x === null) return x;
  if (Array.isArray(x)) {
    const a = new Array(x.length);
    for (let i = 0; i < x.length; i++) {
      const v = x[i];
      a[i] = typeof v === 'object' && v !== null ? cloneData(v) : v;
    }
    return a as T;
  }
  const o: Record<string, unknown> = {};
  for (const k in x) {
    const v = (x as Record<string, unknown>)[k];
    o[k] = typeof v === 'object' && v !== null ? cloneData(v) : v;
  }
  return o as T;
}
