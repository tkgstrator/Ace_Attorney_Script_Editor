// 変換の網羅の集計。命令ごとに、どう変換したか（YAML のステップ・文中コマンド・構造・native・無視）を数える。

export type How =
  /** YAML のステップにした */
  | 'step'
  /** 台詞の文中コマンドにした */
  | 'inline'
  /** 証言・選択肢・つきつけなど、YAML の構造（シーンの形）で表した */
  | 'structure'
  /** 近い形に置き換えた（例: 木槌の DS 演出 → 効果音と揺れ） */
  | 'approx'
  /** native ステップとして残した（まだ対応していない） */
  | 'native'
  /** 意味のない命令（nop など）で、捨てた */
  | 'ignored';

export const HOWS: How[] = ['step', 'inline', 'structure', 'approx', 'native', 'ignored'];

export class Stats {
  readonly ops = new Map<string, Record<How, number>>();
  /** YAML で表せない所（種類 → 回数と例の区画） */
  readonly gaps = new Map<string, { count: number; sections: Set<number> }>();

  /** これが入っていれば、すべてこの手として数える（証言の読む区画のように、構造で置き換えて捨てるもの） */
  override: How | null = null;

  hit(name: string, how: How, n = 1) {
    if (this.override) how = this.override;
    let r = this.ops.get(name);
    if (!r) { r = { step: 0, inline: 0, structure: 0, approx: 0, native: 0, ignored: 0 }; this.ops.set(name, r); }
    r[how] += n;
  }

  gap(kind: string, section: number) {
    let g = this.gaps.get(kind);
    if (!g) { g = { count: 0, sections: new Set() }; this.gaps.set(kind, g); }
    g.count++;
    g.sections.add(section);
  }

  /** ほかの集計を足し込む（章の中の編をまとめるとき） */
  merge(o: Stats) {
    for (const [name, r] of o.ops) for (const h of HOWS) if (r[h]) this.hit(name, h, r[h]);
    for (const [k, g] of o.gaps) {
      const m = this.gaps.get(k) ?? { count: 0, sections: new Set<number>() };
      m.count += g.count;
      g.sections.forEach(x => m.sections.add(x));
      this.gaps.set(k, m);
    }
  }

  totals(): Record<How, number> {
    const t: Record<How, number> = { step: 0, inline: 0, structure: 0, approx: 0, native: 0, ignored: 0 };
    for (const r of this.ops.values()) for (const h of HOWS) t[h] += r[h];
    return t;
  }

  /** 表にして返す（命令ごと、多い順） */
  report(): string {
    const rows = [...this.ops.entries()].sort((a, b) => sum(b[1]) - sum(a[1]));
    const lines = [`命令\t合計\t${HOWS.join('\t')}`];
    for (const [name, r] of rows) lines.push(`${name}\t${sum(r)}\t${HOWS.map(h => r[h] || '').join('\t')}`);
    const t = this.totals();
    const all = sum(t);
    const covered = all - t.native;
    lines.push(`合計\t${all}\t${HOWS.map(h => t[h]).join('\t')}`);
    lines.push(`native 以外で表せた割合: ${(100 * covered / Math.max(1, all)).toFixed(1)}%`);
    lines.push('', 'YAML で表せない所（回数・区画）');
    for (const [k, g] of [...this.gaps.entries()].sort((a, b) => b[1].count - a[1].count)) {
      const secs = [...g.sections].slice(0, 8).map(s => `§${s}`).join(' ');
      lines.push(`${k}\t${g.count}\t${secs}${g.sections.size > 8 ? ' …' : ''}`);
    }
    return lines.join('\n');
  }
}

const sum = (r: Record<How, number>) => HOWS.reduce((a, h) => a + r[h], 0);
