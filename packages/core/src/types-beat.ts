// 表示単位（Beat）と、表示側に知らせる演出のイベントの型（types.ts から分けたもの）。
import type { Area, FadeColor, FlashColor, Pose, ShoutKind, TextColor } from './types.ts';

export type Beat =
  /** inspect: 法廷記録から詳しく調べられる証拠品（あるときだけ。choice・card・statement も同じ） */
  | {
      kind: 'line';
      speaker: string | null;
      name: string | null;
      text: string;
      color: TextColor;
      auto?: boolean;
      inspect?: string[];
    }
  | { kind: 'shout'; shout: ShoutKind; by: string | null }
  /** sub: 証言・尋問の開始のとき、テキストウィンドウに出す証言のタイトル */
  | { kind: 'banner'; text: string; sub?: string; testimony?: 'reading' | 'cross' }
  /** 日時・場所の表示など、テキストウィンドウに中央寄せで出す文 */
  | { kind: 'card'; text: string; inspect?: string[] }
  | { kind: 'choice'; options: string[]; inspect?: string[] }
  /**
   * 絵の上の範囲を選ぶ（pick）。areas は今選べる範囲（Engine.pick の番号の順）。images が空なら今の背景の上。
   * miss: 範囲の外も選べる、quit: やめられる。person: 人物を選ぶ（nominate）ときの、その範囲に顔を出す人物 ID
   */
  | {
      kind: 'pick';
      prompt: string;
      images: string[];
      areas: { area: Area; image: number | null; person?: string }[];
      miss: boolean;
      quit: boolean;
    }
  /** inspect: 詳しく調べられる証拠品（あるときだけ）。profiles: 人物ファイルもつきつけられるか */
  /** giveUp: サイコ・ロックの挑戦中で、やめられる */
  | {
      kind: 'demand';
      prompt: string;
      name: string | null;
      inspect?: string[];
      profiles?: boolean;
      giveUp?: boolean;
    }
  | {
      kind: 'statement';
      cross: boolean;
      witness: string;
      name: string;
      title: string;
      text: string;
      /** 表示中の証言のうち何番目か（0 始まり）と、表示中の証言の数 */
      index: number;
      count: number;
      canPress: boolean;
      inspect?: string[];
    }
  | {
      /** 探索編の探偵メニュー */
      kind: 'investigate';
      place: string;
      name: string;
      person: string | null;
      examine: boolean;
      /** 「調べる」の間に背景をスクロールできるか（場所の examineScroll。背景が画面より大きいときだけ効く） */
      examineScroll: boolean;
      move: { id: string; name: string }[];
      talk: { id: string; topic: string; seen: boolean; locked?: boolean }[];
      /** 証拠品・人物ファイルをつきつけられるか（人物がいるとき） */
      present: boolean;
      /** 詳しく調べられる証拠品（あるときだけ） */
      inspect?: string[];
    }
  /** 画面のフェード。ms の間、表示側で覆いを動かしてから次へ進む */
  | { kind: 'fade'; dir: 'out' | 'in'; color: FadeColor; frames: number }
  | { kind: 'wait'; frames: number }
  | { kind: 'end' }
  | { kind: 'gameover' };

export type EngineEvent =
  | { type: 'penalty'; amount: number; life: number }
  | { type: 'heal'; amount: number; life: number }
  /** サイコ・ロックの錠の演出（出す・壊す・解除） */
  | { type: 'locks'; fx: 'show' | 'break' | 'unlock' | 'hide' }
  | { type: 'evidence'; id: string; added: boolean }
  /** 音と画面の演出（表示側が音を鳴らし、画面を揺らす・光らせる） */
  | { type: 'bgm'; id: string | null; frames: number }
  | { type: 'se'; id: string }
  | { type: 'shake'; frames: number; strength: number }
  | { type: 'flash'; color: FlashColor; frames: number }
  | { type: 'fade'; dir: 'out' | 'in'; color: FadeColor; frames: number }
  | { type: 'bgmPause'; pause: boolean; frames: number }
  /** 人物をだんだん出す（in）・消す（out）。out のときの character / pose は消える人物 */
  | {
      type: 'charFade';
      dir: 'in' | 'out';
      frames: number;
      character: string | null;
      pose: Pose | null;
    };
