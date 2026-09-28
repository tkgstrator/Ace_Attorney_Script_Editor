// 止まらずに状態を変えるだけの命令（フラグ・証拠品・表示・音と画面の演出）の実行。
import type { InlineCommand } from './rich.ts';
import type { EngineEvent, GameState, Instr, TestimonyScene } from './types.ts';

/** 実行できた（その命令は状態を変えるだけで、次の命令へ進む）なら true。pc は呼び出し側で進める */
export function execSimple(ins: Instr, s: GameState, events: EngineEvent[]): boolean {
  switch (ins.op) {
    case 'bgm':
      s.stage.bgm = ins.id;
      events.push({ type: 'bgm', id: ins.id, frames: ins.frames });
      return true;
    case 'se':
      events.push({ type: 'se', id: ins.id });
      return true;
    case 'shake':
      events.push({ type: 'shake', frames: ins.frames, strength: ins.strength });
      return true;
    case 'flash':
      events.push({ type: 'flash', color: ins.color, frames: ins.frames });
      return true;
    case 'set':
      s.flags[ins.flag] = ins.value;
      return true;
    case 'add':
      s.flags[ins.flag] = Number(s.flags[ins.flag] ?? 0) + ins.amount;
      return true;
    case 'give':
      if (!s.evidence.includes(ins.evidence)) {
        s.evidence.push(ins.evidence);
        events.push({ type: 'evidence', id: ins.evidence, added: true });
      }
      return true;
    case 'take':
      if (s.evidence.includes(ins.evidence)) {
        s.evidence = s.evidence.filter((e) => e !== ins.evidence);
        events.push({ type: 'evidence', id: ins.evidence, added: false });
      }
      return true;
    case 'show':
      if (ins.frames) {
        const out = ins.character === null;
        events.push({
          type: 'charFade',
          dir: out ? 'out' : 'in',
          frames: ins.frames,
          character: out ? s.stage.character : ins.character,
          pose: out ? s.stage.pose : ins.pose,
        });
      }
      s.stage.character = ins.character;
      s.stage.pose = ins.character ? ins.pose : null;
      return true;
    case 'palette':
      s.stage.palette = ins.palette;
      return true;
    case 'location':
      s.stage.location = ins.location;
      s.stage.scroll = null;
      s.stage.pan = null;
      return true;
    case 'pan':
      s.stage.pan = { type: ins.type, from: { character: s.stage.character, pose: s.stage.pose } };
      s.stage.character = ins.character;
      s.stage.pose = ins.pose;
      return true;
    case 'overlay':
      s.stage.overlays = s.stage.overlays.filter((o) => o !== ins.id);
      if (ins.on) s.stage.overlays.push(ins.id);
      return true;
    case 'scroll':
      s.stage.scroll = ins.scroll;
      return true;
    case 'showEvidence':
      s.stage.evidence = ins.evidence;
      s.stage.evidenceRight = ins.side === 'right';
      return true;
    case 'giveProfile':
    case 'takeProfile': {
      const list = s.profiles ?? [];
      const has = list.includes(ins.character);
      if (ins.op === 'giveProfile' && !has) s.profiles = [...list, ins.character];
      if (ins.op === 'takeProfile' && has) s.profiles = list.filter((c) => c !== ins.character);
      return true;
    }
    case 'textbox':
      s.stage.textbox = ins.show;
      return true;
    case 'ui':
      if (ins.record !== undefined) s.stage.recordLocked = !ins.record;
      if (ins.life !== undefined) s.stage.lifeGauge = ins.life;
      return true;
    case 'bgmPause':
      s.stage.bgmPaused = ins.pause;
      events.push({ type: 'bgmPause', pause: ins.pause, frames: ins.frames });
      return true;
    case 'fade':
      // 止まらないフェード（止まるものは Engine が Beat として止まる）
      s.stage.fade = ins.dir === 'out' ? ins.color : null;
      events.push({ type: 'fade', dir: ins.dir, color: ins.color, frames: ins.frames });
      return !ins.wait;
    default:
      return false;
  }
}

/** pc から resume までの命令を、止まらずにまとめて実行する。止まる命令があればその名前を返す */
export function execBlock(
  program: Instr[],
  pc: number,
  s: GameState,
  events: EngineEvent[],
): string | null {
  for (let i = pc; i < program.length; i++) {
    const ins = program[i]!;
    if (ins.op === 'resume') return null;
    if (!execSimple(ins, s, events)) return ins.op;
  }
  return null;
}

/**
 * 証言の画面にする（証人を出す）。尋問なら、証言の前のブロック（止まらない命令だけ）を resume までまとめて実行する。
 * ブロックに止まる命令があれば、その名前を返す
 */
export function enterStatement(
  t: TestimonyScene,
  s: GameState,
  phase: 'reading' | 'cross',
  index: number,
  events: EngineEvent[],
): string | null {
  s.mode = 'testimony';
  s.phase = phase;
  s.statement = index;
  s.stage.character = t.witness;
  s.stage.location = null;
  s.stage.pose = null;
  const before = t.statements[index]?.before;
  return phase === 'cross' && before !== undefined ? execBlock(t.program, before, s, events) : null;
}

/** 文の途中の [show] / [location] を状態に反映する */
export function applyInlineCommand(cmd: InlineCommand, s: GameState): void {
  if (cmd.cmd === 'show') {
    s.stage.character = cmd.id;
    s.stage.pose =
      cmd.id && cmd.talk !== undefined ? { talk: cmd.talk, idle: cmd.idle ?? cmd.talk } : null;
  } else if (cmd.cmd === 'location') {
    s.stage.location = cmd.key;
    s.stage.scroll = null;
    s.stage.pan = null;
  }
}
