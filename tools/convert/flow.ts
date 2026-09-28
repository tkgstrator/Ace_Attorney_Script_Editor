// 台本の区画の間の移動を、変換の前に静的に調べる（どの区画からどの区画へ行けるか）。
import type { CmdOp, Entry, Op } from './types.ts';

/** 区画 → そこから行ける区画（選択肢・飛ぶ・次の区画・ラベル・フラグ分岐） */
export function staticTargets(entry: Entry, section: number): number[] {
  const ops = entry.body[section]?.ops ?? [];
  const out: number[] = [];
  let next: number | null = section + 1;
  for (const o of ops) {
    if (o.op === 'text') continue;
    const c = o as CmdOp;
    const secs = (c.targets ?? []).flatMap((t) => (t ? [t.section] : []));
    switch (c.op) {
      case 8:
      case 9:
        out.push(...secs);
        next = null;
        break;
      case 10:
        out.push(...secs);
        next = null;
        break;
      case 32:
      case 44:
        next = secs[0] ?? next;
        break;
      case 42:
        out.push(...secs);
        next = null;
        break;
      case 54:
      case 120:
        if (c.target?.section != null) out.push(c.target.section);
        next = null;
        break;
      case 53:
      case 122:
        if (c.target?.section != null) out.push(c.target.section);
        break;
      case 21:
      case 22:
      case 36:
      case 69:
      case 121:
        next = null;
        break;
      default:
    }
    if (next === null && [8, 9, 10, 54, 120, 21, 22, 36, 69, 121].includes(c.op)) break;
  }
  if (next !== null && next < entry.body.length) out.push(next);
  return [...new Set(out)];
}

/** 区画 → そこへ来る区画（静的） */
export function staticSources(entry: Entry): Map<number, Set<number>> {
  const out = new Map<number, Set<number>>();
  for (const sec of entry.body) {
    for (const t of staticTargets(entry, sec.section)) {
      if (!out.has(t)) out.set(t, new Set());
      out.get(t)!.add(sec.section);
    }
  }
  return out;
}

/**
 * start から出て、ほかの所からは来ない区画の集まり（証言のゆさぶりから続く選択肢の枝など）。
 * stop の区画（証言の文・ほかの尋問など）には入らない
 */
export function localClosure(entry: Entry, start: number[], stop: Set<number>): Set<number> {
  const src = staticSources(entry);
  const inside = new Set(start);
  for (let changed = true; changed; ) {
    changed = false;
    for (const s of [...inside]) {
      for (const t of staticTargets(entry, s)) {
        if (inside.has(t) || stop.has(t)) continue;
        const from = src.get(t) ?? new Set();
        if ([...from].every((f) => inside.has(f))) {
          inside.add(t);
          changed = true;
        }
      }
    }
  }
  for (const s of start) inside.delete(s);
  return inside;
}

type RoutedStatement = {
  section: number;
  next: number;
  next_route?: { op: string; flag?: number; if_set?: number; else?: number; goto?: number } | null;
};

/**
 * 尋問の文の並びと、それぞれが出る条件。元の尋問は「次へ」で次の区画へ進み、42 でフラグにより別の文へ分かれる
 * （ゆさぶりで文が増える場面）。分かれ目のフラグの値の組ごとに最初の文からたどり、文の並びをまとめる。
 * 返り値: 並べた文の区画と、それが出るフラグの組（すべての組で出るなら null）
 */
export function statementRoutes(statements: RoutedStatement[]): {
  order: number[];
  when: Map<number, Record<number, boolean>[] | null>;
} {
  const bySec = new Map(statements.map((s) => [s.section, s]));
  const flags = [
    ...new Set(
      statements.flatMap((s) =>
        s.next_route?.op === 'testimony_jump' && s.next_route.flag !== undefined
          ? [s.next_route.flag]
          : [],
      ),
    ),
  ].slice(0, 4);
  const combos: Record<number, boolean>[] = [];
  for (let m = 0; m < 1 << flags.length; m++)
    combos.push(Object.fromEntries(flags.map((f, i) => [f, ((m >> i) & 1) === 1])));
  const seqs = combos.map((c) => {
    const seq: number[] = [];
    let cur: number | undefined = statements[0]?.section;
    while (cur !== undefined && bySec.has(cur) && !seq.includes(cur)) {
      seq.push(cur);
      const s = bySec.get(cur)!;
      const r = s.next_route;
      if (r?.op === 'testimony_jump' && r.flag !== undefined) cur = c[r.flag] ? r.if_set : r.else;
      else if (r?.goto !== undefined) cur = r.goto;
      else cur = s.next;
    }
    return seq;
  });
  // 並び: 各たどり方の前後関係を満たす順（初めて出た順を優先）
  const order: number[] = [];
  const all = [...new Set(seqs.flat())];
  const before = new Map<number, Set<number>>(all.map((v) => [v, new Set()]));
  for (const seq of seqs)
    for (let i = 1; i < seq.length; i++) before.get(seq[i]!)!.add(seq[i - 1]!);
  while (order.length < all.length) {
    const next =
      all.find((v) => !order.includes(v) && [...before.get(v)!].every((b) => order.includes(b))) ??
      all.find((v) => !order.includes(v))!;
    order.push(next);
  }
  // どの文もたどれなかったもの（表だけにある文）は後ろに
  for (const s of statements) if (!order.includes(s.section)) order.push(s.section);
  const when = new Map<number, Record<number, boolean>[] | null>();
  for (const v of order) {
    const ok = combos.filter((_, i) => seqs[i]!.includes(v));
    when.set(v, ok.length === combos.length || ok.length === 0 ? null : ok);
  }
  return { order, when };
}

/**
 * 表（尋問・つきつけ・探偵パート）からも、ほかの区画からも行き先にならない区画（DS 版の下画面の遊び
 * ─ 指紋・人物の指名など ─ の結果として、ARM9 の未解明の表から選ばれるもの）
 */
export function orphanSections(entry: Entry, tableRefs: Set<number>): Set<number> {
  const src = staticSources(entry);
  const out = new Set<number>();
  for (const sec of entry.body) {
    if (sec.section === 0 || tableRefs.has(sec.section) || src.has(sec.section)) continue;
    out.add(sec.section);
  }
  return out;
}

/**
 * 人物の指名（116 10 n、第 5 話）の結果の区画: [外れ, 正解]。
 * 外れは指名の次の区画。そこから次の区画へそのまま落ちていく区画（13 end で終わるだけの区画）をたどり、
 * 落ちなくなった区画（飛ぶ・探偵メニューへ戻るなど）の次が正解（第 5 話の 6 か所すべてで合う。056 §40 は §41 → §42 が外れ、§43 が正解）。
 * 正解の後の区画（056 §44 の話題「巌徒海慈」など）は指名の結果ではない
 */
export function nominationResults(entry: Entry, section: number): number[] {
  const wrong = section + 1;
  if (!entry.body[wrong]) return [];
  let end = wrong;
  for (
    let t = staticTargets(entry, end);
    t.length === 1 && t[0] === end + 1 && entry.body[end + 1];
    t = staticTargets(entry, end)
  )
    end++;
  return entry.body[end + 1] ? [wrong, end + 1] : [wrong];
}

/**
 * i の 53 から先の位置（ops[j]）への飛び越しを、ブロックにしてよいか:
 * 間にある 53 のバイト位置の飛び先が、すべて at 以下で前向き
 */
export function nested(ops: Op[], i: number, j: number, at: number): boolean {
  for (let k = i + 1; k < j; k++) {
    const o = ops[k]!;
    if (o.op !== 53) continue;
    const t = o.target;
    if (!t || t.section !== null) continue;
    if (t.offset > at || t.offset <= o.at) return false;
  }
  return true;
}
