// 画面の寸法・配置・色・時間の定数。配置は DS 版のメイン画面（上画面）から測った値。
// 座標はすべてドット単位で、画面は 256×192 ドット。1 ドットを DOT px で描く。
import type { TextColor } from '@gyakusai/core';

export const DOT = 2;
export const SCREEN_W = 256;
export const SCREEN_H = 192;
export const WIDTH = SCREEN_W;
export const HEIGHT = SCREEN_H;

export type Rect = { x: number; y: number; w: number; h: number };
/** タブの角の落とし方（bl = 左下、bottom = 下の両側） */
export type Slant = 'none' | 'bl' | 'br' | 'tl' | 'tr' | 'bottom';
export const hit = (r: Rect, x: number, y: number) =>
  x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;

export const TEXT_COLORS: Record<TextColor, string> = {
  white: '#f8f8f8',
  blue: '#78c0ff',
  green: '#48e048',
  orange: '#f89830',
  red: '#f05040',
};

export const SHOUTS = {
  objection: { label: '異議あり！', color: '#e82818' },
  hold: { label: '待った！', color: '#e82818' },
  takethat: { label: 'くらえ！', color: '#e82818' },
} as const;
export type ShoutKind = keyof typeof SHOUTS;

/** 1 フレーム（1/60 秒）のミリ秒。元のゲームの時間の単位 */
export const FRAME_MS = 1000 / 60;

export const TIMING = {
  shoutMs: 1000,
  bannerMs: 1800,
  /** 選択肢が出た直後は、文章送りの連打で誤って選ばないように入力を無視する */
  choiceGuardMs: 400,
  /** エンディングが出た直後も同じ */
  endGuardMs: 1200,
  /** ペナルティの後、ライフの「！」を表示しておくフレーム数 */
  lifeShowFrames: 120,
};

/** テキストウィンドウの中身の不透明度（背景が透けて見える） */
export const TEXTBOX_ALPHA = 0.6;
export const RECORD_PER_PAGE = 8;

export const COLORS = {
  tabFill: '#6a2808',
  tabEdge: '#e8e0d0',
  nameBar: '#2c2c34',
  nameText: '#f8a020',
  desc: '#b0d8a0',
  descLine: '#a0c890',
  descText: '#282828',
  nameTag: '#4848a0',
  nameTagEdge: '#b8b8e8',
  life: '#3868e8',
  lifeEdge: '#101840',
};

/** 法廷記録の色（DS 版の下画面の画素の値） */
export const REC_COLORS = {
  // 背景の絵がないときの色と、横じま（明るい行に足す色）
  bgMid: '#595141',
  bgLow: '#4d463a',
  stripe: '#1c1c1c',
  // 上下の明るい帯
  plate: '#dfdfdf',
  plateEdge: '#969696',
  plateAa: '#cecece',
  // 見出しの暗い帯
  bar: '#5d5d5d',
  barDark: '#353535',
  barEdge: '#4d4d4d',
  // 茶色のボタン
  btnOuter: '#ffffff',
  btnEdge: '#454545',
  btnFill: '#7d3500',
  btnLight: '#a67d5d',
  btnLight2: '#9e5d3d',
  btnDark: '#6d2d00',
  btnSide: '#864514',
  btnSideR: '#752d00',
  btnText: '#ffffff',
  btnTextEdge: '#652400',
  btnArrow: '#c69e86',
  // 赤い縦長のボタン
  sideEdge: '#414141',
  sideFill: '#792800',
  sideInner: '#712800',
  sideDark: '#612000',
  arrowAa: '#be9686',
  // 木の板と、空きのマス
  panel: '#867141',
  panelEdge: '#715941',
  cellLight: '#e7df96',
  cellMid: '#beae69',
  cellCorner: '#b6b6b6',
  cellFill: '#797979',
  // 2 重の枠
  frameWhite: '#efefef',
  frameGrey: '#9e9e9e',
  frameShadow: '#868686',
  frameCorner: '#cecece',
  // 名前の帯と、説明の緑の欄
  nameBar: '#393939',
  nameText: '#ffae18',
  desc: '#9ec696',
  descEdge: '#699669',
  descBottom: '#cecece',
  descCorner: '#b6b6b6',
  descText: '#393939',
  // 詳細の上下の帯
  frieze: '#c6c6c6',
  friezeTop: '#cecece',
  friezeBottom: '#b6b6b6',
  friezeHi: '#ffffff',
  friezeHi2: '#f7f7f7',
  friezeLine: '#8e8e8e',
  friezeLineTop: '#969696',
  // 見出しの文字
  titleText: '#ffffff',
  titleEdge: '#353535',
};

/** メイン画面の配置 */
export const TOP = {
  box: { x: 0, y: 144, w: 256, h: 48 },
  /** 選択肢を出すときは、テキストウィンドウを上にずらし、下に帯を出す */
  choiceBox: { x: 0, y: 120, w: 256, h: 48 },
  choiceBand: { x: 0, y: 168, w: 256, h: 24 },
  nameTagH: 12,
  textX: 10,
  /** テキストウィンドウの上端から、1 行目の文字（インク）の上端まで。DS 版では y 152 */
  inkDY: 8,
  lineH: 18,
  thumb: { x: 14, y: 14, w: 68, h: 68 },
  /** 文字送りの ▶。x から swing ドット右まで、period フレームで 1 往復する（往復の速さは目測） */
  arrow: { x: 243, y: 172, swing: 3, period: 32 },
  /** 証拠品を入手したときの窓（DS 版の上画面と同じく画面の幅いっぱい） */
  added: { x: 0, y: 16, w: 256, h: 80 },
  lifeY: 16,
};

/** メイン画面に重ねる操作部品（DS 版では下画面にあったもの） */
export const UI = {
  recordTab: { x: 196, y: 0, w: 60, h: 16 },
  pressTab: { x: 108, y: 112, w: 72, h: 18 },
  presentTab: { x: 184, y: 112, w: 72, h: 18 },
  /** 選択肢のボタン。上にずらしたテキストウィンドウの、さらに上の空きに並べる */
  choice: (i: number, n: number): Rect => ({
    x: 16,
    y: Math.round(56 - (n * 32 - 8) / 2) + i * 32,
    w: 224,
    h: 24,
  }),
  /** 探偵メニューのボタン（調べる・移動する・話す・つきつける）。テキストウィンドウの位置に横に並べる */
  invButton: (i: number): Rect => ({ x: 4 + i * 63, y: 156, w: 59, h: 28 }),
  /** 探偵メニューの行き先・話題の一覧と、調べるときの「もどる」 */
  invBack: { x: 0, y: 162, w: 78, h: 30 },
  /** 調べるときの、背景を動かすボタン（元のゲームの下の画面の真ん中のボタン。ここでは「もどる」と左右対称の右下） */
  examineScroll: { x: 196, y: 162, w: 60, h: 30 },
  /** 調べるときのカーソルの動く量（ドット） */
  cursorStep: 4,
  /**
   * 法廷記録。DS 版の下画面の配置を、そのままメイン画面に重ねる（背景ごと不透明に描く）。
   * 値は DS 版の下画面のスクリーンショット（assets/samples/ds/bottom/）から測ったもの
   */
  rec: {
    /** 見出し（「証拠品ファイル」）の文字を置く所 */
    title: { x: 0, y: 10, w: 70, h: 22 },
    /** 右上の「▶人物ファイル」のタブ（左下を斜めに落とした形の外接矩形） */
    switchTab: { x: 177, y: 0, w: 79, h: 30 },
    /** 上の中央の「つきつける」（下の両側を斜めに落とした形） */
    presentBtn: { x: 89, y: 0, w: 78, h: 30 },
    /** 左下の「もどる」（右上を斜めに落とした形） */
    back: { x: 0, y: 162, w: 79, h: 30 },
    /** 詳細の右下の「調べる」（詳しく調べられる証拠品のときだけ） */
    inspectBtn: { x: 177, y: 162, w: 79, h: 30 },
    /** 一覧の名前の帯（白い枠の外側） */
    nameBar: { x: 25, y: 36, w: 206, h: 19 },
    /** 一覧の木の板 */
    panel: { x: 24, y: 56, w: 208, h: 104 },
    /** 一覧のマス（アイコンを置く 40×40。選んだマスは、その外側 2 ドットに枠が付く） */
    cell: (i: number): Rect => ({
      x: 36 + (i % 4) * 48,
      y: 64 + Math.floor(i / 4) * 48,
      w: 40,
      h: 40,
    }),
    pageL: { x: 0, y: 56, w: 16, h: 96 },
    pageR: { x: 240, y: 56, w: 16, h: 96 },
    /** 詳細の上下の帯（6 行）と、その間の木の板 */
    friezeTop: 48,
    friezeBottom: 138,
    wood: { x: 0, y: 54, w: 256, h: 84 },
    /** 詳細のアイコンの枠（白い枠の外側。アイコンは内側 2 ドットから 64×64） */
    icon: { x: 19, y: 62, w: 67, h: 67 },
    /** 詳細の名前と説明の枠（白い枠の外側） */
    info: { x: 89, y: 62, w: 147, h: 67 },
    /** 枠の中の、名前の暗い帯と、説明の緑の欄 */
    detailName: { x: 91, y: 64, w: 144, h: 17 },
    detailDesc: { x: 91, y: 81, w: 144, h: 47 },
    /** 説明文の 1 行目の、字のマスの左端と、点の上端。行の間隔 */
    descText: { x: 96, y: 84, lineH: 15 },
    /** 名前の字の点の範囲の中心（一覧の帯・詳細。DS 版のスクリーンショットで測った値） */
    nameCx: { list: 127, detail: 161 },
    itemL: { x: 0, y: 64, w: 16, h: 64 },
    itemR: { x: 240, y: 64, w: 16, h: 64 },
  },
};
