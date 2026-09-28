// 画面の幅の確かめ（aspect-check.ts）の、決まった手順で章を進めて画面を撮る部分。
// 画面の更新（requestAnimationFrame）・時刻（performance.now）・乱数（Math.random）をこちらで決めるので、
// 同じ章・同じ手順なら、何度描いても同じ画素になる。
import { type CompiledScenario, Engine } from '@gyakusai/core';
import { type Assets, Player, type PlayerOptions } from '@gyakusai/runtime';

type Fonts = Partial<PlayerOptions>;
export type Aspect = '4:3' | '16:9';

export interface Shot {
  label: string;
  hash: string;
  url: string;
  width: number;
}

// ---- 時刻と乱数 ----------------------------------------------------------------------

const frames = new Map<number, FrameRequestCallback>();
let frameId = 0;
let clock = 0;
let seed = 1;
window.requestAnimationFrame = (cb) => {
  frames.set(++frameId, cb);
  return frameId;
};
window.cancelAnimationFrame = (id) => {
  frames.delete(id);
};
performance.now = () => clock;
Math.random = () => {
  // mulberry32
  seed = (seed + 0x6d2b79f5) | 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

function reset() {
  frames.clear();
  clock = 0;
  seed = 1;
}

function pump(n: number) {
  for (let i = 0; i < n; i++) {
    const cbs = [...frames.values()];
    frames.clear();
    clock += 1000 / 60;
    for (const cb of cbs) cb(clock);
  }
}

const key = (k: string) => {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));
  pump(20);
};

/** 画素の FNV-1a ハッシュ（16 進 8 桁） */
function hashOf(data: ImageData): string {
  const u = new Uint32Array(data.data.buffer);
  let h = 0x811c9dc5;
  for (let i = 0; i < u.length; i++) h = Math.imul(h ^ u[i]!, 0x01000193);
  return (h >>> 0).toString(16).padStart(8, '0');
}

// ---- 章を進めて撮る ----------------------------------------------------------------

/**
 * 章の各シーンの始めから、最大 perScene 場面ずつ撮る（全部で max 枚まで）。
 * 探偵パートは、メニュー・調べる画面・話題の一覧も撮る。最初の台詞では法廷記録も開いて撮る
 */
export function playShots(
  scenario: CompiledScenario,
  assets: Assets,
  fonts: Fonts,
  aspect: Aspect,
  max: number,
  perScene = 4,
): Shot[] {
  reset();
  const canvas = document.createElement('canvas');
  const engine = new Engine(scenario);
  // 画面の幅の設定を知らない Player（変更の前）でも同じ手順で撮れるように、設定は型を広げて渡す
  const opts = { canvas, engine, assets, ...fonts, aspect } as PlayerOptions;
  const player = new Player(opts);
  const ctx = canvas.getContext('2d')!;
  const shots: Shot[] = [];
  const snap = (label: string, n = 40) => {
    pump(n);
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    shots.push({ label, hash: hashOf(data), url: canvas.toDataURL(), width: canvas.width });
  };
  let recordShot = false;
  pump(2);
  for (const scene of Object.keys(scenario.scenes)) {
    if (shots.length >= max) break;
    try {
      engine.jumpTo(scene);
    } catch {
      continue;
    }
    for (let k = 0; k < perScene && shots.length < max; k++) {
      const b = engine.beat;
      const tag = `${scene} ${k} ${b.kind}`;
      snap(tag);
      try {
        if (!recordShot && b.kind === 'line') {
          recordShot = true;
          key('x');
          snap(`${tag} 法廷記録`, 4);
          key('Enter');
          snap(`${tag} 法廷記録の詳細`, 4);
          key('Escape');
          key('Escape');
        }
        if (b.kind === 'investigate') {
          if (b.examine) {
            key('Enter');
            snap(`${tag} 調べる`, 4);
            key('Escape');
          }
          if (b.talk.length > 0 || b.move.length > 0) {
            key('ArrowRight');
            if (b.move.length === 0) key('ArrowRight');
            key('Enter');
            snap(`${tag} 一覧`, 4);
            key('Escape');
          }
          engine.examine(128, 96);
        } else if (b.kind === 'choice') engine.choose(0);
        else if (b.kind === 'pick') {
          if (!engine.pickAt(128, 96)) engine.pick(0);
        } else if (b.kind === 'demand') {
          if (b.giveUp) engine.giveUp();
          else {
            const ev = engine.state.evidence[0];
            if (!ev) break;
            engine.present(ev);
          }
        } else if (b.kind === 'end' || b.kind === 'gameover') break;
        else engine.advance();
      } catch {
        break;
      }
    }
  }
  player.destroy();
  return shots;
}
