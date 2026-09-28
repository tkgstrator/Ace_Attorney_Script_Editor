import type { Expr, PlaceScene } from '@gyakusai/core';
import { Builder } from './builder.ts';
import type { Path } from './compile.ts';
import { emitChallenge, type LockRegistry } from './compile-lock.ts';
import type { RawPlace, RawScenario } from './schema.ts';

/** 場所の変換に使う、コンパイラ本体の検証・変換の関数 */
export interface PlaceContext {
  player: string | null;
  compileSteps(steps: unknown, path: Path, b: Builder): void;
  cond(src: string, path: Path): Expr | undefined;
  checkCharacter(id: string, path: Path): void;
  checkEvidence(id: string, path: Path): void;
  checkPlace(id: string, path: Path): void;
  /** つきつけの表のキーが、証拠品か人物ファイルか（どちらでもなければエラーを報告して null） */
  presentKind(id: string, path: Path): 'evidence' | 'profile' | null;
  error(path: Path, message: string): void;
  /** サイコ・ロック（compile-lock.ts）と、挑むのに使う証拠品 */
  locks?: LockRegistry;
  lockKeys?: string[];
}

/** つきつけの表（demand・場所の present）のキーの種類を決める関数を作る */
export function presentKindOf(
  characters: RawScenario['characters'],
  evidence: RawScenario['evidence'],
  error: (path: Path, message: string) => void,
): PlaceContext['presentKind'] {
  return (id, path) => {
    const isEvidence = id in evidence;
    if (isEvidence && id in characters) {
      error(
        path,
        `「${id}」は証拠品と人物の両方の ID なので、つきつけの表ではどちらか分かりません。どちらかの ID を変えてください`,
      );
      return null;
    }
    if (isEvidence) return 'evidence';
    if (!(id in characters)) {
      error(path, `未定義の証拠品・人物です: ${id}`);
      return null;
    }
    if (!characters[id]!.profile) {
      error(path, `人物「${id}」には profile が無いので、人物ファイルとしてつきつけられません`);
      return null;
    }
    return 'profile';
  };
}

/** 調べた・話した印の ID（省略時は 場所ID_examine1 など） */
export function seenIds(id: string, raw: RawPlace): string[] {
  return [
    ...(raw.examine ?? []).map((e, i) => e.id ?? `${id}_examine${i + 1}`),
    ...(raw.talk ?? []).map((t, i) => t.id ?? `${id}_talk${i + 1}`),
  ];
}

/**
 * 探索編の場所を、1 つの命令列にまとめる。各行動のブロックは、終わると探偵メニューに戻る（menu 命令）。
 * 何もない所を調べたとき・見当違いの証拠品をつきつけたときの既定の反応もここで作る
 */
export function compilePlace(ctx: PlaceContext, id: string, raw: RawPlace, path: Path): PlaceScene {
  const b = new Builder();
  const block = (steps: unknown, p: Path): number => {
    const pc = b.pc;
    ctx.compileSteps(steps, p, b);
    b.emit({ op: 'menu' });
    return pc;
  };
  const when = (src: string | undefined, p: Path) =>
    src !== undefined ? ctx.cond(src, p) : undefined;

  const person = typeof raw.person === 'string' ? [{ id: raw.person }] : (raw.person ?? []);
  const scene: PlaceScene = {
    kind: 'place',
    id,
    name: raw.name,
    background: raw.background ?? id,
    person: person.map((c, i) => {
      ctx.checkCharacter(c.id, [
        ...path,
        'person',
        ...(typeof raw.person === 'string' ? [] : [i, 'id']),
      ]);
      const w = 'when' in c ? when(c.when, [...path, 'person', i, 'when']) : undefined;
      return w ? { id: c.id, when: w } : { id: c.id };
    }),
    program: b.code,
    examine: [],
    examineDefault: -1,
    talk: [],
    present: {},
    presentWrong: -1,
    move: [],
  };
  if (raw.examineScroll === false) scene.examineScroll = { t: 'lit', v: false };
  else if (typeof raw.examineScroll === 'string') {
    const c = when(raw.examineScroll, [...path, 'examineScroll']);
    if (c) scene.examineScroll = c;
  }
  if (raw.enter) scene.enter = block(raw.enter, [...path, 'enter']);

  const seen = seenIds(id, raw);
  (raw.examine ?? []).forEach((e, i) => {
    const p = [...path, 'examine', i];
    const [x, y, w, h] = e.area;
    // 範囲は背景の座標（背景の大きさはここでは分からないので、右・下の端は見ない）
    if (w <= 0 || h <= 0 || x < 0 || y < 0) {
      ctx.error([...p, 'area'], '範囲が背景の左・上の端より外にはみ出しているか、大きさが 0 です');
    }
    const c = when(e.when, [...p, 'when']);
    scene.examine.push({
      id: seen[i]!,
      ...(e.name ? { name: e.name } : {}),
      area: e.area,
      ...(c ? { when: c } : {}),
      pc: block(e.then, [...p, 'then']),
    });
  });
  scene.examineDefault = raw.examineDefault
    ? block(raw.examineDefault, [...path, 'examineDefault'])
    : block([{ narrate: '特に気になるものはない。' }], [...path, 'examineDefault']);

  const talkBase = (raw.examine ?? []).length;
  (raw.talk ?? []).forEach((t, i) => {
    const p = [...path, 'talk', i];
    const c = when(t.when, [...p, 'when']);
    const locked = when(t.locked, [...p, 'locked']);
    scene.talk.push({
      id: seen[talkBase + i]!,
      topic: t.topic,
      ...(c ? { when: c } : {}),
      ...(locked ? { locked } : {}),
      pc: block(t.then, [...p, 'then']),
    });
  });
  if ((raw.talk ?? []).length > 0 && person.length === 0)
    ctx.error([...path, 'talk'], '話題がありますが、この場所に人物（person）がいません');

  for (const [ev, steps] of Object.entries(raw.present ?? {})) {
    const kind = ctx.presentKind(ev, [...path, 'present', ev]);
    const pc = block(steps, [...path, 'present', ev]);
    if (kind === 'profile') {
      scene.presentProfile ??= {};
      scene.presentProfile[ev] = pc;
    } else scene.present[ev] = pc;
  }
  scene.presentWrong = raw.presentWrong
    ? block(raw.presentWrong, [...path, 'presentWrong'])
    : block([{ narrate: '特に反応はなかった。' }], [...path, 'presentWrong']);
  // サイコ・ロック: この場所で決められたロックがあれば、勾玉をつきつけたときに挑む（無ければ元の反応）
  if (ctx.locks && [...ctx.locks.values()].some((l) => l.places.has(id))) {
    for (const key of ctx.lockKeys ?? []) {
      const fallback = scene.present[key] ?? scene.presentWrong;
      scene.present[key] = b.pc;
      emitChallenge(b, ctx.locks, id, scene.person, fallback);
    }
  }

  (raw.move ?? []).forEach((m, i) => {
    const to = typeof m === 'string' ? m : m.to;
    const p = typeof m === 'string' ? [...path, 'move', i] : [...path, 'move', i, 'to'];
    ctx.checkPlace(to, p);
    if (to === id) ctx.error(p, '移動先に自分自身の場所は書けません');
    const c = typeof m === 'string' ? undefined : when(m.when, [...path, 'move', i, 'when']);
    scene.move.push(c ? { to, when: c } : { to });
  });
  return scene;
}
