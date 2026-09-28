// Player（player.ts）の状態を、入力（player-input.ts）・描画（player-render.ts）のモジュールに見せる窓口。
// 値はその都度 Player から読む（getter）ので、処理の途中で状態が変わっても最新の値が見える。
import type { Beat, Engine } from '@gyakusai/core';
import type { AudioOut } from './audio.ts';
import type { ScreenEffects } from './effects.ts';
import type { InvestigationUI } from './investigation.ts';
import type { Labels } from './options.ts';
import type { Painter } from './painter.ts';
import type { CourtRecord } from './record.ts';
import type { LineResume } from './resume.ts';
import type { SceneViews } from './scene.ts';
import type { Glyph, Typewriter } from './typewriter.ts';

/** 選択肢を出すときに残して見せる、直前の台詞の最後のページ */
export interface LastLine {
  name: string | null;
  lines: Glyph[][];
  color: string;
}

export interface PlayerHost {
  readonly engine: Engine;
  readonly beat: Beat;
  readonly p: Painter;
  readonly labels: Labels;
  readonly audio: AudioOut | undefined;
  readonly onRestart: (() => void) | undefined;
  readonly reduceMotion: boolean;
  readonly record: CourtRecord;
  readonly resume: LineResume;
  readonly inv: InvestigationUI;
  readonly fx: ScreenEffects;
  readonly views: SceneViews;
  /** 今の文の文字送り（文のない Beat では null） */
  readonly tw: Typewriter | null;
  readonly typing: boolean;
  readonly lastPage: boolean;
  readonly timer: number;
  readonly age: number;
  choiceSel: number;
  readonly lastLine: LastLine | null;
  readonly added: string | null;
  readonly lifeShow: number;
  readonly frame: number;
  readonly blink: number;
  /** 「調べる」の目印を出すときの情報（出さなければ null） */
  readonly markers: { engine: Engine; reduceMotion: boolean } | null;
}

/** 尋問中の証言か */
export function onCross(h: PlayerHost): boolean {
  const b = h.beat;
  return b.kind === 'statement' && b.cross;
}

/** 法廷記録を開けるか */
export function canOpenRecord(h: PlayerHost): boolean {
  const k = h.beat.kind;
  if (h.engine.state.stage.recordLocked) return false;
  if (k === 'investigate') return h.inv.view === 'menu';
  return k === 'line' || k === 'statement' || k === 'choice' || k === 'demand' || k === 'card';
}
