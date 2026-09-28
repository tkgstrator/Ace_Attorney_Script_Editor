// ステップ列（YAML のコマンドの並び）を命令列に変換する。compile() の本体から切り出したもの。
// 参照の検証（人物・証拠品・シーン・条件式など）は、compile() が作った関数を受け取って使う。
import { type Instr, plainText, type TextColor, type Value } from '@gyakusai/core';
import type { z } from 'zod';
import { type Builder, patch } from './builder.ts';
import type { Path } from './compile.ts';
import { compileEffect } from './compile-effect.ts';
import {
  emitBreak,
  emitDefine,
  emitEnd,
  emitGiveUp,
  emitUnlock,
  type LockRegistry,
} from './compile-lock.ts';
import type { PlaceContext } from './compile-place.ts';
import { type CommandName, commandSchemas, type RawScenario } from './schema.ts';

/** ステップの変換に使う、コンパイラ本体の検証の関数と、章全体の値 */
export interface StepContext
  extends Pick<
    PlaceContext,
    'player' | 'cond' | 'checkCharacter' | 'checkEvidence' | 'checkPlace' | 'presentKind' | 'error'
  > {
  characters: RawScenario['characters'];
  flags: Record<string, Value>;
  penaltyDefault: number;
  /** 見当違いのつきつけの既定の反応（defaults.wrongPresent） */
  wrongPresent: unknown[] | undefined;
  zodIssues(base: Path, err: z.ZodError): void;
  checkScene(id: string, path: Path): void;
  checkText(text: string, path?: Path): void;
  checkInlineRefs(text: string, path: Path): void;
  /** 今コンパイルしているシーンが裁判編のものか（つきつけの「くらえ！」は裁判編だけで出す） */
  inTrial(): boolean;
  /** 章の中のサイコ・ロック（compile-lock.ts）と、解除したときの回復量 */
  locks: LockRegistry;
  lockHeal: number;
}

/** ステップ列の変換（compileSteps）と、見当違いのつきつけの反応の変換（compileWrong）を作る */
export function makeStepCompiler(ctx: StepContext) {
  const {
    characters,
    flags,
    player,
    penaltyDefault,
    wrongPresent,
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
    inTrial,
    locks,
    lockHeal,
  } = ctx;

  // ---- ステップ列 → 命令列 ----
  const compileSteps = (steps: unknown, path: Path, b: Builder): void => {
    if (!Array.isArray(steps)) {
      error(path, 'ステップの配列を書いてください');
      return;
    }
    const outer = b.at;
    steps.forEach((step, i) => {
      b.at = [...path, i];
      compileStep(step, [...path, i], b);
    });
    b.at = outer;
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
        if (typeof text !== 'string') {
          error([...path, only], '台詞は文字列で書いてください');
          return;
        }
        emitSay(only, text, undefined, b, [...path, only]);
        return;
      }
      error(
        path,
        keys.length === 1
          ? `「${keys[0]}」はコマンドでも人物 ID でもありません`
          : `どのコマンドか判別できません（キー: ${keys.join(', ')}）`,
      );
      return;
    }
    if (cmds.length > 1) {
      error(path, `1つのステップに複数のコマンドがあります: ${cmds.join(', ')}`);
      return;
    }
    const cmd = cmds[0]!;
    const res = commandSchemas[cmd].safeParse(step);
    if (!res.success) {
      zodIssues(path, res.error);
      return;
    }
    const s = res.data as Record<string, unknown>;

    switch (cmd) {
      case 'say': {
        const who = s.say as string | null;
        if (who !== null) checkCharacter(who, [...path, 'say']);
        emitSay(
          who,
          s.text as string,
          s.color as TextColor | undefined,
          b,
          [...path, 'text'],
          s.auto === true,
        );
        break;
      }
      case 'narrate':
        emitSay(null, s.narrate as string, undefined, b, [...path, 'narrate']);
        break;
      case 'set':
        for (const [flag, value] of Object.entries(s.set as Record<string, Value>)) {
          const p = [...path, 'set', flag];
          if (!(flag in flags))
            error(p, `未定義のフラグです: ${flag}（flags に初期値を書いてください）`);
          else if (typeof flags[flag] !== typeof value)
            error(
              p,
              `フラグ ${flag} は ${typeof flags[flag]} 型です（${typeof value} は入れられません）`,
            );
          b.emit({ op: 'set', flag, value });
        }
        break;
      case 'add':
        for (const [flag, amount] of Object.entries(s.add as Record<string, number>)) {
          const p = [...path, 'add', flag];
          if (!(flag in flags)) error(p, `未定義のフラグです: ${flag}`);
          else if (typeof flags[flag] !== 'number')
            error(p, `フラグ ${flag} は数値ではないので add できません`);
          b.emit({ op: 'add', flag, amount });
        }
        break;
      case 'giveProfile':
      case 'takeProfile':
        for (const id of ([] as string[]).concat(s[cmd] as string | string[])) {
          checkCharacter(id, [...path, cmd]);
          b.emit({ op: cmd, character: id });
        }
        break;
      case 'give':
      case 'take':
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
          op: 'demand',
          prompt: s.demand as string,
          options: {},
          wrong: -1,
          ...(s.by ? { speaker: s.by as string } : {}),
          ...(s.profiles === true ? { profiles: {} } : {}),
        };
        const at = b.emit(ins);
        const exits: number[] = [];
        for (const [ev, body] of Object.entries(s.present as Record<string, unknown[]>)) {
          const kind = presentKind(ev, [...path, 'present', ev]);
          if (kind === 'profile' && s.profiles === false)
            error(
              [...path, 'profiles'],
              `人物ファイル（${ev}）が正解なので、profiles: false にはできません`,
            );
          if (kind === 'profile') {
            ins.profiles ??= {};
            ins.profiles[ev] = b.pc;
          } else ins.options[ev] = b.pc;
          if (inTrial()) b.emit({ op: 'shout', kind: 'takethat', by: player });
          compileSteps(body, [...path, 'present', ev], b);
          exits.push(b.emit({ op: 'jump', to: -1 }));
        }
        ins.wrong = b.pc;
        if (inTrial()) b.emit({ op: 'shout', kind: 'takethat', by: player });
        compileWrong(s.wrong, [...path, 'wrong'], b);
        b.emit({ op: 'jump', to: at });
        if (s.giveUp === true) {
          if (locks.size === 0)
            error([...path, 'giveUp'], 'サイコ・ロック（psycheLock のステップ）が章にありません');
          ins.giveUp = b.pc;
          // どのロックにも当たらなければ（挑戦していないのに来たら）もう一度求める
          for (const j of emitGiveUp(b, locks)) patch(b, j, at);
        }
        for (const j of exits) patch(b, j, b.pc);
        break;
      }
      case 'psycheLock': {
        for (const k of ['start', 'quit', 'gaugeOut'] as const)
          if (typeof s[k] === 'string') checkScene(s[k] as string, [...path, k]);
        if (typeof s.person === 'string') checkCharacter(s.person, [...path, 'person']);
        if (typeof s.place === 'string') checkPlace(s.place, [...path, 'place']);
        emitDefine(b, s);
        break;
      }
      case 'breakLock':
        emitBreak(b, locks, lockHeal, s.breakLock === 'hold');
        break;
      case 'unlock':
        emitUnlock(b, locks, lockHeal);
        break;
      case 'quitLock':
        // demand の giveUp と同じ。挑んでいなければ次のステップへ
        if (locks.size === 0)
          error([...path, 'quitLock'], 'サイコ・ロック（psycheLock のステップ）が章にありません');
        for (const j of emitGiveUp(b, locks)) patch(b, j, b.pc);
        break;
      case 'heal':
        b.emit({ op: 'heal', amount: s.heal === true ? 'full' : (s.heal as number) });
        break;
      case 'lifeRisk':
        b.emit({ op: 'lifeRisk', amount: s.lifeRisk as number });
        break;
      case 'goto':
        checkScene(s.goto as string, [...path, 'goto']);
        b.emit({ op: 'goto', scene: s.goto as string });
        break;
      case 'penalty':
        b.emit(
          s.penalty === 'risk'
            ? { op: 'penalty', amount: 0, risk: true }
            : {
                op: 'penalty',
                amount: s.penalty === true ? penaltyDefault : (s.penalty as number),
              },
        );
        break;
      case 'shout': {
        const by = (s.by as string | undefined) ?? player;
        if (s.by !== undefined) checkCharacter(s.by as string, [...path, 'by']);
        b.emit({ op: 'shout', kind: s.shout as Extract<Instr, { op: 'shout' }>['kind'], by });
        break;
      }
      case 'banner':
        checkText(s.banner as string);
        b.emit({ op: 'banner', text: s.banner as string });
        break;
      case 'card':
        checkText(s.card as string);
        b.emit({ op: 'card', text: s.card as string });
        break;
      case 'location':
        b.emit({ op: 'location', location: s.location as string | null });
        break;
      case 'investigate':
        checkPlace(s.investigate as string, [...path, 'investigate']);
        b.emit({ op: 'investigate', place: s.investigate as string });
        break;
      case 'end':
        // 有効なまま残ったサイコ・ロックがあれば、印のシーンを通ってから終わる（compile-lock.ts）
        emitEnd(b, locks);
        break;
      case 'gameover':
        b.emit({ op: 'gameover' });
        break;
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
      default:
        compileEffect(cmd, s, b, { checkCharacter, checkEvidence, path });
    }
  };

  const emitSay = (
    speaker: string | null,
    text: string,
    color: TextColor | undefined,
    b: Builder,
    path: Path,
    auto = false,
  ) => {
    checkText(text, path);
    checkInlineRefs(text, path);
    // （ ）で囲んだ台詞は心の声として青字にする
    const thought = /^[（(]/.test(plainText(text));
    b.emit({
      op: 'say',
      speaker,
      text,
      color: color ?? (thought ? 'blue' : 'white'),
      ...(auto ? { auto: true } : {}),
    });
  };

  const compileWrong = (steps: unknown, path: Path, b: Builder) => {
    if (steps !== undefined) compileSteps(steps, path, b);
    else if (wrongPresent) compileSteps(wrongPresent, ['defaults', 'wrongPresent'], b);
    else b.emit({ op: 'penalty', amount: penaltyDefault });
  };

  return { compileSteps, compileWrong };
}
