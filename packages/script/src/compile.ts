import {
  type CompiledScenario,
  type Expr,
  ExprSyntaxError,
  exprRefs,
  type PartDef,
  parseExpr,
  parseRich,
  RichTextError,
  type Scene,
  type Value,
} from '@gyakusai/core';
import type { z } from 'zod';
import { Builder } from './builder.ts';
import { compileCharacters } from './compile-description.ts';
import { compileInspect } from './compile-inspect.ts';
import { collectLocks, emitEnd, lockEndScenes, lockFlags, lockOutScenes } from './compile-lock.ts';
import { compilePlace, type PlaceContext, presentKindOf, seenIds } from './compile-place.ts';
import { makeStepCompiler } from './compile-step.ts';
import { compileTestimony } from './compile-testimony.ts';
import { describeIssue } from './issues.ts';
import { type RawPlace, type RawScenario, RESERVED_KEYS, scenarioSchema } from './schema.ts';
import { collectSources, type SourceMap } from './source-map.ts';

export type Path = (string | number)[];

export interface Diagnostic {
  severity: 'error' | 'warning';
  message: string;
  path: Path;
  /** 1 始まり。YAML から読み込んだときだけ入る */
  line?: number;
  column?: number;
}

export interface CompileResult {
  scenario: CompiledScenario | null;
  diagnostics: Diagnostic[];
  /** シーンごとの、各命令の元になったステップの位置（コンパイルできたときだけ。エディタの「ここから再生」用） */
  sources?: SourceMap;
}

const DEFAULT_LIFE = 10;
const DEFAULT_PENALTY = 2;
const BUILTIN_GAMEOVER = '__gameover';
const INTERPOLATION = /\{([A-Za-z_][A-Za-z0-9_]*)\}/g;

/** YAML を読み込んだ後の JS 値を検証し、core が実行できる形に変換する */
export function compile(raw: unknown): CompileResult {
  const diagnostics: Diagnostic[] = [];
  const seen = new Set<string>();
  const report = (severity: Diagnostic['severity'], path: Path, message: string) => {
    const key = `${severity}\0${path.join('.')}\0${message}`;
    if (seen.has(key)) return; // 既定ブロックを複数箇所に展開したときの重複を除く
    seen.add(key);
    diagnostics.push({ severity, path, message });
  };
  const error = (path: Path, message: string) => report('error', path, message);
  const warn = (path: Path, message: string) => report('warning', path, message);
  const zodIssues = (base: Path, err: z.ZodError) => {
    for (const issue of err.issues) error([...base, ...(issue.path as Path)], describeIssue(issue));
  };

  const parsed = scenarioSchema.safeParse(raw);
  if (!parsed.success) {
    zodIssues([], parsed.error);
    return { scenario: null, diagnostics };
  }
  const src: RawScenario = parsed.data;
  const characters = src.characters;
  const evidence = src.evidence;
  // サイコ・ロックの状態はフラグに持つ（compile-lock.ts）。名前は __lock で始まり、YAML の flags には書かない
  const locks = collectLocks(src);
  const flags: Record<string, Value> = { ...(src.flags ?? {}), ...lockFlags(locks) };
  const lockKeys = src.psycheLock?.keys ?? [];
  const lockHeal = src.psycheLock?.heal ?? 0;
  // 編（parts）ごとのシーン・場所を、章全体の一覧にまとめる。編に分けていなければ全体を 1 つの裁判編とする
  type SceneBody = NonNullable<RawScenario['scenes']>[string];
  const sceneEntries: { id: string; body: SceneBody; path: Path; trial: boolean }[] = [];
  const placeEntries: { id: string; body: RawPlace; path: Path }[] = [];
  const parts: PartDef[] = [];
  const allIds = new Map<string, Path>();
  const claim = (id: string, path: Path) => {
    const prev = allIds.get(id);
    if (prev)
      error(
        path,
        `ID「${id}」が重複しています（${prev.join('.')} と同じ）。シーン・場所の ID は章の中で重ならないようにしてください`,
      );
    else allIds.set(id, path);
  };
  if (src.scenes) {
    for (const [id, body] of Object.entries(src.scenes)) {
      claim(id, ['scenes', id]);
      sceneEntries.push({ id, body, path: ['scenes', id], trial: true });
    }
    parts.push({ id: 'main', kind: 'trial', title: src.title, scenes: Object.keys(src.scenes) });
  }
  (src.parts ?? []).forEach((part, pi) => {
    const partScenes = Object.entries(part.scenes ?? {});
    for (const [id, body] of partScenes) {
      const path: Path = ['parts', pi, 'scenes', id];
      claim(id, path);
      sceneEntries.push({ id, body, path, trial: part.kind === 'trial' });
    }
    const partPlaces = Object.entries(part.places ?? {});
    if (partPlaces.length > 0 && part.kind !== 'investigation')
      error(['parts', pi, 'places'], '場所（places）は探索編（kind: investigation）にだけ書けます');
    for (const [id, body] of partPlaces) {
      const path: Path = ['parts', pi, 'places', id];
      claim(id, path);
      placeEntries.push({ id, body, path });
    }
    parts.push({
      id: part.id,
      kind: part.kind,
      title: part.title,
      scenes: [...partScenes, ...partPlaces].map(([id]) => id),
    });
  });
  if (sceneEntries.length === 0 && placeEntries.length === 0)
    error([], 'シーンがありません（scenes か parts を書いてください）');
  const sceneIds = sceneEntries.map((e) => e.id);
  const placeIds = placeEntries.map((e) => e.id);
  const allSeen = new Set(placeEntries.flatMap((e) => seenIds(e.id, e.body)));
  const scenePath = (id: string): Path => allIds.get(id) ?? ['scenes', id];
  const player = src.player ?? null;
  const penaltyDefault = src.defaults?.penalty ?? DEFAULT_PENALTY;

  const readFlags = new Set<string>();
  const referencedScenes = new Set<string>();

  // ---- 参照チェック ----
  const checkCharacter = (id: string, path: Path) => {
    if (!(id in characters)) error(path, `未定義の人物です: ${id}`);
  };
  const checkEvidence = (id: string, path: Path) => {
    if (!(id in evidence)) error(path, `未定義の証拠品です: ${id}`);
  };
  const presentKind = presentKindOf(characters, evidence, error);
  const checkScene = (id: string, path: Path) => {
    if (placeIds.includes(id))
      error(path, `「${id}」は場所です。場所へ行くには investigate を使ってください`);
    else if (!sceneIds.includes(id)) error(path, `未定義のシーンです: ${id}`);
    referencedScenes.add(id);
  };
  const checkPlace = (id: string, path: Path) => {
    if (!placeIds.includes(id)) error(path, `未定義の場所です: ${id}`);
    referencedScenes.add(id);
  };
  /** 文中の差し込み（{フラグ}）を記録し、rich なら文中コマンド（[wait 8] など）の書き方も確かめる */
  /** 文中の [show 人物] の人物が定義されているか */
  const checkInlineRefs = (text: string, path: Path) => {
    if (!text.includes('[show')) return;
    try {
      for (const m of parseRich(text).marks)
        if (m.command.cmd === 'show' && m.command.id) checkCharacter(m.command.id, path);
    } catch {
      /* 書き方の誤りは checkText が報告する */
    }
  };
  const checkText = (text: string, path?: Path) => {
    for (const m of text.matchAll(INTERPOLATION)) readFlags.add(m[1]!);
    if (!path) return;
    try {
      parseRich(text);
    } catch (e) {
      if (e instanceof RichTextError) error(path, e.message);
      else throw e;
    }
  };
  const cond = (srcExpr: string, path: Path): Expr | undefined => {
    let e: Expr;
    try {
      e = parseExpr(srcExpr);
    } catch (err) {
      if (err instanceof ExprSyntaxError) {
        error(path, `条件式の書き方が正しくありません（${err.column + 1} 文字目）: ${err.message}`);
        return undefined;
      }
      throw err;
    }
    const refs = exprRefs(e);
    for (const v of refs.vars) {
      if (v === 'life') continue;
      if (!(v in flags)) error(path, `未定義のフラグです: ${v}（flags に初期値を書いてください）`);
      readFlags.add(v);
    }
    for (const ev of refs.evidence) checkEvidence(ev, path);
    for (const sc of refs.scenes)
      if (!sceneIds.includes(sc) && !placeIds.includes(sc))
        error(path, `未定義のシーン・場所です: ${sc}`);
    for (const id of refs.seen)
      if (!allSeen.has(id)) error(path, `未定義の「調べる」「話す」の ID です: ${id}`);
    return e;
  };

  // ---- ステップ列 → 命令列（compile-step.ts） ----
  // 今コンパイルしているシーンが裁判編か（場所・証拠品を詳しく調べる所は裁判編ではない）
  let inTrial = false;
  const { compileSteps, compileWrong } = makeStepCompiler({
    inTrial: () => inTrial,
    characters,
    flags,
    player,
    penaltyDefault,
    wrongPresent: src.defaults?.wrongPresent,
    error,
    zodIssues,
    checkCharacter,
    checkEvidence,
    checkScene,
    checkPlace,
    checkText,
    checkInlineRefs,
    cond,
    presentKind,
    locks,
    lockHeal,
  });

  // ---- 全体の検証 ----
  for (const id of Object.keys(characters)) {
    if (RESERVED_KEYS.has(id))
      error(['characters', id], `「${id}」は予約語なので人物 ID に使えません`);
  }
  if (player !== null) checkCharacter(player, ['player']);
  lockKeys.forEach((id, i) => {
    checkEvidence(id, ['psycheLock', 'keys', i]);
  });
  if (locks.size > 0 && lockKeys.length === 0)
    error(
      ['psycheLock'],
      'サイコ・ロックがあるので、psycheLock.keys（挑むのに使う証拠品）を書いてください',
    );
  checkScene(src.start.scene, ['start', 'scene']);
  (src.start.evidence ?? []).forEach((id, i) => {
    checkEvidence(id, ['start', 'evidence', i]);
  });
  for (const [id, v] of Object.entries(flags)) {
    if (id === 'life') error(['flags', id], '「life」は組み込みの値なのでフラグ名に使えません');
    void v;
  }
  let gameoverScene = BUILTIN_GAMEOVER;
  if (src.gameover !== undefined) {
    checkScene(src.gameover, ['gameover']);
    gameoverScene = src.gameover;
  }

  // ---- シーン ----
  const scenes: Record<string, Scene> = {};
  const placeCtx: PlaceContext = {
    player,
    compileSteps,
    cond,
    checkCharacter,
    checkEvidence,
    checkPlace,
    presentKind,
    error,
    locks,
    lockKeys,
  };
  sceneEntries.forEach(({ id, body, path, trial }, index) => {
    inTrial = trial;
    const b = new Builder();
    if (Array.isArray(body)) {
      compileSteps(body, path, b);
      const last = b.code.at(-1);
      if (!last || !['goto', 'end', 'gameover', 'investigate'].includes(last.op)) {
        // 明示的な移動がなければ、YAML 上で次に書かれたシーンへ進む
        const next = sceneIds[index + 1];
        if (next !== undefined) {
          b.emit({ op: 'goto', scene: next });
          referencedScenes.add(next);
        } else emitEnd(b, locks);
      }
      scenes[id] = { kind: 'dialogue', id, program: b.code };
      return;
    }
    scenes[id] = compileTestimony(placeCtx, id, body, path, warn, checkText, compileWrong);
  });
  inTrial = false;
  for (const { id, body, path } of placeEntries)
    scenes[id] = compilePlace(placeCtx, id, body, path);
  const characterDefs = compileCharacters(characters, cond);
  const evidenceDefs = compileInspect(placeCtx, evidence, scenes);
  if (gameoverScene === BUILTIN_GAMEOVER) {
    scenes[BUILTIN_GAMEOVER] = {
      kind: 'dialogue',
      id: BUILTIN_GAMEOVER,
      program: [{ op: 'gameover' }],
    };
  }
  Object.assign(scenes, lockEndScenes(locks));

  // ---- 到達性・未使用の警告 ----
  for (const id of [...sceneIds, ...placeIds]) {
    if (!referencedScenes.has(id))
      warn(
        scenePath(id),
        `${placeIds.includes(id) ? '場所' : 'シーン'}「${id}」にはどこからも移動しません`,
      );
  }
  for (const id of Object.keys(flags)) {
    if (!readFlags.has(id) && !id.startsWith('__lock'))
      warn(['flags', id], `フラグ「${id}」は一度も参照されていません`);
  }

  if (diagnostics.some((d) => d.severity === 'error')) return { scenario: null, diagnostics };
  return {
    scenario: {
      id: src.id,
      title: src.title,
      player,
      maxLife: src.life ?? DEFAULT_LIFE,
      characters: characterDefs,
      evidence: evidenceDefs,
      flags,
      startScene: src.start.scene,
      startEvidence: src.start.evidence ?? [],
      startProfiles: src.start.profiles ?? null,
      gameoverScene,
      ...(locks.size > 0 ? { lifeOutScenes: lockOutScenes(locks) } : {}),
      autoPause: src.defaults?.autoPause ?? false,
      autoShow: src.defaults?.autoShow ?? true,
      scenes,
      parts,
    },
    diagnostics,
    sources: collectSources(scenes, scenePath),
  };
}
