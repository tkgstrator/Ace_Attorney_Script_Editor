// 整合性チェックで、状態を見分けるキーを作る。
// キーに入れるのは、この先の動きを変えうるものだけ:
// - 今いる地点（命令・尋問の画面・探偵メニュー）。尋問のシーンなら、証言の段階と番号も
// - その地点で生きている変数（verify-flow.ts）。数値のフラグは、条件式で比べている範囲の外を 1 つにまとめる
// - 持っている証拠品と、人物ファイル（人物ファイルをつきつけられる所があるときだけ）
// - 法廷記録を使えなくしているか（詳しく調べられる証拠品があるときだけ）
// 表示だけのもの（立ち絵・背景・BGM・文中に差し込む値）とライフは入れない。
import type { CompiledScenario, Expr, GameState, Instr, Scene } from '@gyakusai/core';
import { nodeOf, type Flow } from './verify-flow.ts';
import { lookupOf, setOf, type Delta } from './verify-memo.ts';
import { booleanFlags } from './verify-region.ts';

/**
 * 調べるための下ごしらえ: 乱数で飛ぶ命令（random）を、プレイヤーが選ぶ選択肢に置き換える。
 * どの行き先に飛んでも詰まないかを、すべての行き先について調べるため
 */
export function prepare(sc: CompiledScenario): CompiledScenario {
  const scenes: Record<string, Scene> = {};
  for (const [id, scene] of Object.entries(sc.scenes)) {
    if (!scene.program.some((i) => i.op === 'random')) {
      scenes[id] = scene;
      continue;
    }
    const program = scene.program.map(
      (ins): Instr =>
        ins.op !== 'random' || ins.to.length === 0
          ? ins
          : { op: 'choice', options: ins.to.map((to, i) => ({ text: `（乱数 ${i + 1}）`, to })) },
    );
    scenes[id] = { ...scene, program } as Scene;
  }
  return { ...sc, scenes };
}

/**
 * 数値のフラグごとに、区別が要る値の範囲 [lo, hi]。この外の値は lo-1 か hi+1 にまとめてよい。
 * - 条件式では、リテラルとの比べ（== != < <= > >=）と、そのままの真偽（0 かどうか）にしか使われないこと
 *   （足し算・ほかのフラグとの比べに使うなら、まとめずにそのままの値を使う）
 * - add で増やすだけのフラグは上側だけ、減らすだけのフラグは下側だけまとめる（戻ってこられないので）
 * 範囲のないフラグは、値をそのまま使う
 */
export type Bounds = Map<string, { lo: number; hi: number; up: boolean; down: boolean }>;

export function flagBounds(sc: CompiledScenario): Bounds {
  const range = new Map<string, [number, number]>();
  const exact = new Set<string>();
  const note = (flag: string, v: number) => {
    const [lo, hi] = range.get(flag) ?? [v, v];
    range.set(flag, [Math.min(lo, v), Math.max(hi, v)]);
  };
  const CMP = new Set(['==', '!=', '<', '<=', '>', '>=']);
  const walk = (e: Expr | undefined, bool: boolean): void => {
    if (!e) return;
    switch (e.t) {
      case 'var':
        if (bool) note(e.name, 0);
        else exact.add(e.name);
        return;
      case 'not':
        walk(e.e, true);
        return;
      case 'bin': {
        const { l, r } = e;
        if (CMP.has(e.op) && l.t === 'var' && r.t === 'lit' && typeof r.v === 'number') {
          note(l.name, r.v);
          return;
        }
        if (CMP.has(e.op) && r.t === 'var' && l.t === 'lit' && typeof l.v === 'number') {
          note(r.name, l.v);
          return;
        }
        const logic = e.op === '&&' || e.op === '||';
        walk(l, logic);
        walk(r, logic);
        return;
      }
      default:
        return;
    }
  };
  const up = new Set<string>(),
    down = new Set<string>();
  for (const scene of Object.values(sc.scenes)) {
    for (const ins of scene.program) {
      if (ins.op === 'jumpUnless') walk(ins.cond, true);
      if (ins.op === 'choice') ins.options.forEach((o) => walk(o.when, true));
      if (ins.op === 'add') (ins.amount >= 0 ? up : down).add(ins.flag);
    }
    if (scene.kind === 'testimony') scene.statements.forEach((st) => walk(st.when, true));
    if (scene.kind === 'place')
      [...scene.person, ...scene.move, ...scene.talk, ...scene.examine].forEach((x) =>
        walk(x.when, true),
      );
  }
  const out: Bounds = new Map();
  for (const [flag, [lo, hi]] of range) {
    if (exact.has(flag)) continue;
    // 増やすのも減らすのもあるフラグは、まとめた値から戻ってこられるので、まとめない
    if (up.has(flag) && down.has(flag)) continue;
    out.set(flag, { lo, hi, up: !down.has(flag), down: !up.has(flag) });
  }
  return out;
}

const SEP = '\u0001';

/** 人物ファイルをつきつけられる所（人物のいる場所か、人物ファイルを認めるつきつけの要求）があるか */
export function hasProfilePoints(sc: CompiledScenario): boolean {
  return Object.values(sc.scenes).some(
    (scene) =>
      (scene.kind === 'place' && scene.person.length > 0) ||
      scene.program.some((ins) => ins.op === 'demand' && ins.profiles !== undefined),
  );
}

/**
 * 状態を見分けるキーを作る関数。地点ごとに並びが決まっているので、値だけを詰めて並べる。
 * 真偽しか取らない変数は 15 個ずつ 1 文字に詰め、ほかのフラグは区切り文字で囲んで後ろに並べる。
 * 証拠品は番号の文字にして並べる。証拠品を詳しく調べている途中なら、戻り先と、戻り先で生きている変数も入れる
 */
export function keyMaker(
  sc: CompiledScenario,
  flow: Flow,
  bounds: Bounds,
): (s: GameState, d?: Delta) => string {
  const evIndex = new Map(
    Object.keys(sc.evidence).map((id, i) => [id, String.fromCharCode(0x100 + i)]),
  );
  // 人物ファイル（profile のある人物だけ。載っていても profile の無い人物はつきつけられない）
  const profileIndex = hasProfilePoints(sc)
    ? new Map(
        Object.entries(sc.characters)
          .filter(([, c]) => c.profile)
          .map(([id], i) => [id, String.fromCharCode(0x100 + i)]),
      )
    : null;
  const profileKey = (list: string[]) =>
    list
      .flatMap((id) => profileIndex!.get(id) ?? [])
      .sort()
      .join('');
  const lockKey = Object.values(sc.evidence).some((ev) => ev.inspect);
  const bool = booleanFlags(sc);
  // 地点ごとに、キーに入れる変数の並びを、種類と名前に分けて覚えておく
  // （種類 0: 真偽のフラグ・1: visited・2: seen・3: 真偽とは限らないフラグ）
  const plans = new Map<number, { kind: Uint8Array; name: string[] }>();
  const plan = (node: number) => {
    let p = plans.get(node);
    if (!p) {
      const names = flow.live(node);
      p = {
        kind: Uint8Array.from(names, (n) =>
          n.startsWith('v:') ? 1 : n.startsWith('s:') ? 2 : bool.has(n) ? 0 : 3,
        ),
        name: names.map((n) => (/^[vs]:/.test(n) ? n.slice(2) : n)),
      };
      plans.set(node, p);
    }
    return p;
  };
  const evKey = (list: string[]) =>
    list
      .map((id) => evIndex.get(id) ?? SEP + id + SEP)
      .sort()
      .join('');
  // 地点ごとの、変数の名前 → 並びの位置（操作の結果が、その地点のキーに入る変数を書いたかを調べるため）
  const index = new Map<number, Set<string>>();
  const touched = (node: number, d: Delta): boolean => {
    let names = index.get(node);
    if (!names) {
      names = new Set(flow.live(node));
      index.set(node, names);
    }
    for (const n of d.flags.keys()) if (names.has(n)) return true;
    for (const n of d.visited) if (names.has(`v:${n}`)) return true;
    for (const n of d.seen) if (names.has(`s:${n}`)) return true;
    return false;
  };

  /** 状態 s（d があれば、s に操作の結果 d を当てはめた状態）の、地点 node で生きている変数の部分のキー */
  const vars = (s: GameState, node: number, d?: Delta): string => {
    const look = lookupOf(s);
    // 操作の結果が、この地点のキーに入る変数を書いていなければ、元の状態で作ったものを使い回す
    if (d && !touched(node, d)) d = undefined;
    if (!d) {
      const hit = look.vars.get(node);
      if (hit !== undefined) return hit;
    }
    const flag = (n: string) => (d && d.flags.has(n) ? d.flags.get(n) : s.flags[n]);
    const { kind, name } = plan(node);
    let bits = '',
      rest = '',
      word = 0,
      count = 0;
    for (let i = 0; i < kind.length; i++) {
      const n = name[i]!;
      const k = kind[i];
      if (k === 3) {
        rest += SEP + clamp(bounds, n, flag(n));
        continue;
      }
      const on =
        k === 0
          ? flag(n) === true
          : k === 1
            ? setOf(s, 'visited').has(n) || (d?.visited.includes(n) ?? false)
            : setOf(s, 'seen').has(n) || (d?.seen.includes(n) ?? false);
      if (on) word |= 1 << count;
      if (++count === 15) {
        bits += String.fromCharCode(0x8000 | word);
        word = 0;
        count = 0;
      }
    }
    if (count > 0) bits += String.fromCharCode(0x8000 | word);
    const out = bits + rest;
    if (!d) look.vars.set(node, out);
    return out;
  };

  /**
   * 状態 s（d があれば、s に操作の結果 d を当てはめた状態）のキー。
   * 状態ごとに途中の結果を覚えるので、一度キーを作った状態は書き換えないこと
   */
  return (s: GameState, d?: Delta): string => {
    const c = d ? d.control : s;
    const node = nodeOf(flow, c);
    let key = String(node);
    if (sc.scenes[c.scene]?.kind === 'testimony') key += `/${c.phase}/${c.statement}`;
    key += SEP + vars(s, node, d);
    const from = c.inspectFrom;
    if (from) {
      const back = nodeOf(flow, { scene: from.scene, pc: from.pc, mode: from.mode });
      const where = from.mode === 'testimony' ? `/${from.phase}/${from.statement}` : '';
      key += `${SEP}@${back}${where}${SEP}${vars(s, back, d)}`;
    }
    let ev: string;
    if (d?.evidence.final) ev = evKey(d.evidence.final);
    else if (d && d.evidence.append.length > 0)
      ev = evKey([...s.evidence, ...d.evidence.append.filter((x) => !s.evidence.includes(x))]);
    else ev = lookupOf(s).ev ??= evKey(s.evidence);
    if (profileIndex) {
      const list =
        d?.profiles.final ??
        (d && d.profiles.append.length > 0
          ? [...(s.profiles ?? []), ...d.profiles.append]
          : (s.profiles ?? []));
      ev += `#${profileKey(list)}`;
    }
    if (lockKey) ev += (d?.record ?? s.stage.recordLocked) ? '#L' : '#';
    return `${key}#${ev}`;
  };
}

function clamp(bounds: Bounds, flag: string, v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v);
  if (typeof v !== 'number') return String(v);
  const b = bounds.get(flag);
  if (!b) return String(v);
  if (b.up && v > b.hi) return String(b.hi + 1);
  if (b.down && v < b.lo) return String(b.lo - 1);
  return String(v);
}
