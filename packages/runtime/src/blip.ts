// 文字送りの音。元のゲームの決まり（tables/sound.json の blip の解析結果）に合わせる。
//   1 文字出すたびに数え、カウンタ c が 0 か、速さ（1 文字の間隔）が 5 以上なら鳴らす（それ以外は c を 1 減らす）。
//   鳴らしたら、タイプライター以外は c = 1（= 1 文字おき）、タイプライターは c を変えない（= 毎文字）。
//   文の始めは c = 1（最初の文字は鳴らない）。速さ 0（一度に全部出す）では鳴らさない。
import type { Beat, BlipKind, CompiledScenario } from '@gyakusai/core';

export class Blip {
  #kind: BlipKind = 'male';
  #on = true;
  #c = 1;

  /** 文の始め */
  reset(kind: BlipKind): void {
    this.#kind = kind;
    this.#on = true;
    this.#c = 1;
  }

  /** 文中の [blip ...] */
  command(kind: 'male' | 'female' | 'typewriter' | 'off' | 'on'): void {
    if (kind === 'off') this.#on = false;
    else if (kind === 'on') this.#on = true;
    else this.#kind = kind;
  }

  /** 1 文字出したとき。鳴らすなら効果音の ID（blip_male など）を返す */
  char(speed: number): string | null {
    if (!this.#on || this.#kind === 'none' || speed === 0) return null;
    if (this.#c === 0 || speed >= 5) {
      if (this.#kind !== 'typewriter') this.#c = 1;
      return `blip_${this.#kind}`;
    }
    this.#c--;
    return null;
  }
}

/** 文字送りの音の種類（話し手の設定。日時・場所の表示はタイプライター） */
export function blipKindOf(scenario: CompiledScenario, b: Beat): BlipKind {
  if (b.kind === 'card') return 'typewriter';
  const who = b.kind === 'line' ? b.speaker : b.kind === 'statement' ? b.witness : null;
  return (who ? scenario.characters[who]?.blip : undefined) ?? 'male';
}
