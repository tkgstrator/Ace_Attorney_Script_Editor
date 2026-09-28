// ドット絵素材の一覧と、画像生成に渡す指示。
// 人物・手前（机）・証拠品は透過、背景は不透明で作る。人物はすべてオリジナルのデザインにする。

import type { Rect } from './checks.ts';

export type Kind = 'character' | 'background' | 'foreground' | 'evidence';

export interface Item {
  id: string;
  kind: Kind;
  /** 何を描くか（英語で渡す） */
  subject: string;
  /** 参考として Codex に渡す画像（リポジトリのルートからのパス）。画角や画風をそろえるのに使う */
  refs?: string[];
  /**
   * 差分コマで変えてよい範囲（人物のみ）。キーはコマの名前の後ろ（'talk'・'blink2' など）か種類（'talk'・'blink'）、
   * 値は加工後のコマの座標の矩形 [x, y, 幅, 高さ]。無ければチェッカーが違いの集まりから推定する（SPEC.md）
   */
  masks?: Record<string, Rect[]>;
}

export const STYLE = [
  'Style: polished retro pixel art in the look of a mid-2000s Nintendo DS courtroom adventure game.',
  'Crisp square pixels on a strict grid, clean dark outlines, 3 to 4 tone cel shading, limited palette,',
  'no anti-aliasing, no blur, no gradients, no dithering noise. No text, letters, logos or watermarks.',
  'All characters and designs must be original, not resembling any existing franchise character.',
].join(' ');

export const KIND_RULES: Record<Kind, string> = {
  character: [
    'A three-quarter-length character sprite on a GENUINELY TRANSPARENT background (real alpha channel; no checkerboard, no solid color, no floor, no shadow).',
    'Portrait canvas. The head is near the top; the body continues BELOW THE WAIST AND HIPS and is cut off across the upper thighs at the bottom edge',
    '(the lower part will be hidden behind a desk in the game, so it must be fully drawn, not faded or cropped at the waist). Arms and hands inside the frame.',
    'Neutral expression, eyes open, mouth closed.',
    'If a reference screenshot is attached, match its camera angle and the size of the head and shoulders relative to the screen,',
    'but draw the character described here (not the one in the screenshot), ignore the text box, and do not stop the body where the desk hides it.',
  ].join(' '),
  background: [
    'An empty scene with no people, landscape 4:3 composition at eye level, as seen behind a character standing in the middle.',
    'Opaque background (no transparency). Keep the center area uncluttered because a character sprite will be placed there.',
    'If a reference screenshot is attached, match its camera angle and composition, but leave out the person, the desk in front and the text box.',
  ].join(' '),
  foreground: [
    'Only the furniture in front of a standing person, seen straight from the front at eye level, spanning the full width of a landscape 4:3 canvas',
    'and occupying only the bottom quarter of the image. Everything above the furniture must be GENUINELY TRANSPARENT (real alpha channel).',
    'If a reference background is attached, use the same camera angle, perspective, lighting and color palette so the furniture fits in front of that background.',
  ].join(' '),
  evidence: [
    'A single item icon, centered, three-quarter view from slightly above, filling about 80 percent of a square canvas,',
    'on a GENUINELY TRANSPARENT background (real alpha channel; no checkerboard, no solid color, no shadow).',
  ].join(' '),
};

/** 立ち位置ごとの、DS 版の画面（画角・人物の大きさ・切れる位置の参考） */
const DS = 'assets/samples/ds/top/dialogue';
const FRAMING: Record<string, string> = {
  defense: `${DS}/20260927_11-17-29.177.png`,
  prosecution: `${DS}/20260927_11-17-26.149.png`,
  witness: `${DS}/20260927_11-22-18.599.png`,
  judge: `${DS}/20260927_11-17-20.424.png`,
};

export const ITEMS: Item[] = [
  // 人物（弁護側は右向き、検察側は左向き、証人と裁判長は正面）
  {
    id: 'naruse',
    kind: 'character',
    subject:
      'a 24-year-old rookie male defense attorney with spiky dark navy hair, earnest determined eyes, blue suit, white shirt, red tie, a small golden sunflower badge on the lapel, body turned slightly to the right',
    refs: [FRAMING.defense!],
    masks: { talk: [[89, 47, 16, 12]] },
  },
  {
    id: 'himuro',
    kind: 'character',
    subject:
      'a cool 32-year-old male prosecutor with neatly swept silver hair, thin rectangular glasses, sharp cold eyes, dark maroon three-piece suit with a white cravat, arms folded, body turned slightly to the left',
    refs: [FRAMING.prosecution!],
    masks: { talk: [[54, 46, 16, 12]] },
  },
  {
    id: 'torii',
    kind: 'character',
    subject:
      'a 58-year-old male witness with short gray hair, a thick gray mustache, a shifty smug smile, brown jacket, cream shirt and green tie, hands clasped in front of his chest, facing the viewer',
    refs: [FRAMING.witness!],
    masks: { talk: [[72, 52, 16, 12]] },
  },
  {
    id: 'judge',
    kind: 'character',
    subject:
      'an elderly bald male judge with a large bushy white beard and white side hair, kind but stern eyes, black judicial robe with white collar, facing the viewer',
    refs: [FRAMING.judge!],
    masks: { talk: [[85, 46, 16, 12]] },
  },
  // 背景（立ち位置ごと）
  {
    id: 'defense',
    kind: 'background',
    subject:
      'the defense side of a courtroom: warm brown wooden wall panels with vertical grooves, a high wooden wainscot, soft light from above',
    refs: [FRAMING.defense!],
  },
  {
    id: 'prosecution',
    kind: 'background',
    subject:
      'the prosecution side of a courtroom: dark purple-gray wooden wall panels with vertical grooves, cold light, slightly gloomy mood',
    refs: [FRAMING.prosecution!],
  },
  {
    id: 'witness',
    kind: 'background',
    subject:
      'the witness area of a courtroom: a dark blue-gray stone brick wall with two tall wooden pillars on the sides',
    refs: [FRAMING.witness!],
  },
  {
    id: 'judge',
    kind: 'background',
    subject:
      'the judge area of a courtroom: dark red wooden wall with vertical slats and a large round golden emblem of balance scales high on the wall',
    refs: [FRAMING.judge!],
  },
  // 手前（人物の前に置く机）
  {
    id: 'defense',
    kind: 'foreground',
    subject: 'a long polished brown wooden courtroom counsel desk with a lighter top edge',
    refs: [FRAMING.defense!, 'assets/generated/raw/background/defense.png'],
  },
  {
    id: 'prosecution',
    kind: 'foreground',
    subject: 'a long dark purple-brown wooden courtroom counsel desk with a lighter top edge',
    refs: [FRAMING.prosecution!, 'assets/generated/raw/background/prosecution.png'],
  },
  {
    id: 'witness',
    kind: 'foreground',
    subject:
      'a wooden courtroom witness stand, slightly narrower than the canvas and centered, with a light wooden top rail',
    refs: [FRAMING.witness!, 'assets/generated/raw/background/witness.png'],
  },
  {
    id: 'judge',
    kind: 'foreground',
    subject:
      'a tall heavy dark wooden judge bench spanning the whole width, with a small gavel and sound block on top',
    refs: [FRAMING.judge!, 'assets/generated/raw/background/judge.png'],
  },
  // 証拠品
  {
    id: 'badge',
    kind: 'evidence',
    subject:
      "a small round golden lawyer's lapel badge shaped like a sunflower with a tiny balance scale engraved in the center",
  },
  {
    id: 'autopsy',
    kind: 'evidence',
    subject:
      'a stapled autopsy report of two off-white paper sheets with a folded corner, rows of unreadable gray lines, and a red circular ink stamp',
  },
  {
    id: 'photo',
    kind: 'evidence',
    subject:
      'a printed photograph with a white border, tilted slightly, showing a small town plaza in the morning with a tall stone clock tower',
  },
  {
    id: 'repair',
    kind: 'evidence',
    subject:
      'a brown clipboard holding a maintenance work order sheet, with a small silver wrench lying diagonally across the lower part',
  },
  {
    id: 'clock',
    kind: 'evidence',
    subject:
      'a wooden mantel clock with a cream dial, the hands stopped at 9:15, and small brass feet',
  },
  {
    id: 'keys',
    kind: 'evidence',
    subject:
      'a metal key ring holding three keys, one shiny new brass key and two worn silver keys',
  },
];

/** 生成した元画像の置き場所（リポジトリのルートから） */
export const rawPath = (item: Item, suffix = '') =>
  `assets/generated/raw/${item.kind}/${item.id}${suffix}.png`;
