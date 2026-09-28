// docs/screen.md の比較画像（4:3 と 16:9 を横に並べた等倍の PNG）を描くページ。
// ?shot=<名前> の場面を、左に 4:3、右に 16:9 で描き、ページの左上に等倍で置く（ヘッドレスの Chrome で撮る）。
// サンプルの章は生成したドット絵（公式の絵を使わない）、official- で始まる場面だけ DS 版の絵で描く。
import { type Assets, loadFonts } from '@gyakusai/runtime';
import { loadScenario } from '@gyakusai/script';
import type { Flow } from './aspect-check-flows.ts';
import { flowShots, type Shot } from './aspect-check-play.ts';
import { CASES } from './cases.ts';
import { loadDsFont } from './ds-font.ts';
import { loadImageAssets } from './image-assets.ts';
import { withOfficialAnims } from './official-anims.ts';
import { loadOfficialAssets } from './official-assets.ts';
import { withOfficialRecord } from './official-record.ts';
import { withOfficialStage } from './official-stage.ts';
import { withOfficialUi } from './official-ui.ts';
import { createPlaceholderAssets } from './placeholder-art.ts';

const ct = (scene: string, stop: Flow['stop'], ops: Flow['ops'] = []): Flow => ({
  case: 'clocktower',
  scene,
  stop,
  ops: [['pump', 120], ...ops, ['snap', '']],
});

const SHOTS: Record<string, Flow> = {
  talk: ct('contradiction', (b) => b.kind === 'line'),
  cross: ct('t1', (b) => b.kind === 'statement' && b.cross),
  menu: ct('plaza', (b) => b.kind === 'investigate'),
  examine: ct('plaza', (b) => b.kind === 'investigate', [['key', 'Enter']]),
  choice: ct('contradiction', (b) => b.kind === 'choice'),
  record: ct('contradiction', (b) => b.kind === 'line', [['key', 'x']]),
  added: ct('contradiction', (_, e) => e.state.evidence.includes('keys')),
  'official-court': {
    case: 'ep1',
    scene: 's002',
    // 視点の流しの後の、短い台詞の法廷の場面
    stop: (b, e) =>
      b.kind === 'line' &&
      !e.state.stage.pan &&
      !!e.state.stage.character &&
      b.text.replace(/\[[^\]]*\]/g, '').length <= 12,
    ops: [
      ['pump', 90],
      ['snap', ''],
    ],
  },
  'official-examine': {
    case: 'ep3',
    scene: 'p5_place8',
    stop: (b) => b.kind === 'investigate',
    ops: [
      ['pump', 30],
      ['key', 'Enter'],
      ['snap', ''],
    ],
  },
};

const GAP = 8;

/**
 * サンプルの広場には背景の絵が無いので、比較用に横長（512×192）の仮の背景を描いて足す
 * （空・建物・時計塔・ベンチ。時計塔とベンチは章の「調べる」範囲の位置に置く）
 */
function withPlaza(base: Assets): Assets {
  const c = document.createElement('canvas');
  c.width = 512;
  c.height = 192;
  const g = c.getContext('2d')!;
  const rect = (x: number, y: number, w: number, h: number, color: string) => {
    g.fillStyle = color;
    g.fillRect(x, y, w, h);
  };
  for (let y = 0; y < 120; y++) rect(0, y, 512, 1, `rgb(${90 + y} ${140 + y / 2} ${200 - y / 3})`);
  for (let x = 0; x < 512; x += 48)
    rect(x, 70 - ((x * 7) % 30), 40, 60 + ((x * 7) % 30), '#6a6f86');
  rect(0, 120, 512, 72, '#8a7a5c');
  for (let x = 0; x < 512; x += 32) rect(x, 150, 16, 2, '#7a6a4e');
  // 時計塔（調べる範囲 [96, 8, 64, 88]）
  rect(104, 24, 48, 100, '#c8b890');
  rect(96, 8, 64, 20, '#9a5a3a');
  g.fillStyle = '#f8f0d8';
  g.beginPath();
  g.arc(128, 48, 14, 0, Math.PI * 2);
  g.fill();
  rect(127, 36, 2, 13, '#303030');
  rect(128, 47, 9, 2, '#303030');
  // ベンチ（調べる範囲 [16, 120, 80, 40]）と、右の広場の噴水
  rect(20, 128, 72, 8, '#6a4a2a');
  rect(24, 136, 4, 16, '#4a3a2a');
  rect(84, 136, 4, 16, '#4a3a2a');
  rect(360, 118, 96, 24, '#a0a8b8');
  rect(380, 96, 56, 24, '#b8c8e0');
  return {
    ...base,
    background: (key) => (key === 'plaza' ? c : base.background?.(key)),
  };
}
const name = new URLSearchParams(location.search).get('shot') ?? 'talk';
const flow = SHOTS[name];
if (!flow) throw new Error(`場面がありません: ${name}`);
const entry = CASES.find((c) => c.id === flow.case)!;
const { scenario } = loadScenario(await entry.load());
if (!scenario) throw new Error('章を読み込めません');
await loadFonts();
const fonts = await loadDsFont();
const generated = await loadImageAssets(createPlaceholderAssets());
const assets: Assets = name.startsWith('official-')
  ? await withOfficialUi(
      await withOfficialStage(
        await withOfficialRecord(
          await withOfficialAnims(await loadOfficialAssets(generated, entry.game), entry.game),
          entry.game,
        ),
        entry.game,
      ),
    )
  : withPlaza(generated);

// 絵を読み込むために 1 度進めてから描く
flowShots(scenario, assets, fonts, '4:3', flow);
await new Promise((r) => setTimeout(r, 3000));
const [narrow] = flowShots(scenario, assets, fonts, '4:3', flow);
const [wide] = flowShots(scenario, assets, fonts, '16:9', flow);

/** 2 倍で描いた画面を等倍（1 ドット = 1 画素）にして置く */
async function put(g: CanvasRenderingContext2D, s: Shot, x: number) {
  const img = new Image();
  img.src = s.url;
  await img.decode();
  g.imageSmoothingEnabled = false;
  g.drawImage(img, x, 0, img.width / 2, img.height / 2);
}
const out = document.createElement('canvas');
out.width = 256 + GAP + 342;
out.height = 192;
const g = out.getContext('2d')!;
await put(g, narrow!, 0);
await put(g, wide!, 256 + GAP);
document.body.append(out);
document.title = 'done';
