// 音と画面の演出・画面の部品・人物ファイル・証言への戻りなど、状態を変えるだけの命令の変換。
import { DEFAULT_FLASH_FRAMES, DEFAULT_SHAKE_FRAMES, type ResumeTarget } from '@gyakusai/core';
import type { Builder } from './builder.ts';
import type { Path } from './compile.ts';

type Step = Record<string, unknown>;
const frames = (s: Step, fallback: number) => (s.frames as number | undefined) ?? fallback;

interface Ctx {
  checkCharacter(id: string, path: Path): void;
  checkEvidence(id: string, path: Path): void;
  path: Path;
}

export function compileEffect(cmd: string, s: Step, b: Builder, ctx: Ctx): void {
  switch (cmd) {
    case 'show':
      if (s.show !== null) ctx.checkCharacter(s.show as string, [...ctx.path, 'show']);
      b.emit({
        op: 'show',
        character: s.show as string | null,
        pose:
          s.talk === undefined
            ? null
            : { talk: s.talk as number | string, idle: (s.idle ?? s.talk) as number | string },
        ...(s.frames ? { frames: s.frames as number } : {}),
      });
      break;
    case 'showEvidence':
      if (s.showEvidence !== null)
        ctx.checkEvidence(s.showEvidence as string, [...ctx.path, 'showEvidence']);
      b.emit({
        op: 'showEvidence',
        evidence: s.showEvidence as string | null,
        ...(s.side ? { side: s.side as 'left' | 'right' } : {}),
      });
      break;
    case 'palette':
      b.emit({ op: 'palette', palette: s.palette as 'normal' | 'grayscale' });
      break;
    case 'bgm':
      b.emit({ op: 'bgm', id: s.bgm as string | null, frames: frames(s, 0) });
      break;
    case 'bgmPause':
      b.emit({ op: 'bgmPause', pause: s.bgmPause as boolean, frames: frames(s, 0) });
      break;
    case 'se':
      b.emit({ op: 'se', id: s.se as string });
      break;
    case 'shake':
      b.emit({
        op: 'shake',
        frames: s.shake === true ? DEFAULT_SHAKE_FRAMES : (s.shake as number),
        strength: (s.strength as number | undefined) ?? 0,
      });
      break;
    case 'flash':
      b.emit({
        op: 'flash',
        color: s.flash === true ? 'white' : (s.flash as 'white' | 'red'),
        frames: frames(s, DEFAULT_FLASH_FRAMES),
      });
      break;
    case 'fade':
      b.emit({
        op: 'fade',
        dir: s.fade as 'out' | 'in',
        color: (s.color as 'black' | 'white' | undefined) ?? 'black',
        frames: frames(s, 30),
        wait: s.nowait !== true,
      });
      break;
    case 'wait':
      b.emit({ op: 'wait', frames: s.wait as number });
      break;
    case 'textbox':
      b.emit({ op: 'textbox', show: s.textbox as boolean });
      break;
    case 'pan': {
      if (s.to) ctx.checkCharacter(s.to as string, [...ctx.path, 'to']);
      const talk = s.talk as number | string | undefined;
      b.emit({
        op: 'pan',
        type: s.pan as number,
        character: (s.to as string | null) ?? null,
        pose:
          talk === undefined
            ? null
            : { talk, idle: (s.idle as number | string | undefined) ?? talk },
      });
      break;
    }
    case 'overlay':
      b.emit({ op: 'overlay', id: String(s.overlay), on: s.off !== true });
      break;
    case 'scroll': {
      const v = s.scroll as { x?: number; y?: number } | null;
      b.emit({ op: 'scroll', scroll: v ? { x: v.x ?? 0, y: v.y ?? 0 } : null });
      break;
    }
    case 'ui': {
      const ui = s.ui as { record?: boolean; life?: boolean | null };
      b.emit({
        op: 'ui',
        ...(ui.record !== undefined ? { record: ui.record } : {}),
        ...(ui.life !== undefined ? { life: ui.life } : {}),
      });
      break;
    }
    case 'resume':
      b.emit({ op: 'resume', to: s.resume as ResumeTarget });
      break;
    case 'native':
      break; // 未対応の元の命令は何もしない（変換で失わないよう YAML には残す）
  }
}
