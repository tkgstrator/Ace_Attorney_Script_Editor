// 区画の命令を順に読んで、台詞（say）と前後のステップを組み立てる。
//
// 元の台本では、文字・待ち・色・揺れなどが 1 本の命令列に並び、[page] でボタンを待つ。
// ここでは 1 ページ = 1 つの say にし、文の途中の演出は文中コマンド（[wait 8] など）にする。
// 文中コマンドにできない命令（人物・背景の切り替えなど）が文の途中にあれば、その say の後に回す（ずれとして数える）。
import { colorName, escapeText, inline, type TextColor } from './mapping.ts';
import type { Stats } from './stats.ts';
import type { Step } from './types.ts';

interface OpenSay {
  speaker: string | null;
  text: string;
  color: TextColor;
  card: boolean;
  speakerNo: number;
}

/** 区画に入るたびに戻る値（engine.json の section_entry_reset） */
export interface TextState {
  color: TextColor;
  speed: number;
  speaker: number;
  align: number;
  /** 文字送りの音の種類（0 標準・1 女性・2 タイプライター）と、鳴らすか（66） */
  blip: number;
  blipOn: boolean;
}
export const resetState = (): TextState => ({
  color: 'white',
  speed: 3,
  speaker: 0,
  align: 0,
  blip: 0,
  blipOn: true,
});
export const BLIP_NAMES = ['male', 'female', 'typewriter'] as const;

export class Writer {
  readonly out: Step[] = [];
  readonly st: TextState = resetState();
  /** 今の画面の覆い（フェードの結果） */
  cover: 'black' | 'white' | null = null;
  /** 直前の止まるステップ（フェード・吹き出し）の長さのうち、後の wait に含めてよい残り */
  absorb = 0;
  #say: OpenSay | null = null;
  #deferred: Step[] = [];
  /** ページの終わりの部分（この後に文が無い）で、文中にできない命令が出た後か */
  #tail = false;

  private readonly stats: Stats;
  private readonly section: number;
  /** 名前の番号 → 人物 ID（0 は null） */
  private readonly speakerId: (n: number) => string | null;
  /** 日時・場所の表示（揃え 1・名前なし）を捨てる（証言のタイトル） */
  private readonly dropCards: boolean;

  /** 名前の番号 → その人物の文字送りの音の種類（台詞の頭で違えば [blip] を付ける） */
  blipOf: (n: number) => number = () => 0;

  constructor(
    stats: Stats,
    section: number,
    speakerId: (n: number) => string | null,
    dropCards = false,
  ) {
    this.stats = stats;
    this.section = section;
    this.speakerId = speakerId;
    this.dropCards = dropCards;
  }

  get open(): boolean {
    return this.#say !== null;
  }
  /** 文中コマンドを書けるか（文の途中・ページの終わりの部分の前） */
  get inlineable(): boolean {
    return this.#say !== null && !this.#tail;
  }

  /** 文字を足す。台詞が始まっていなければ始める */
  text(s: string) {
    if (!this.#say) {
      const speakerNo = this.st.speaker;
      this.#say = {
        speaker: this.speakerId(speakerNo),
        speakerNo,
        text: '',
        color: this.st.color,
        card: this.st.align === 1 && speakerNo === 0,
      };
      if (this.st.speed !== 3) this.#say.text += inline.speed(this.st.speed);
      if (!this.#say.card) {
        if (this.st.blip !== this.blipOf(speakerNo))
          this.#say.text += `[blip ${BLIP_NAMES[this.st.blip] ?? 'male'}]`;
        if (!this.st.blipOn) this.#say.text += '[blip off]';
      }
      this.absorb = 0;
    }
    this.#say.text += escapeText(s);
  }

  /** 文中コマンドを足す（書けなければ false） */
  inline(cmd: string): boolean {
    if (!this.inlineable) return false;
    this.#say!.text += cmd;
    return true;
  }

  /** ステップを出す。台詞の途中なら、その台詞の後に回す */
  step(s: Step) {
    if (this.#say) this.#deferred.push(s);
    else this.out.push(s);
  }

  /** ページの終わりの部分に入った（この後に文は無い） */
  enterTail() {
    if (this.#say) this.#tail = true;
  }

  /** 待つ。文中なら [wait]、そうでなければ wait ステップ（直前のフェード・吹き出しの長さに含まれる分は捨てる） */
  wait(n: number) {
    if (n <= 0) return;
    if (this.inline(inline.wait(n))) {
      this.stats.hit('wait', 'inline');
      return;
    }
    if (this.absorb > 0) {
      const used = Math.min(this.absorb, n);
      this.absorb -= used;
      n -= used;
      this.stats.hit('wait', 'structure');
      if (n === 0) return;
    }
    this.step({ wait: n });
    this.stats.hit('wait', 'step');
  }

  /** 色（文中なら [color]、そうでなければ次の台詞の色） */
  color(c: number) {
    const name = colorName(c);
    if (this.#say && !this.#tail) this.#say.text += inline.color(name);
    this.st.color = name;
    this.stats.hit('color', this.#say ? 'inline' : 'structure');
  }

  /** 文字送りの音の種類（48）・鳴らすか（66） */
  blip(kind: number | null, on?: boolean) {
    const cmd =
      kind !== null ? `[blip ${BLIP_NAMES[kind] ?? 'male'}]` : `[blip ${on ? 'on' : 'off'}]`;
    if (this.#say && !this.#tail) this.#say.text += cmd;
    if (kind !== null) this.st.blip = kind;
    if (on !== undefined) this.st.blipOn = on;
    this.stats.hit(kind !== null ? 'blip_kind' : 'blip_on', this.#say ? 'inline' : 'structure');
  }

  speed(n: number) {
    if (this.#say && !this.#tail) this.#say.text += inline.speed(n);
    this.st.speed = n;
    this.stats.hit('speed', this.#say ? 'inline' : 'structure');
  }

  /**
   * 台詞を閉じる。how = input（ボタン待ち）/ keep（ボタンを待たずに文を残す = 選択肢の問い）/ auto（ボタンを待たずに消える）。
   * 閉じた台詞は返す（つきつけの問いかけに使うとき）。emit = false なら出さない
   */
  close(how: 'input' | 'keep' | 'auto', emit = true): OpenSay | null {
    const say = this.#say;
    this.#say = null;
    this.#tail = false;
    if (say && emit) {
      if (how === 'keep')
        this.stats.gap('問いを残したまま選択肢を出す（7 page_nowait）', this.section);
      this.out.push(...this.sayStep(say, how === 'auto'));
    }
    this.out.push(...this.#deferred);
    this.#deferred = [];
    return say;
  }

  /** 台詞のステップ。auto = ボタンを待たずに進む（元の 46 clear・13 end などで文が消える） */
  sayStep(say: OpenSay, auto = false): Step[] {
    const text = say.text.replace(/(\[color white\])+$/, '');
    if (say.card) {
      if (this.dropCards) return [];
      if (auto)
        this.stats.gap(
          'ボタンを待たずに消える日時・場所の表示（card に auto が無い）',
          this.section,
        );
      return [{ card: plain(text) }];
    }
    const thought = /^[（(]/.test(plain(text));
    const needColor = say.color !== 'white' || thought;
    if (needColor || auto)
      return [
        {
          say: say.speaker,
          text,
          ...(needColor ? { color: say.color } : {}),
          ...(auto ? { auto: true } : {}),
        },
      ];
    if (say.speaker === null) return [{ narrate: text }];
    return [{ [say.speaker]: text }];
  }
}

/** 文中コマンドを外した文字列（[[ は [ に戻す） */
export function plain(text: string): string {
  return text.replace(/\[\[|\[[^\]]*\]/g, (m) => (m === '[[' ? '[' : ''));
}
