// 音の出力。Player は BGM・効果音の ID を渡すだけで、実際に何を鳴らすかはこのインターフェースの実装が決める。

export interface AudioOut {
  /** BGM を切り替える（null で止める）。fadeMs の間に前の曲を消し、次の曲を大きくする */
  bgm(id: string | null, fadeMs: number): void;
  se(id: string): void;
  /** BGM を一時停止する（resume で続きから） */
  pause?(fadeMs: number): void;
  resume?(fadeMs: number): void;
  /** 効果音を先に読み込んでおく（初めて鳴らすときに、読み込みの分だけ遅れないように） */
  preload?(seIds: string[]): Promise<void>;
  /** 全体の音量（0〜1。BGM・効果音・文字の音をまとめて変える） */
  setVolume?(volume: number): void;
  /** 消音する・戻す（音量はそのまま覚えておく） */
  setMuted?(muted: boolean): void;
}

/** 音声ファイル。BGM は loopStart〜loopEnd（秒）を繰り返す（省略すると全体を繰り返す） */
export type AudioSource = string | { url: string; loopStart?: number; loopEnd?: number };

export interface AudioSources {
  /** BGM の ID → 音声ファイル（なければ鳴らさない） */
  bgm?(id: string): AudioSource | undefined;
  /** 効果音の ID → 音声ファイル（なければ鳴らさない） */
  se?(id: string): AudioSource | undefined;
  volume?: { bgm?: number; se?: number };
}

/**
 * Web Audio で鳴らす既定の実装。BGM はループ位置でサンプル単位に繰り返す（前奏のある曲も途切れない）。
 * ブラウザは利用者の操作があるまで音を出さないため、最初のクリック・キー入力で鳴り始める
 */
export function createAudio(src: AudioSources): AudioOut {
  const ctx = new AudioContext();
  const resume = () => {
    if (ctx.state === 'suspended') void ctx.resume();
  };
  window.addEventListener('pointerdown', resume);
  window.addEventListener('keydown', resume);

  const buffers = new Map<string, Promise<AudioBuffer | null>>();
  const load = (url: string) => {
    let p = buffers.get(url);
    if (!p) {
      p = fetch(url)
        .then((r) => r.arrayBuffer())
        .then((b) => ctx.decodeAudioData(b))
        .catch(() => null);
      buffers.set(url, p);
    }
    return p;
  };
  const norm = (s: AudioSource) => (typeof s === 'string' ? { url: s } : s);

  // 全体の音量。BGM と効果音（文字の音も効果音として鳴らす）はここを通る
  const master = ctx.createGain();
  master.connect(ctx.destination);
  let volume = 1;
  let muted = false;
  const applyMaster = () => {
    // 急に変えるとプツッと鳴るので、ごく短く滑らかに変える
    master.gain.setTargetAtTime(muted ? 0 : volume, ctx.currentTime, 0.015);
  };
  const bgmGain = ctx.createGain();
  bgmGain.connect(master);
  const seGain = ctx.createGain();
  seGain.gain.value = src.volume?.se ?? 0.8;
  seGain.connect(master);
  const bgmVolume = src.volume?.bgm ?? 0.6;

  interface Playing {
    id: string;
    stop: (fadeMs: number) => void;
    pause: (fadeMs: number) => void;
    resume: (fadeMs: number) => void;
  }
  let current: Playing | null = null;
  /** 読み込み中に別の曲へ切り替わったら、読み込み終わった曲は鳴らさない */
  let generation = 0;

  return {
    bgm(id, fadeMs) {
      if (current?.id === id) return;
      current?.stop(fadeMs);
      current = null;
      const gen = ++generation;
      const source = id ? src.bgm?.(id) : undefined;
      if (!id || !source) return;
      const s = norm(source);
      const gain = ctx.createGain();
      gain.connect(bgmGain);
      let node: AudioBufferSourceNode | null = null;
      let buffer: AudioBuffer | null = null;
      /** 曲の頭からの位置（秒）を、再生を始めた時刻と一時停止した位置から求める */
      let startedAt = 0;
      let offset = 0;
      let paused = false;
      const ramp = (to: number, ms: number) => {
        const t = ctx.currentTime;
        gain.gain.cancelScheduledValues(t);
        gain.gain.setValueAtTime(gain.gain.value, t);
        gain.gain.linearRampToValueAtTime(to, t + ms / 1000);
      };
      const position = () => {
        const p = offset + (ctx.currentTime - startedAt);
        const ls = s.loopStart ?? 0,
          le = s.loopEnd ?? buffer?.duration ?? p;
        return p < le ? p : ls + ((p - ls) % Math.max(0.001, le - ls));
      };
      const play = (fade: number) => {
        if (!buffer) return;
        node = ctx.createBufferSource();
        node.buffer = buffer;
        node.loop = true;
        if (s.loopEnd !== undefined) {
          node.loopStart = s.loopStart ?? 0;
          node.loopEnd = s.loopEnd;
        }
        node.connect(gain);
        gain.gain.setValueAtTime(fade > 0 ? 0 : bgmVolume, ctx.currentTime);
        if (fade > 0) ramp(bgmVolume, fade);
        startedAt = ctx.currentTime;
        node.start(0, offset);
      };
      current = {
        id,
        stop: (ms) => {
          ramp(0, ms);
          node?.stop(ctx.currentTime + ms / 1000 + 0.05);
        },
        pause: (ms) => {
          if (paused) return;
          paused = true;
          if (!node) return;
          offset = position();
          ramp(0, ms);
          node.stop(ctx.currentTime + ms / 1000 + 0.05);
          node = null;
        },
        resume: (ms) => {
          if (!paused) return;
          paused = false;
          play(ms);
        },
      };
      void load(s.url).then((buf) => {
        if (!buf || gen !== generation) return;
        buffer = buf;
        if (!paused) play(fadeMs);
      });
    },
    async preload(ids) {
      await Promise.all(
        ids.map((id) => {
          const source = src.se?.(id);
          return source ? load(norm(source).url) : null;
        }),
      );
    },
    pause(fadeMs) {
      current?.pause(fadeMs);
    },
    setVolume(v) {
      volume = Math.min(1, Math.max(0, v));
      applyMaster();
    },
    setMuted(m) {
      muted = m;
      applyMaster();
    },
    resume(fadeMs) {
      current?.resume(fadeMs);
    },
    se(id) {
      const source = src.se?.(id);
      if (!source) return;
      void load(norm(source).url).then((buf) => {
        if (!buf) return;
        const node = ctx.createBufferSource();
        node.buffer = buf;
        node.connect(seGain);
        node.start();
      });
    },
  };
}
