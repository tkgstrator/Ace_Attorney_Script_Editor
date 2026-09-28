// 遊んでいる途中の状態を、編集した後のシナリオに持ち込んで、同じ場面から続ける（エディタのプレビュー用）。
// 状態はセーブデータと同じもの（GameState）で、セーブデータの読み込み（Engine のコンストラクタ）で戻す。
// 位置が合わせられなければ、状態を保ったままそのシーンの始めから、それも無理なら最初から始める。
// エンジンの実行の意味は変えない（位置と、消えた証拠品・フラグなどのデータを直すだけ）。
import { cloneData } from './clone.ts';
import { Engine } from './engine.ts';
import { mapPc } from './relocate.ts';
import { migrateState } from './state.ts';
import type { CompiledScenario, GameState, InspectFrame } from './types.ts';

/**
 * same: 同じ場面から（位置の番号も同じ） / moved: 同じ場面から（編集で位置がずれた・その台詞が変わった）
 * sceneStart: 状態を保ったまま、シーンの始めから / start: 最初から
 */
export type RestoreResult = 'same' | 'moved' | 'sceneStart' | 'start';

export interface Restored {
  engine: Engine;
  result: RestoreResult;
  /** 続けるシーン */
  scene: string;
  /** 何をしたか（直したデータ・位置を合わせられなかった理由など） */
  notes: string[];
}

export interface RestoreOptions {
  /** 位置は合わせず、状態を保ったままこのシーンの始めから遊ぶ */
  scene?: string;
}

/** 前のシナリオで遊んでいた状態を、新しいシナリオで続ける */
export function restoreEngine(
  next: CompiledScenario,
  prev: { scenario: CompiledScenario; state: Readonly<GameState> },
  opts: RestoreOptions = {},
): Restored {
  const notes: string[] = [];
  const s = fixData(next, migrateState(cloneData(prev.state), next), notes);

  const start = (why: string): Restored => {
    notes.push(why);
    return { engine: new Engine(next), result: 'start', scene: next.startScene, notes };
  };
  const sceneStart = (scene: string, why?: string): Restored => {
    if (!next.scenes[scene]) return start(`シーン「${scene}」が無くなったので、最初から始めます`);
    if (why) notes.push(why);
    try {
      // 探偵メニューの状態なら、コンストラクタは命令を実行しない。そこから jumpTo で入り直す
      const engine = new Engine(next, { version: 1, scenario: next.id, state: s });
      engine.jumpTo(scene);
      void engine.beat;
      return { engine, result: 'sceneStart', scene, notes };
    } catch (e) {
      return start(`シーン「${scene}」の始めから続けられないので、最初から始めます（${msg(e)}）`);
    }
  };

  const at = s.inspectFrom ? s.inspectFrom.scene : s.scene;
  if (opts.scene !== undefined) {
    s.mode = 'investigate';
    return sceneStart(opts.scene);
  }
  const moved = locate(prev.scenario, next, s);
  if (typeof moved === 'string') {
    s.mode = 'investigate';
    return sceneStart(at, moved);
  }
  try {
    const engine = new Engine(next, { version: 1, scenario: next.id, state: cloneData(s) });
    void engine.beat; // 条件式の未定義のフラグなどは、ここでエラーになる
    return { engine, result: moved ? 'moved' : 'same', scene: engine.state.scene, notes };
  } catch (e) {
    s.mode = 'investigate';
    return sceneStart(at, `同じ場面から続けられないので、シーンの始めから続けます（${msg(e)}）`);
  }
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** 消えた証拠品・人物・フラグを外し、足されたフラグに初期値を入れる */
function fixData(next: CompiledScenario, s: GameState, notes: string[]): GameState {
  const gone = (what: string, ids: string[]) => {
    if (ids.length) notes.push(`無くなった${what}を外しました: ${ids.join('、')}`);
  };
  const added = Object.keys(next.flags).filter((k) => !(k in s.flags));
  for (const k of added) s.flags[k] = next.flags[k]!;
  if (added.length) notes.push(`足されたフラグを初期値にしました: ${added.join('、')}`);
  const removed = Object.keys(s.flags).filter((k) => !(k in next.flags));
  for (const k of removed) delete s.flags[k];
  gone('フラグ', removed);
  gone(
    '証拠品',
    s.evidence.filter((id) => !next.evidence[id]),
  );
  s.evidence = s.evidence.filter((id) => next.evidence[id]);
  s.profiles = (s.profiles ?? []).filter((id) => next.characters[id]);
  s.life = Math.min(s.life, next.maxLife);
  const st = s.stage;
  if (st.character !== null && !next.characters[st.character]) st.character = null;
  if (st.evidence !== null && !next.evidence[st.evidence]) st.evidence = null;
  return s;
}

/**
 * 状態の位置（シーン・pc・証言の番号・詳しく調べ始めた場面）を新しいシナリオに合わせる。
 * 合わせたら、位置がずれたか（true / false）。合わせられなければ理由
 */
function locate(prev: CompiledScenario, next: CompiledScenario, s: GameState): boolean | string {
  let moved = false;
  const place = (
    p: Pick<InspectFrame, 'scene' | 'pc' | 'mode' | 'statement'>,
  ): string | undefined => {
    const a = prev.scenes[p.scene];
    const b = next.scenes[p.scene];
    if (!b) return `シーン「${p.scene}」が無くなりました`;
    if (!a || a.kind !== b.kind) return `シーン「${p.scene}」の種類が変わりました`;
    if (p.mode === 'run') {
      const m = mapPc(a.program, b.program, p.pc);
      if (!m) return `シーン「${p.scene}」で、遊んでいた位置が見つかりません`;
      if (m.how !== 'same') moved = true;
      p.pc = m.pc;
    }
    if (p.mode === 'testimony' && a.kind === 'testimony' && b.kind === 'testimony') {
      const id = a.statements[p.statement ?? 0]?.id;
      const i = b.statements.findIndex((x) => x.id === id);
      if (i < 0) return `証言「${id}」が無くなりました`;
      if (i !== p.statement) moved = true;
      p.statement = i;
    }
    return undefined;
  };
  const why = place(s);
  if (why) return `${why}。シーンの始めから続けます`;
  if (s.inspectFrom) {
    const f = s.inspectFrom;
    if (place(f)) {
      // 戻り先が合わせられないなら、詳しく調べるのをやめて、調べ始めたシーンの始めから
      return '詳しく調べ始めた場面が見つからないので、そのシーンの始めから続けます';
    }
  }
  return moved;
}
