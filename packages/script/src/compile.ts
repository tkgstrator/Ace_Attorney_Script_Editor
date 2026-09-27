import {
  ExprSyntaxError, RichTextError, exprRefs, parseExpr, parseRich, plainText,
  type CompiledScenario, type Expr, type Instr, type PartDef, type Scene, type Statement, type TextColor, type Value,
} from '@gyakusai/core';
import type { z } from 'zod';
import { Builder, patch } from './builder.ts';
import { compileInspect } from './compile-inspect.ts';
import { compilePlace, presentKindOf, seenIds, type PlaceContext } from './compile-place.ts';
import { compileTestimony } from './compile-testimony.ts';
import { compileEffect } from './compile-effect.ts';
import { describeIssue } from './issues.ts';
import { RESERVED_KEYS, commandSchemas, scenarioSchema, type CommandName, type RawPlace, type RawScenario } from './schema.ts';

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
  const flags: Record<string, Value> = src.flags ?? {};
  // 編（parts）ごとのシーン・場所を、章全体の一覧にまとめる。編に分けていなければ全体を 1 つの裁判編とする
  type SceneBody = NonNullable<RawScenario['scenes']>[string];
  const sceneEntries: { id: string; body: SceneBody; path: Path }[] = [];
  const placeEntries: { id: string; body: RawPlace; path: Path }[] = [];
  const parts: PartDef[] = [];
  const allIds = new Map<string, Path>();
  const claim = (id: string, path: Path) => {
    const prev = allIds.get(id);
    if (prev) error(path, `ID「${id}」が重複しています（${prev.join('.')} と同じ）。シーン・場所の ID は章の中で重ならないようにしてください`);
    else allIds.set(id, path);
  };
  if (src.scenes) {
    for (const [id, body] of Object.entries(src.scenes)) { claim(id, ['scenes', id]); sceneEntries.push({ id, body, path: ['scenes', id] }); }
    parts.push({ id: 'main', kind: 'trial', title: src.title, scenes: Object.keys(src.scenes) });
  }
  (src.parts ?? []).forEach((part, pi) => {
    const partScenes = Object.entries(part.scenes ?? {});
    for (const [id, body] of partScenes) {
      const path: Path = ['parts', pi, 'scenes', id];
      claim(id, path);
      sceneEntries.push({ id, body, path });
    }
    const partPlaces = Object.entries(part.places ?? {});
    if (partPlaces.length > 0 && part.kind !== 'investigation') error(['parts', pi, 'places'], '場所（places）は探索編（kind: investigation）にだけ書けます');
    for (const [id, body] of partPlaces) {
      const path: Path = ['parts', pi, 'places', id];
      claim(id, path);
      placeEntries.push({ id, body, path });
    }
    parts.push({ id: part.id, kind: part.kind, title: part.title, scenes: [...partScenes, ...partPlaces].map(([id]) => id) });
  });
  if (sceneEntries.length === 0 && placeEntries.length === 0) error([], 'シーンがありません（scenes か parts を書いてください）');
  const sceneIds = sceneEntries.map(e => e.id);
  const placeIds = placeEntries.map(e => e.id);
  const allSeen = new Set(placeEntries.flatMap(e => seenIds(e.id, e.body)));
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
    if (placeIds.includes(id)) error(path, `「${id}」は場所です。場所へ行くには investigate を使ってください`);
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
      for (const m of parseRich(text).marks) if (m.command.cmd === 'show' && m.command.id) checkCharacter(m.command.id, path);
    } catch { /* 書き方の誤りは checkText が報告する */ }
  };
  const checkText = (text: string, path?: Path) => {
    for (const m of text.matchAll(INTERPOLATION)) readFlags.add(m[1]!);
    if (!path) return;
    try { parseRich(text); } catch (e) { if (e instanceof RichTextError) error(path, e.message); else throw e; }
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
    for (const sc of refs.scenes) if (!sceneIds.includes(sc) && !placeIds.includes(sc)) error(path, `未定義のシーン・場所です: ${sc}`);
    for (const id of refs.seen) if (!allSeen.has(id)) error(path, `未定義の「調べる」「話す」の ID です: ${id}`);
    return e;
  };

  // ---- ステップ列 → 命令列 ----
  const compileSteps = (steps: unknown, path: Path, b: Builder): void => {
    if (!Array.isArray(steps)) { error(path, 'ステップの配列を書いてください'); return; }
    steps.forEach((step, i) => compileStep(step, [...path, i], b));
  };

  const compileStep = (step: unknown, path: Path, b: Builder): void => {
    if (typeof step !== 'object' || step === null || Array.isArray(step)) {
      error(path, '各ステップは「キー: 値」の形で書いてください');
      return;
    }
    const keys = Object.keys(step);
    const cmds = keys.filter((k): k is CommandName => k in commandSchemas);
    if (cmds.length === 0) {
      const only = keys[0];
      if (keys.length === 1 && only !== undefined && only in characters) {
        const text = (step as Record<string, unknown>)[only];
        if (typeof text !== 'string') { error([...path, only], '台詞は文字列で書いてください'); return; }
        emitSay(only, text, undefined, b, [...path, only]);
        return;
      }
      error(path, keys.length === 1
        ? `「${keys[0]}」はコマンドでも人物 ID でもありません`
        : `どのコマンドか判別できません（キー: ${keys.join(', ')}）`);
      return;
    }
    if (cmds.length > 1) { error(path, `1つのステップに複数のコマンドがあります: ${cmds.join(', ')}`); return; }
    const cmd = cmds[0]!;
    const res = commandSchemas[cmd].safeParse(step);
    if (!res.success) { zodIssues(path, res.error); return; }
    const s = res.data as Record<string, unknown>;

    switch (cmd) {
      case 'say': {
        const who = s.say as string | null;
        if (who !== null) checkCharacter(who, [...path, 'say']);
        emitSay(who, s.text as string, s.color as TextColor | undefined, b, [...path, 'text'], s.auto === true);
        break;
      }
      case 'narrate': emitSay(null, s.narrate as string, undefined, b, [...path, 'narrate']); break;
      case 'set':
        for (const [flag, value] of Object.entries(s.set as Record<string, Value>)) {
          const p = [...path, 'set', flag];
          if (!(flag in flags)) error(p, `未定義のフラグです: ${flag}（flags に初期値を書いてください）`);
          else if (typeof flags[flag] !== typeof value) error(p, `フラグ ${flag} は ${typeof flags[flag]} 型です（${typeof value} は入れられません）`);
          b.emit({ op: 'set', flag, value });
        }
        break;
      case 'add':
        for (const [flag, amount] of Object.entries(s.add as Record<string, number>)) {
          const p = [...path, 'add', flag];
          if (!(flag in flags)) error(p, `未定義のフラグです: ${flag}`);
          else if (typeof flags[flag] !== 'number') error(p, `フラグ ${flag} は数値ではないので add できません`);
          b.emit({ op: 'add', flag, amount });
        }
        break;
      case 'giveProfile': case 'takeProfile':
        for (const id of ([] as string[]).concat(s[cmd] as string | string[])) {
          checkCharacter(id, [...path, cmd]);
          b.emit({ op: cmd, character: id });
        }
        break;
      case 'give': case 'take':
        for (const id of ([] as string[]).concat(s[cmd] as string | string[])) {
          checkEvidence(id, [...path, cmd]);
          b.emit({ op: cmd, evidence: id });
        }
        break;
      case 'if': {
        const e = cond(s.if as string, [...path, 'if']);
        const jumpUnless = b.emit({ op: 'jumpUnless', cond: e ?? { t: 'lit', v: false }, to: -1 });
        compileSteps(s.then, [...path, 'then'], b);
        if (s.else !== undefined) {
          const jumpEnd = b.emit({ op: 'jump', to: -1 });
          patch(b, jumpUnless, b.pc);
          compileSteps(s.else, [...path, 'else'], b);
          patch(b, jumpEnd, b.pc);
        } else {
          patch(b, jumpUnless, b.pc);
        }
        break;
      }
      case 'choice': {
        const opts = s.choice as { text: string; when?: string; then?: unknown[] }[];
        const ins: Extract<Instr, { op: 'choice' }> = { op: 'choice', options: [] };
        b.emit(ins);
        const exits: number[] = [];
        opts.forEach((o, i) => {
          const p = [...path, 'choice', i];
          checkText(o.text);
          const when = o.when !== undefined ? cond(o.when, [...p, 'when']) : undefined;
          ins.options.push({ text: o.text, ...(when ? { when } : {}), to: b.pc });
          if (o.then) compileSteps(o.then, [...p, 'then'], b);
          exits.push(b.emit({ op: 'jump', to: -1 }));
        });
        for (const j of exits) patch(b, j, b.pc);
        break;
      }
      case 'demand': {
        checkText(s.demand as string, [...path, 'demand']);
        if (s.by !== undefined) checkCharacter(s.by as string, [...path, 'by']);
        const ins: Extract<Instr, { op: 'demand' }> = {
          op: 'demand', prompt: s.demand as string, options: {}, wrong: -1, ...(s.by ? { speaker: s.by as string } : {}),
          ...(s.profiles === true ? { profiles: {} } : {}),
        };
        const at = b.emit(ins);
        const exits: number[] = [];
        for (const [ev, body] of Object.entries(s.present as Record<string, unknown[]>)) {
          const kind = presentKind(ev, [...path, 'present', ev]);
          if (kind === 'profile' && s.profiles === false) error([...path, 'profiles'], `人物ファイル（${ev}）が正解なので、profiles: false にはできません`);
          if (kind === 'profile') (ins.profiles ??= {})[ev] = b.pc; else ins.options[ev] = b.pc;
          b.emit({ op: 'shout', kind: 'takethat', by: player });
          compileSteps(body, [...path, 'present', ev], b);
          exits.push(b.emit({ op: 'jump', to: -1 }));
        }
        ins.wrong = b.pc;
        b.emit({ op: 'shout', kind: 'takethat', by: player });
        compileWrong(s.wrong, [...path, 'wrong'], b);
        b.emit({ op: 'jump', to: at });
        for (const j of exits) patch(b, j, b.pc);
        break;
      }
      case 'goto': checkScene(s.goto as string, [...path, 'goto']); b.emit({ op: 'goto', scene: s.goto as string }); break;
      case 'penalty': b.emit({ op: 'penalty', amount: s.penalty === true ? penaltyDefault : s.penalty as number }); break;
      case 'shout': {
        const by = (s.by as string | undefined) ?? player;
        if (s.by !== undefined) checkCharacter(s.by as string, [...path, 'by']);
        b.emit({ op: 'shout', kind: s.shout as Extract<Instr, { op: 'shout' }>['kind'], by });
        break;
      }
      case 'banner': checkText(s.banner as string); b.emit({ op: 'banner', text: s.banner as string }); break;
      case 'card': checkText(s.card as string); b.emit({ op: 'card', text: s.card as string }); break;
      case 'location': b.emit({ op: 'location', location: s.location as string | null }); break;
      case 'investigate': checkPlace(s.investigate as string, [...path, 'investigate']); b.emit({ op: 'investigate', place: s.investigate as string }); break;
      case 'end': b.emit({ op: 'end' }); break;
      case 'gameover': b.emit({ op: 'gameover' }); break;
      case 'random': {
        const at = b.emit({ op: 'random', to: [] });
        const exits: number[] = [];
        (s.random as unknown[]).forEach((branch, i) => {
          (b.code[at] as Extract<Instr, { op: 'random' }>).to.push(b.pc);
          compileSteps(branch, [...path, 'random', i], b);
          exits.push(b.emit({ op: 'jump', to: -1 }));
        });
        for (const j of exits) patch(b, j, b.pc);
        break;
      }
      default: compileEffect(cmd, s, b, { checkCharacter, checkEvidence, path });
    }
  };

  const emitSay = (speaker: string | null, text: string, color: TextColor | undefined, b: Builder, path: Path, auto = false) => {
    checkText(text, path);
    checkInlineRefs(text, path);
    // （ ）で囲んだ台詞は心の声として青字にする
    const thought = /^[（(]/.test(plainText(text));
    b.emit({ op: 'say', speaker, text, color: color ?? (thought ? 'blue' : 'white'), ...(auto ? { auto: true } : {}) });
  };

  const compileWrong = (steps: unknown, path: Path, b: Builder) => {
    if (steps !== undefined) compileSteps(steps, path, b);
    else if (src.defaults?.wrongPresent) compileSteps(src.defaults.wrongPresent, ['defaults', 'wrongPresent'], b);
    else b.emit({ op: 'penalty', amount: penaltyDefault });
  };

  // ---- 全体の検証 ----
  for (const id of Object.keys(characters)) {
    if (RESERVED_KEYS.has(id)) error(['characters', id], `「${id}」は予約語なので人物 ID に使えません`);
  }
  if (player !== null) checkCharacter(player, ['player']);
  checkScene(src.start.scene, ['start', 'scene']);
  (src.start.evidence ?? []).forEach((id, i) => checkEvidence(id, ['start', 'evidence', i]));
  for (const [id, v] of Object.entries(flags)) {
    if (id === 'life') error(['flags', id], '「life」は組み込みの値なのでフラグ名に使えません');
    void v;
  }
  let gameoverScene = BUILTIN_GAMEOVER;
  if (src.gameover !== undefined) { checkScene(src.gameover, ['gameover']); gameoverScene = src.gameover; }

  // ---- シーン ----
  const scenes: Record<string, Scene> = {};
  const placeCtx: PlaceContext = {
    player, compileSteps, cond, checkCharacter, checkEvidence, checkPlace, presentKind, error,
  };
  sceneEntries.forEach(({ id, body, path }, index) => {
    const b = new Builder();
    if (Array.isArray(body)) {
      compileSteps(body, path, b);
      const last = b.code.at(-1);
      if (!last || !['goto', 'end', 'gameover', 'investigate'].includes(last.op)) {
        // 明示的な移動がなければ、YAML 上で次に書かれたシーンへ進む
        const next = sceneIds[index + 1];
        if (next !== undefined) { b.emit({ op: 'goto', scene: next }); referencedScenes.add(next); }
        else b.emit({ op: 'end' });
      }
      scenes[id] = { kind: 'dialogue', id, program: b.code };
      return;
    }
    scenes[id] = compileTestimony(placeCtx, id, body, path, warn, checkText, compileWrong);
  });
  for (const { id, body, path } of placeEntries) scenes[id] = compilePlace(placeCtx, id, body, path);
  const evidenceDefs = compileInspect(placeCtx, evidence, scenes);
  if (gameoverScene === BUILTIN_GAMEOVER) {
    scenes[BUILTIN_GAMEOVER] = { kind: 'dialogue', id: BUILTIN_GAMEOVER, program: [{ op: 'gameover' }] };
  }

  // ---- 到達性・未使用の警告 ----
  for (const id of [...sceneIds, ...placeIds]) {
    if (!referencedScenes.has(id)) warn(scenePath(id), `${placeIds.includes(id) ? '場所' : 'シーン'}「${id}」にはどこからも移動しません`);
  }
  for (const id of Object.keys(flags)) {
    if (!readFlags.has(id)) warn(['flags', id], `フラグ「${id}」は一度も参照されていません`);
  }

  if (diagnostics.some(d => d.severity === 'error')) return { scenario: null, diagnostics };
  return {
    scenario: {
      id: src.id,
      title: src.title,
      player,
      maxLife: src.life ?? DEFAULT_LIFE,
      characters,
      evidence: evidenceDefs,
      flags,
      startScene: src.start.scene,
      startEvidence: src.start.evidence ?? [],
      startProfiles: src.start.profiles ?? null,
      gameoverScene,
      autoPause: src.defaults?.autoPause ?? false,
      autoShow: src.defaults?.autoShow ?? true,
      scenes,
      parts,
    },
    diagnostics,
  };
}

