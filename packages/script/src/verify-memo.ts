// 整合性チェックで、同じ操作の結果を覚えておいて使い回す（操作の結果のメモ）。
//
// 操作の結果は、操作を始めた場面（シーン・pc・段階など）と、実行中に読んだ変数（フラグ・証拠品・visited・seen）の
// 値だけで決まる。そこで、操作を実行するときに、読んだ変数と書いた変数を記録しておき、
// 次に同じ場面で同じ操作をするときに、読んだ変数の値がすべて同じなら、実行せずに書いた変数だけを当てはめる。
// 読んだ変数を漏れなく記録するので、近似ではない。探偵パートで、話題の進み具合だけが違う多くの状態から
// 同じ所を調べる・同じ証拠品をつきつけるときに、実行を省ける。
import type { GameState, Value } from '@gyakusai/core';

/** 操作の結果（始めの状態からの変化） */
export interface Delta {
  control: Pick<GameState, 'scene' | 'pc' | 'mode' | 'phase' | 'statement' | 'inspectFrom'>;
  /** 書いたフラグの最後の値 */
  flags: Map<string, Value>;
  /** 証拠品: まるごと読んでから変えたときは最後の並び、そうでなければ足した証拠品 */
  evidence: { final?: string[]; append: string[] };
  /** 人物ファイル（証拠品と同じ形） */
  profiles: { final?: string[]; append: string[] };
  /** 法廷記録を使えなくしているか（書いたときだけ） */
  record?: boolean;
  visited: string[];
  seen: string[];
}

type ListName = 'evidence' | 'profiles' | 'visited' | 'seen';
const LISTS = ['evidence', 'profiles', 'visited', 'seen'] as const;
const PREFIX: Record<ListName, string> = { evidence: 'h:', profiles: 'p:', visited: 'v:', seen: 's:' };
const WHOLE: Record<ListName, string> = { evidence: '*h', profiles: '*p', visited: '*v', seen: '*s' };
/** 法廷記録の鍵（stage.recordLocked）を読んだときの名前 */
const RECORD = 'r:';

/** 実行中の読み書きを記録する */
export class Recorder {
  /** 読んだ名前と、そのときの値（書いた後に読んだものは入れない） */
  reads = new Map<string, string>();
  written = new Map<string, Value>();
  appended: Record<ListName, string[]> = { evidence: [], profiles: [], visited: [], seen: [] };
  /** 法廷記録の鍵に書いた値 */
  private record: boolean | undefined;
  private stage: GameState['stage'] | undefined;
  /** 記録しきれない読み書きをした（このときはメモしない） */
  unknown = false;
  private flags: Record<string, Value> = {};
  private lists = {} as Record<ListName, { target: string[]; proxy: string[] }>;

  /** 状態に見張りを付ける（エンジンの中の状態そのものを差し替える） */
  attach(s: GameState): void {
    const note = (t: Record<string, Value>, k: string | symbol) => {
      if (typeof k === 'string' && !this.written.has(k) && !this.reads.has(k)) this.reads.set(k, enc(t[k]));
    };
    this.flags = s.flags;
    s.flags = new Proxy(s.flags, {
      get: (t, k) => { note(t, k); return Reflect.get(t, k); },
      has: (t, k) => { note(t, k); return Reflect.has(t, k); },
      set: (t, k, v) => { if (typeof k === 'string') this.written.set(k, v as Value); return Reflect.set(t, k, v); },
      ownKeys: t => { this.unknown = true; return Reflect.ownKeys(t); },
      deleteProperty: (t, k) => { this.unknown = true; return Reflect.deleteProperty(t, k); },
    });
    for (const name of LISTS) {
      const target = s[name] ?? [];
      const proxy = this.list(name, target);
      this.lists[name] = { target, proxy };
      s[name] = proxy;
    }
    // 舞台は、法廷記録の鍵だけを見張る（詳しく調べられるかに効く。ほかは表示だけ）
    this.stage = s.stage;
    s.stage = new Proxy(s.stage, {
      get: (t, k, r) => {
        if (k === 'recordLocked' && this.record === undefined && !this.reads.has(RECORD)) this.reads.set(RECORD, String(t.recordLocked));
        return Reflect.get(t, k, r);
      },
      set: (t, k, v) => { if (k === 'recordLocked') this.record = v as boolean; return Reflect.set(t, k, v); },
    });
  }

  private list(name: ListName, arr: string[]): string[] {
    // まるごと読んだときは、始めの並び（この実行で足したものを除く）を記録する
    const whole = () => {
      if (this.reads.has(WHOLE[name])) return;
      const added = this.appended[name];
      this.reads.set(WHOLE[name], arr.filter(x => !added.includes(x)).sort().join('\u0001'));
    };
    return new Proxy(arr, {
      get: (t, k, r) => {
        if (k === 'includes') {
          return (id: string) => {
            const key = PREFIX[name] + id;
            if (!this.appended[name].includes(id) && !this.reads.has(key)) this.reads.set(key, t.includes(id) ? '1' : '0');
            return t.includes(id);
          };
        }
        if (k === 'push') return (...items: string[]) => { this.appended[name].push(...items); return t.push(...items); };
        whole();
        return Reflect.get(t, k, r);
      },
      set: (t, k, v) => { this.unknown = true; return Reflect.set(t, k, v); },
    });
  }

  /** 実行し終えた状態から変化を取り出し、見張りを外す */
  finish(s: GameState): Delta {
    s.flags = this.flags;
    const out: Delta = {
      control: { scene: s.scene, pc: s.pc, mode: s.mode, phase: s.phase, statement: s.statement, inspectFrom: s.inspectFrom ?? null },
      flags: new Map(this.written),
      evidence: { append: [...this.appended.evidence] },
      profiles: { append: [...this.appended.profiles] },
      ...(this.record !== undefined ? { record: this.record } : {}),
      visited: [...this.appended.visited],
      seen: [...this.appended.seen],
    };
    if (this.stage) { s.stage = this.stage; this.stage = undefined; }
    for (const name of LISTS) {
      const { target, proxy } = this.lists[name];
      if (s[name] === proxy) { s[name] = target; continue; }
      // 並びごと入れ替えた（証拠品の take・人物ファイルの出し入れ）。まるごと読んでいるので、最後の並びは読んだ値で決まる
      s[name] = [...s[name]!];
      if ((name !== 'evidence' && name !== 'profiles') || !this.reads.has(WHOLE[name])) this.unknown = true;
      else out[name] = { final: [...s[name]!], append: [] };
    }
    return out;
  }
}

function enc(v: unknown): string {
  return typeof v === 'string' ? JSON.stringify(v) : String(v);
}

/** 状態ごとの下ごしらえ（同じ状態から何度も引くので覚えておく）。キーを作るとき（verify-key.ts）にも使う */
export interface Lookup {
  sets: Partial<Record<ListName, Set<string>>>;
  whole: Partial<Record<ListName, string>>;
  /** 地点ごとの、変数の部分のキー */
  vars: Map<number, string>;
  /** フラグの値の書き方 */
  flags: Map<string, string>;
  ev?: string;
}
const lookups = new WeakMap<GameState, Lookup>();
const LIST_OF: Record<string, ListName> = {
  'h:': 'evidence', 'p:': 'profiles', 'v:': 'visited', 's:': 'seen', '*h': 'evidence', '*p': 'profiles', '*v': 'visited', '*s': 'seen',
};

export function lookupOf(s: GameState): Lookup {
  let l = lookups.get(s);
  if (!l) { l = { sets: {}, whole: {}, vars: new Map(), flags: new Map() }; lookups.set(s, l); }
  return l;
}

export function setOf(s: GameState, list: ListName): Set<string> {
  const l = lookupOf(s);
  return (l.sets[list] ??= new Set(s[list] ?? []));
}

/** 状態から、読んだ名前の値を取り出す（Recorder と同じ書き方） */
function valueOf(s: GameState, name: string): string {
  if (name === RECORD) return String(s.stage.recordLocked);
  const list = LIST_OF[name.slice(0, 2)];
  if (!list) {
    const l = lookupOf(s);
    let v = l.flags.get(name);
    if (v === undefined) { v = enc(s.flags[name]); l.flags.set(name, v); }
    return v;
  }
  if (name[0] === '*') return (lookupOf(s).whole[list] ??= [...s[list] ?? []].sort().join('\u0001'));
  return setOf(s, list).has(name.slice(2)) ? '1' : '0';
}

/** 場面と操作ごとに、読んだ名前の組と、その値ごとの結果 */
export class Memo {
  private table = new Map<string, { names: string[]; results: Map<string, Delta> }[]>();
  hits = 0;
  misses = 0;

  get(where: string, s: GameState): Delta | undefined {
    const sets = this.table.get(where);
    if (sets) {
      for (const { names, results } of sets) {
        const d = results.get(names.map(n => valueOf(s, n)).join('\u0002'));
        if (d) { this.hits++; return d; }
      }
    }
    this.misses++;
    return undefined;
  }

  set(where: string, reads: Map<string, string>, d: Delta): void {
    const names = [...reads.keys()].sort();
    const id = names.join('\u0002');
    let sets = this.table.get(where);
    if (!sets) { sets = []; this.table.set(where, sets); }
    let entry = sets.find(x => x.names.join('\u0002') === id);
    if (!entry) { entry = { names, results: new Map() }; sets.push(entry); }
    entry.results.set(names.map(n => reads.get(n)!).join('\u0002'), d);
  }
}

/** 変化を当てはめた状態の「見かけ」（キーを作るためだけ。フラグは元の状態を下敷きにする） */
export function view(s: GameState, d: Delta): GameState {
  const flags = Object.create(s.flags) as Record<string, Value>;
  for (const [k, v] of d.flags) flags[k] = v;
  return {
    ...s, ...d.control, flags,
    evidence: d.evidence.final ?? appendNew(s.evidence, d.evidence.append),
    profiles: d.profiles.final ?? appendNew(s.profiles ?? [], d.profiles.append),
    stage: d.record === undefined ? s.stage : { ...s.stage, recordLocked: d.record },
    visited: appendNew(s.visited, d.visited),
    seen: appendNew(s.seen, d.seen),
  };
}

/**
 * 変化を当てはめた、本物の状態（新しく見つけた状態のときだけ作る）。
 * 表示・文中の値・ライフは、この先の動きに効かないので、始めの状態のものを使う（法廷記録の鍵は除く）
 */
export function apply(s: GameState, d: Delta): GameState {
  const v = view(s, d);
  const out: GameState = {
    ...clone({ ...s, flags: {} }), ...d.control, inspectFrom: clone(d.control.inspectFrom),
    flags: { ...s.flags, ...Object.fromEntries(d.flags) },
    evidence: [...v.evidence], profiles: [...v.profiles!], visited: [...v.visited], seen: [...v.seen],
  };
  if (d.record !== undefined) out.stage.recordLocked = d.record;
  return out;
}

/** JSON で表せるデータの深い複製 */
function clone<T>(x: T): T {
  if (typeof x !== 'object' || x === null) return x;
  if (Array.isArray(x)) return x.map(clone) as T;
  const o: Record<string, unknown> = {};
  for (const k in x) o[k] = clone((x as Record<string, unknown>)[k]);
  return o as T;
}

function appendNew(list: string[], items: string[]): string[] {
  return items.length === 0 ? list : [...list, ...items.filter(x => !list.includes(x))];
}
