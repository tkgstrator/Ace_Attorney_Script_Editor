// 台詞の中に書く演出（文中コマンド）。元のゲームの台本と同じく、文字送りの途中で待つ・速さや色を変える・
// 画面を揺らす・光らせる・音を鳴らすことができる。
//
//   "な、[wait 8]なんですとォ[shake 30 1][se 17]……！"
//   "[color red]御剣検事[color white]が担当だ。"
//
// 時間の単位はフレーム（1/60 秒）。`[` を文字として書くときは `[[`。

import type { FlashColor, TextColor } from './types.ts';

export type InlineCommand =
  /** 待つ（フレーム） */
  | { cmd: 'wait'; frames: number }
  /** 1 文字を出す間隔（フレーム） */
  | { cmd: 'speed'; frames: number }
  | { cmd: 'color'; color: TextColor }
  /** 画面を揺らす（フレーム、強さ 0〜2） */
  | { cmd: 'shake'; frames: number; strength: number }
  | { cmd: 'flash'; color: FlashColor; frames: number }
  | { cmd: 'se'; id: string }
  /** BGM を切り替える（null で止める）。frames はフェードの長さ */
  | { cmd: 'bgm'; id: string | null; frames: number }
  /** 文の途中で人物・背景を切り替える（id が null なら消す） */
  | { cmd: 'show'; id: string | null; talk?: number | string; idle?: number | string }
  | { cmd: 'location'; key: string | null }
  /** 元のゲームの命令で、まだ対応していないもの（何もしない） */
  | { cmd: 'native'; name: string; args: number[] }
  /** 文字送りの音の種類を変える・止める（off）・戻す（on） */
  | { cmd: 'blip'; kind: 'male' | 'female' | 'typewriter' | 'off' | 'on' };

/** 文中コマンドを取り除いた文字列と、コマンドの位置（何文字目の前か） */
export interface RichText {
  plain: string;
  marks: { at: number; command: InlineCommand }[];
}

export class RichTextError extends Error {}

const COLORS: TextColor[] = ['white', 'blue', 'green', 'orange', 'red'];
export const DEFAULT_SHAKE_FRAMES = 30;
export const DEFAULT_FLASH_FRAMES = 3;

function parseCommand(src: string): InlineCommand {
  const [name, ...args] = src.trim().split(/\s+/);
  const num = (i: number, fallback?: number): number => {
    const a = args[i];
    if (a === undefined) {
      if (fallback === undefined) throw new RichTextError(`[${src}] には数値が必要です`);
      return fallback;
    }
    const n = Number(a);
    if (!Number.isFinite(n) || n < 0) throw new RichTextError(`[${src}] の「${a}」は 0 以上の数値にしてください`);
    return n;
  };
  const id = (i: number) => {
    const a = args[i];
    if (!a || !/^[A-Za-z0-9_]+$/.test(a)) throw new RichTextError(`[${src}] には ID が必要です`);
    return a;
  };
  switch (name) {
    case 'wait': return { cmd: 'wait', frames: num(0) };
    case 'speed': return { cmd: 'speed', frames: num(0) };
    case 'color': {
      const c = args[0] as TextColor;
      if (!COLORS.includes(c)) throw new RichTextError(`[${src}] の色は ${COLORS.join(' / ')} のどれかにしてください`);
      return { cmd: 'color', color: c };
    }
    case 'shake': return { cmd: 'shake', frames: num(0, DEFAULT_SHAKE_FRAMES), strength: Math.min(2, num(1, 0)) };
    case 'flash': {
      const c = args[0] ?? 'white';
      if (c !== 'white' && c !== 'red') throw new RichTextError(`[${src}] の色は white / red にしてください`);
      return { cmd: 'flash', color: c, frames: num(1, DEFAULT_FLASH_FRAMES) };
    }
    case 'se': return { cmd: 'se', id: id(0) };
    case 'bgm': return { cmd: 'bgm', id: args[0] === 'null' || args[0] === undefined ? null : id(0), frames: num(1, 0) };
    case 'show': {
      if (args[0] === 'null' || args[0] === undefined) return { cmd: 'show', id: null };
      const anim = (i: number) => (args[i] === undefined ? undefined : /^\d+$/.test(args[i]!) ? Number(args[i]) : id(i));
      const talk = anim(1), idle = anim(2);
      return { cmd: 'show', id: id(0), ...(talk !== undefined ? { talk } : {}), ...(idle !== undefined ? { idle } : {}) };
    }
    case 'location': return { cmd: 'location', key: args[0] === 'null' || args[0] === undefined ? null : id(0) };
    case 'blip': {
      const k = args[0] as 'male' | 'female' | 'typewriter' | 'off' | 'on';
      if (!['male', 'female', 'typewriter', 'off', 'on'].includes(k)) throw new RichTextError(`[${src}] は male / female / typewriter / off / on のどれかにしてください`);
      return { cmd: 'blip', kind: k };
    }
    case 'native': return { cmd: 'native', name: id(0), args: args.slice(1).map((_, i) => num(i + 1)) };
    default: throw new RichTextError(`文中のコマンド [${src}] は使えません（wait / speed / color / shake / flash / se / bgm / show / location / blip / native）`);
  }
}

/** 文中コマンドを読み取る。書き方が正しくなければ RichTextError */
export function parseRich(text: string): RichText {
  let plain = '';
  const marks: RichText['marks'] = [];
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === '[') {
      if (text[i + 1] === '[') { plain += '['; i += 2; continue; }
      const end = text.indexOf(']', i);
      if (end < 0) throw new RichTextError('[ が ] で閉じられていません（[ を文字として書くときは [[）');
      marks.push({ at: [...plain].length, command: parseCommand(text.slice(i + 1, end)) });
      i = end + 1;
      continue;
    }
    plain += c;
    i++;
  }
  return { plain, marks };
}

/** 文中で切り替える BGM を順に（書き方が正しくなければ無し） */
export function plainBgm(text: string): (string | null)[] {
  if (!text.includes('[bgm')) return [];
  try {
    return parseRich(text).marks.flatMap(m => (m.command.cmd === 'bgm' ? [m.command.id] : []));
  } catch { return []; }
}

/** 文中コマンドを取り除いた文字列（書き方が正しくなければ元のまま） */
export function plainText(text: string): string {
  try { return parseRich(text).plain; } catch { return text; }
}
