// docs/compatibility.md の比較画像（DS 版の上画面 | このプレイヤー | 違う所）を描くページ。
// ?shot=<名前> の場面を、公式の章（蘇る逆転の第 1 話）と DS 版の絵で描き、DS 版のスクリーンショットと画素で比べる。
// ページの左上に等倍で置き、document.title に「done <一致率> <黒でない画素の一致率>」を書く（ヘッドレスの Chrome で撮る）。
import { type Assets, loadFonts } from '@gyakusai/runtime';
import { loadScenario } from '@gyakusai/script';
import choiceImg from '../../../assets/samples/ds/top/choice/20260927_11-18-39.335.png?url';
import cross from '../../../assets/samples/ds/top/cross-exam/20260927_11-26-47.376.png?url';
import talk from '../../../assets/samples/ds/top/dialogue/20260927_11-17-26.149.png?url';
import added from '../../../assets/samples/ds/top/evidence-added/20260927_11-18-55.260.png?url';
import cardImg from '../../../assets/samples/ds/top/location-card/20260927_11-17-16.361.png?url';
import shout from '../../../assets/samples/ds/top/shout/20260927_11-26-52.534.png?url';
import type { Flow } from './aspect-check-flows.ts';
import { flowShots, type Shot } from './aspect-check-play.ts';
import { CASES } from './cases.ts';
import { loadDsFont } from './ds-font.ts';
import { withOfficialAnims } from './official-anims.ts';
import { loadOfficialAssets } from './official-assets.ts';
import { withOfficialRecord } from './official-record.ts';
import { withOfficialStage } from './official-stage.ts';
import { withOfficialUi } from './official-ui.ts';
import { createPlaceholderAssets } from './placeholder-art.ts';

/** 尋問で、ヤマノの「時間はハッキリ覚えてます」の証言まで進める */
const atClock: Flow['stop'] = (b) =>
  b.kind === 'statement' && b.cross && b.text.includes('ハッキリ覚えてます');

const SHOTS: Record<string, { image: string; flow: Flow }> = {
  // 会話（名札・文字）
  talk: {
    image: talk,
    flow: {
      case: 'ep1',
      scene: 's002',
      stop: (b) => b.kind === 'line' && b.text.includes('検察側'),
      ops: [
        ['pump', 120],
        ['snap', ''],
      ],
    },
  },
  // 場面のカード（日時・場所）
  card: {
    image: cardImg,
    flow: {
      case: 'ep1',
      scene: 's002',
      stop: (b) => b.kind === 'card',
      ops: [
        ['pump', 90],
        ['snap', ''],
      ],
    },
  },
  // 選択肢（問いかけの台詞と、選ぶ画面）
  choice: {
    image: choiceImg,
    flow: {
      case: 'ep1',
      scene: 's011',
      stop: (b) => b.kind === 'choice',
      ops: [
        ['pump', 90],
        ['snap', ''],
      ],
    },
  },
  // 証拠品の入手の窓（「鈍器で殴られた」を選んだ後）
  added: {
    image: added,
    flow: {
      case: 'ep1',
      scene: 's011',
      stop: (b) => b.kind === 'choice',
      ops: [
        [
          'call',
          (e) => {
            e.choose(1);
            for (let i = 0; i < 100 && !e.state.evidence.includes('e7'); i++) e.advance();
          },
        ],
        ['pump', 150],
        ['snap', ''],
      ],
    },
  },
  // 尋問中の証言（緑の文字）
  cross: {
    image: cross,
    flow: {
      case: 'ep1',
      scene: 't037',
      stop: atClock,
      ops: [
        ['pump', 120],
        ['snap', ''],
      ],
    },
  },
  // 証拠品をつきつけて「異議あり！」
  objection: {
    image: shout,
    flow: {
      case: 'ep1',
      scene: 't037',
      stop: atClock,
      ops: [
        ['pump', 60],
        [
          'call',
          (e) => {
            if (!e.state.evidence.includes('e6')) e.state.evidence.push('e6');
            e.present('e6');
          },
        ],
        ['pump', 4],
        ['snap', ''],
      ],
    },
  },
};

const W = 256;
const H = 192;
const GAP = 8;
/** この差（RGB のどれか）より大きい画素を「違う」とする。DS 版の 15 ビット色と取り込みの揺れを吸収する幅 */
const THRESHOLD = 24;

const name = new URLSearchParams(location.search).get('shot') ?? 'talk';
const shot = SHOTS[name];
if (!shot) throw new Error(`場面がありません: ${name}`);
const entry = CASES.find((c) => c.id === shot.flow.case)!;
const { scenario } = loadScenario(await entry.load());
if (!scenario) throw new Error('章を読み込めません');
await loadFonts();
const fonts = await loadDsFont();
const assets: Assets = await withOfficialUi(
  await withOfficialStage(
    await withOfficialRecord(
      await withOfficialAnims(
        await loadOfficialAssets(createPlaceholderAssets(), entry.game),
        entry.game,
      ),
      entry.game,
    ),
    entry.game,
  ),
);

/**
 * DS 版の画面を撮った瞬間は、口の動き・揺れ・点滅のどのコマか分からない。
 * そこで最後の snap の後も 1 コマずつ SEARCH コマ撮り、DS 版に最も近いコマを選ぶ
 */
const SEARCH = 48;
const flow: Flow = {
  ...shot.flow,
  ops: [
    ...shot.flow.ops,
    ...Array.from({ length: SEARCH }, (): Flow['ops'][number] => ['snap', '']),
  ],
};

// 絵を読み込むために 1 度進めてから描く
flowShots(scenario, assets, fonts, '4:3', flow);
await new Promise((r) => setTimeout(r, 3000));
const shots: Shot[] = flowShots(scenario, assets, fonts, '4:3', flow);

async function image(url: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = url;
  await img.decode();
  return img;
}

/** 等倍の 256×192 の画素を読む（こちらの画面は 2 倍で描いてあるので縮める） */
async function pixels(url: string, scale: number): Promise<ImageData> {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  const img = await image(url);
  g.drawImage(img, 0, 0, img.width / scale, img.height / scale);
  return g.getImageData(0, 0, W, H);
}

/** RGB のどれもこれ以下なら黒とみなす（黒でない画素だけの一致率に使う） */
const BLACK = 16;

interface Result {
  /** 一致した画素の数 */
  same: number;
  /** どちらかが黒でない画素の数と、そのうち一致した数 */
  lit: number;
  litSame: number;
  /** 違う所の絵（DS 版を暗い灰色にし、違う画素を赤で塗る） */
  diff: ImageData;
}

/** 画素ごとに比べる */
function compare(a: ImageData, b: ImageData): Result {
  const diff = new ImageData(W, H);
  let same = 0;
  let lit = 0;
  let litSame = 0;
  for (let i = 0; i < W * H * 4; i += 4) {
    const d = Math.max(
      Math.abs(a.data[i]! - b.data[i]!),
      Math.abs(a.data[i + 1]! - b.data[i + 1]!),
      Math.abs(a.data[i + 2]! - b.data[i + 2]!),
    );
    const grey = (a.data[i]! + a.data[i + 1]! + a.data[i + 2]!) / 9;
    const hit = d > THRESHOLD;
    if (!hit) same++;
    const isLit =
      Math.max(a.data[i]!, a.data[i + 1]!, a.data[i + 2]!) > BLACK ||
      Math.max(b.data[i]!, b.data[i + 1]!, b.data[i + 2]!) > BLACK;
    if (isLit) {
      lit++;
      if (!hit) litSame++;
    }
    diff.data[i] = hit ? 255 : grey;
    diff.data[i + 1] = hit ? 48 : grey;
    diff.data[i + 2] = hit ? 48 : grey;
    diff.data[i + 3] = 255;
  }
  return { same, lit, litSame, diff };
}

const a = await pixels(shot.image, 1);
let best: (Result & { b: ImageData }) | null = null;
for (const s of shots) {
  const b = await pixels(s.url, 2);
  const r = compare(a, b);
  if (!best || r.same > best.same) best = { b, ...r };
}
if (!best) throw new Error('画面を撮れませんでした');
const { b, diff } = best;
const rate = ((best.same / (W * H)) * 100).toFixed(1);
const litRate = ((best.litSame / Math.max(1, best.lit)) * 100).toFixed(1);

const out = document.createElement('canvas');
out.width = W * 3 + GAP * 2;
out.height = H;
const g = out.getContext('2d')!;
g.putImageData(a, 0, 0);
g.putImageData(b, W + GAP, 0);
g.putImageData(diff, (W + GAP) * 2, 0);
document.body.append(out);
console.log(`${name}: ${rate}%（黒でない画素 ${litRate}%）`);
document.title = `done ${rate} ${litRate}`;
