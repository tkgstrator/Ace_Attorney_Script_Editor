// サンプル用の仮の音。音声ファイルを使わず、その場で波形を合成して WAV にする。
// 本物の音に差し替えるときは、SE / BGM の ID → URL を返す関数を createAudio に渡せばよい。
import type { AudioSources } from '@gyakusai/runtime';

const RATE = 22050;

/** 波形（-1〜1）を 16 ビット・モノラルの WAV にして、その URL を返す */
function wav(samples: Float32Array): string {
  const buf = new ArrayBuffer(44 + samples.length * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) =>
    [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)));
  str(0, 'RIFF');
  v.setUint32(4, 36 + samples.length * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true);
  v.setUint32(28, RATE * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, samples.length * 2, true);
  samples.forEach((x, i) => v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, x)) * 32767, true));
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/** 長さ sec の波形を、時刻 t（秒）→ 値 の関数で作る */
function synth(sec: number, f: (t: number) => number): Float32Array {
  const out = new Float32Array(Math.round(sec * RATE));
  for (let i = 0; i < out.length; i++) out[i] = f(i / RATE);
  return out;
}

const square = (t: number, hz: number) => (Math.sin(2 * Math.PI * hz * t) >= 0 ? 1 : -1);
const noise = () => Math.random() * 2 - 1;
const env = (t: number, len: number) => Math.max(0, 1 - t / len);

/** 音の高さ（C4 を 0 とした半音の数）→ 周波数 */
const hz = (n: number) => 261.63 * 2 ** (n / 12);

/** 音符の列（[半音, 拍]）を、四角波の短い繰り返し曲にする */
function tune(bpm: number, notes: [number | null, number][], bass: number[]): Float32Array {
  const beat = 60 / bpm;
  const total = notes.reduce((a, [, b]) => a + b, 0) * beat;
  const starts: [number | null, number, number][] = [];
  let at = 0;
  for (const [n, b] of notes) {
    starts.push([n, at, b * beat]);
    at += b * beat;
  }
  return synth(total, (t) => {
    const cur = starts.find(([, s, l]) => t >= s && t < s + l);
    const lead =
      cur && cur[0] !== null ? square(t, hz(cur[0])) * 0.12 * env(t - cur[1], cur[2] * 1.2) : 0;
    const b = bass[Math.floor(t / (beat * 2)) % bass.length]!;
    return lead + square(t, hz(b - 24)) * 0.08;
  });
}

let cache: Record<string, string> | null = null;

function build(): Record<string, string> {
  return {
    'se:gavel': wav(
      synth(0.35, (t) => (noise() * 0.6 + Math.sin(2 * Math.PI * 90 * t)) * env(t, 0.3) ** 3),
    ),
    'se:damage': wav(synth(0.4, (t) => square(t, 400 - t * 700) * 0.4 * env(t, 0.4))),
    'se:shout_objection': wav(
      synth(0.5, (t) => (square(t, 220) + square(t, 277) + square(t, 330)) * 0.18 * env(t, 0.5)),
    ),
    'se:shout_hold': wav(
      synth(0.45, (t) => (square(t, 247) + square(t, 311)) * 0.2 * env(t, 0.45)),
    ),
    'se:shout_takethat': wav(
      synth(0.45, (t) => (square(t, 196) + square(t, 294)) * 0.2 * env(t, 0.45)),
    ),
    // 文字送りの音と、ページ送り・選択肢の音（短い矩形波）
    'se:blip_male': wav(synth(0.03, (t) => square(t, 740) * 0.12 * env(t, 0.03))),
    'se:blip_female': wav(synth(0.03, (t) => square(t, 1040) * 0.12 * env(t, 0.03))),
    'se:blip_typewriter': wav(synth(0.025, (t) => noise() * 0.2 * env(t, 0.025))),
    'se:ui_page': wav(synth(0.05, (t) => square(t, 1320) * 0.12 * env(t, 0.05))),
    'se:ui_select': wav(synth(0.04, (t) => square(t, 880) * 0.12 * env(t, 0.04))),
    'se:ui_decide': wav(synth(0.08, (t) => square(t, t < 0.04 ? 988 : 1319) * 0.14 * env(t, 0.08))),
    'se:discover': wav(
      synth(0.5, (t) => square(t, t < 0.12 ? 784 : t < 0.24 ? 988 : 1319) * 0.25 * env(t, 0.5)),
    ),
    // 証拠品を加えたとき（上がっていく短い音）
    'se:evidence_add': wav(
      synth(0.3, (t) => square(t, t < 0.1 ? 659 : t < 0.2 ? 880 : 1175) * 0.2 * env(t, 0.3)),
    ),
    // 探偵パート（のんびり）と法廷（緊張感）の短い繰り返し
    'bgm:investigation': wav(
      tune(
        100,
        [
          [4, 1],
          [7, 1],
          [9, 1],
          [7, 1],
          [4, 1],
          [2, 1],
          [0, 2],
          [2, 1],
          [4, 1],
          [7, 1],
          [4, 1],
          [2, 2],
          [null, 2],
        ],
        [0, 5, 7, 5],
      ),
    ),
    'bgm:trial': wav(
      tune(
        132,
        [
          [9, 0.5],
          [9, 0.5],
          [12, 1],
          [11, 0.5],
          [9, 0.5],
          [8, 1],
          [9, 0.5],
          [11, 0.5],
          [12, 0.5],
          [14, 0.5],
          [12, 2],
          [null, 1],
        ],
        [9, 9, 5, 7],
      ),
    ),
    'bgm:verdict': wav(
      tune(
        120,
        [
          [0, 0.5],
          [4, 0.5],
          [7, 0.5],
          [12, 1.5],
          [11, 0.5],
          [12, 2],
          [null, 2],
        ],
        [0, 5, 7, 0],
      ),
    ),
  };
}

/** サンプルの仮の音（初めて使うときに合成する） */
export function sampleSounds(): AudioSources {
  const get = (key: string) => (cache ??= build())[key];
  return { se: (id) => get(`se:${id}`), bgm: (id) => get(`bgm:${id}`) };
}
