import type { Engine } from '@gyakusai/core';
import type { AudioOut } from './audio.ts';
import type { ShoutKind } from './layout.ts';
import type { FontSpec } from './text.ts';

/**
 * 画面の部品の絵の名前（Assets.ui）。recordBackground 以外は DS 版の下画面の部品（OBJ）と同じ大きさ・形の絵で、
 * 透明な所を含む。置く位置はこちらで決める（DS 版の下画面の位置）
 */
export type UiPart =
  | 'recordBackground'
  /** 上下の明るい帯（16×32。上の帯は横 2 倍、下の帯は上下反転して並べる） */
  | 'frameBar'
  /** 下の帯の「もどる」の右の斜めの角（16×32。上下左右を反転して置く） */
  | 'frameCorner'
  /** 左上の題の札（「証拠品」「人物」「ファイル」各 32×32）と、その右端の斜め（16×32） */
  | 'titleEvidence'
  | 'titleProfile'
  | 'titleFile'
  | 'titleEnd'
  /** 茶色のボタン（80×32）: もどる・▶人物ファイル・▶証拠品ファイル・つきつける（詳細の上）・法廷記録・ゆさぶる・つきつける（尋問） */
  | 'back'
  | 'toProfile'
  | 'toEvidence'
  | 'present'
  | 'record'
  | 'press'
  | 'presentCross';

/** 画像の供給元。返せないものは undefined にすれば、仮の表示になる */
export interface Assets {
  /** 背景（256×192）。key は場所 ID（location）か、人物の立ち位置（stand） */
  background?(key: string): CanvasImageSource | undefined;
  /** 人物の手前に重ねる画像（証言台や机など）。key は background と同じ */
  foreground?(key: string): CanvasImageSource | undefined;
  /** 重ね絵（元のゲームの 47 anim など）。frame は出してからのフレーム数。x, y は画面上の左上 */
  overlay?(
    id: string,
    frame: number,
  ): { image: CanvasImageSource; x: number; y: number } | undefined;
  /** 法廷の視点の流しに使う全景（横長の絵）と、種類ごとの 1 フレームずつの表 */
  panorama?(): CanvasImageSource | undefined;
  panFrames?(type: number): PanFrame[] | undefined;
  /** 画面より大きい背景の、最初の表示位置（左上からのドット。なければ (0, 0)。縦長の背景は下端から見せるものがある） */
  backgroundStart?(key: string): [number, number] | undefined;
  /** 立ち絵。画面の下端・中央に合わせて描く */
  portrait?(
    character: string,
    frame: { talking: boolean; blink: boolean; anim?: number | string },
  ): CanvasImageSource | undefined;
  /**
   * 証拠品のアイコン。size は描く大きさ（一覧では 32、詳細や小窓では 64）。
   * 返した画像が size と違う大きさなら、size に合わせて拡大・縮小して描く
   */
  evidence?(id: string, size: number): CanvasImageSource | undefined;
  /** 人物ファイルの顔（64×64）。なければ立ち絵の上の方を切り出して使う */
  face?(character: string): CanvasImageSource | undefined;
  /** 「異議あり！」などの吹き出し（256×192、画面全体に重ねる）。なければ図形と文字で描く */
  shout?(kind: ShoutKind): CanvasImageSource | undefined;
  /**
   * 画面の部品の絵。なければ図形で描く。
   * - recordBackground: 法廷記録の後ろに出す絵（256×192。DS 版の下画面のくすんだ法廷。上下の帯と横じまはこちらで重ねる）
   * - それ以外: 法廷記録の帯・題・ボタンと、メイン画面に重ねる「法廷記録」「ゆさぶる」「つきつける」（UiPart を参照）。
   *   あればその絵を DS 版の位置に置き、なければ図形と文字で描く
   */
  ui?(part: UiPart): CanvasImageSource | undefined;
}

/** 視点の流しの 1 フレーム。bgX: 全景の左端（null はまだ元の背景）、char: 流す前か行き先の人物、charX: 人物の原点の x */
export interface PanFrame {
  bgX: number | null;
  char: 'departing' | 'arriving';
  charX: number;
  desk: { kind: string; dx: number } | null;
}

export const DEFAULT_LABELS = {
  record: '法廷記録',
  evidenceFile: '証拠品ファイル',
  profileFile: '人物ファイル',
  back: 'もどる',
  press: 'ゆさぶる',
  present: 'つきつける',
  examine: '調べる',
  move: '移動する',
  talk: '話す',
  examineHint: 'どこを調べる？',
  choicePrompt: 'ぼくのコタエを示そう',
  testifying: '証言中',
  end: 'おしまい',
  gameover: 'ゲームオーバー',
};
export type Labels = typeof DEFAULT_LABELS;

export interface PlayerOptions {
  canvas: HTMLCanvasElement;
  engine: Engine;
  assets?: Assets;
  /** BGM・効果音の出力（createAudio で作れる）。なければ音を出さない */
  audio?: AudioOut;
  /** 本文のフォント。既定は同梱の PixelMplus12（先に loadFonts() を呼ぶこと） */
  font?: FontSpec;
  /** 名前欄などの小さい文字のフォント。既定は PixelMplus10 */
  smallFont?: FontSpec;
  /** 説明文のフォント。既定は PixelMplus12 を詰めて並べたもの */
  descriptionFont?: FontSpec;
  /** 法廷記録の名前の帯のフォント（証拠品ファイル）。既定は本文のフォント */
  recordNameFont?: FontSpec;
  /** 法廷記録の名前の帯のフォント（人物ファイル。DS 版では証拠品より太い字）。既定は recordNameFont */
  recordProfileNameFont?: FontSpec;
  /** 法廷記録の見出し（「証拠品ファイル」）とタブのフォント。既定は smallFont */
  recordTitleFont?: FontSpec;
  /** 長くて収まらない選択肢のフォント（本文の字を詰めて並べたもの）。既定は descriptionFont */
  condensedFont?: FontSpec;
  /** テキストウィンドウの 1 行の文字数（全角）。既定 16 */
  charsPerLine?: number;
  /** テキストウィンドウの行数。収まらない文は、この行数ごとにページを分ける。既定 2 */
  linesPerPage?: number;
  /** 画面に出す文言（「法廷記録」「ゆさぶる」など） */
  labels?: Partial<Labels>;
  /** エンディング・ゲームオーバー画面でクリックされたとき */
  onRestart?: () => void;
}
