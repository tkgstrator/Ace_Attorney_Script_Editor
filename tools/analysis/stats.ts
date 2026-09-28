// 数の要約と、Markdown の表を作る小道具。

export function quantile(xs: number[], q: number): number {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const i = (s.length - 1) * q;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return (s[lo] as number) + ((s[hi] as number) - (s[lo] as number)) * (i - lo);
}

export const median = (xs: number[]) => quantile(xs, 0.5);
export const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
export const mean = (xs: number[]) => (xs.length ? sum(xs) / xs.length : Number.NaN);

/** 数を短く書く（整数はそのまま、小数は 1 桁） */
export function f(x: number, digits = 1): string {
  if (!Number.isFinite(x)) return '-';
  return Number.isInteger(x) ? String(x) : x.toFixed(digits);
}

export function pct(part: number, whole: number, digits = 1): string {
  if (!whole) return '-';
  return `${((part / whole) * 100).toFixed(digits)}%`;
}

/** 中央値（最小〜最大） */
export function mr(xs: number[]): string {
  if (!xs.length) return '-';
  return `${f(median(xs))}（${f(Math.min(...xs))}〜${f(Math.max(...xs))}）`;
}

/** 中央値・四分位・最大をまとめて書く */
export function dist(xs: number[]): string {
  if (!xs.length) return '-';
  return `中央 ${f(median(xs))} / 25% ${f(quantile(xs, 0.25))} / 75% ${f(quantile(xs, 0.75))} / 90% ${f(quantile(xs, 0.9))} / 最大 ${f(Math.max(...xs))}`;
}

export function table(head: string[], rows: (string | number)[][]): string {
  const line = (r: (string | number)[]) => `| ${r.map(String).join(' | ')} |`;
  return [line(head), `|${head.map(() => '---').join('|')}|`, ...rows.map(line)].join('\n');
}

export class Counter<K = string> {
  readonly m = new Map<K, number>();
  add(k: K, n = 1) {
    this.m.set(k, (this.m.get(k) ?? 0) + n);
  }
  get(k: K): number {
    return this.m.get(k) ?? 0;
  }
  total(): number {
    let t = 0;
    for (const v of this.m.values()) t += v;
    return t;
  }
  top(n = 20): [K, number][] {
    return [...this.m].sort((a, b) => b[1] - a[1]).slice(0, n);
  }
}

/** 度数分布（上限を超えたものは「上限+」にまとめる） */
export function histogram(xs: number[], cap: number): string {
  const c = new Counter<number>();
  for (const x of xs) c.add(Math.min(x, cap));
  const rows: string[][] = [];
  for (let i = Math.min(...xs); i <= cap; i++) {
    const n = c.get(i);
    if (n) rows.push([i === cap ? `${cap}+` : String(i), String(n), pct(n, xs.length)]);
  }
  return table(['値', '数', '割合'], rows);
}

/** 表の key の値を返す。無ければ make() で作って入れる */
export function slot<V>(rec: Record<string, V>, key: string, make: () => V): V {
  let v = rec[key];
  if (v === undefined) {
    v = make();
    rec[key] = v;
  }
  return v;
}
