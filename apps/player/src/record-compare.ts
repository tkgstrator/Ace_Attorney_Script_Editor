// 法廷記録の画面を、DS 版の下画面のスクリーンショットと同じ状態にして並べ、画素の違いを色で示す。
// こちらの画面は Player をそのまま動かし、キー操作（X で開く・Tab で人物ファイル・→ で選ぶ・Enter で詳細）で同じ状態にする。
// 「つきつける」のある画面は、「つきつけろ」の場面で開く。
import { Engine } from '@gyakusai/core';
import { type Assets, loadFonts, Player } from '@gyakusai/runtime';
import { formatDiagnostic, loadScenario } from '@gyakusai/script';
import { loadDsFont } from './ds-font.ts';
import { withOfficialRecord } from './official-record.ts';
import { withOfficialUi } from './official-ui.ts';
import { compareScenario, RECORD_CASES, type RecordCase } from './record-compare-cases.ts';

const W = 256,
  H = 192;
/** どれかの色成分の差がこれを超えたら「違う」画素 */
const THRESHOLD = 24;

await loadFonts();
const fonts = await loadDsFont();
const black = document.createElement('canvas');
black.width = W;
black.height = H;
black.getContext('2d')!.fillRect(0, 0, W, H);
const assets: Assets = await withOfficialUi(await withOfficialRecord({ background: () => black }));

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const key = (k: string) => window.dispatchEvent(new KeyboardEvent('keydown', { key: k }));

// 画面の更新（requestAnimationFrame）をこちらで進める。タブが裏にあって更新が止まっていても、同じ画面を作れるように
const frames = new Map<number, FrameRequestCallback>();
let frameId = 0,
  clock = 0;
window.requestAnimationFrame = (cb) => {
  frames.set(++frameId, cb);
  return frameId;
};
window.cancelAnimationFrame = (id) => {
  frames.delete(id);
};
function pump(n: number) {
  for (let i = 0; i < n; i++) {
    const cbs = [...frames.values()];
    frames.clear();
    clock += 1000 / 60;
    for (const cb of cbs) cb(clock);
  }
}

// アイコンの画像（非同期に読み込まれる）を先に読み込んでおく
const icons = [...new Set(RECORD_CASES.flatMap((c) => c.evidence))];
const faces = ['r0', 'r2', 'r3', 'r4', 'r5'];
for (let t = 0; t < 100; t++) {
  if (icons.every((id) => assets.evidence?.(id, 64)) && faces.every((id) => assets.face?.(id)))
    break;
  await sleep(100);
}

/** DS 版の画像の画素（PNG の色空間の変換をせず、そのままの値） */
async function dsPixels(url: string): Promise<ImageData> {
  const blob = await (await fetch(url)).blob();
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none' });
  const c = new OffscreenCanvas(W, H);
  const g = c.getContext('2d')!;
  g.drawImage(bmp, 0, 0);
  return g.getImageData(0, 0, W, H);
}

/** こちらの画面を、DS 版と同じ状態にして 256×192 で取り出す */
async function ourPixels(c: RecordCase): Promise<ImageData> {
  const { scenario, diagnostics } = loadScenario(compareScenario(c));
  if (!scenario)
    throw new Error(diagnostics.map((d) => formatDiagnostic(d, 'compare.yaml')).join('\n'));
  const canvas = document.createElement('canvas');
  const player = new Player({
    canvas,
    engine: new Engine(scenario),
    assets,
    ...fonts,
  });
  pump(2);
  key('x');
  pump(1);
  if (c.tab === 'profile') key('Tab');
  for (let i = 0; i < c.sel; i++) key('ArrowRight');
  if (c.detail) key('Enter');
  pump(2);
  const out = new OffscreenCanvas(W, H);
  const g = out.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(canvas, 0, 0, W, H);
  player.destroy();
  return g.getImageData(0, 0, W, H);
}

/** 違いの図と、違う画素の割合 */
function diff(a: ImageData, b: ImageData): { image: ImageData; ratio: number; mean: number } {
  const image = new ImageData(W, H);
  let bad = 0,
    sum = 0;
  for (let i = 0; i < W * H * 4; i += 4) {
    const d = Math.max(
      Math.abs(a.data[i]! - b.data[i]!),
      Math.abs(a.data[i + 1]! - b.data[i + 1]!),
      Math.abs(a.data[i + 2]! - b.data[i + 2]!),
    );
    sum += d;
    const lum = (a.data[i]! * 0.3 + a.data[i + 1]! * 0.59 + a.data[i + 2]! * 0.11) * 0.3;
    if (d > THRESHOLD) {
      bad++;
      const t = Math.min(1, d / 160);
      image.data.set([255, Math.round(40 + 215 * t), Math.round(40 * (1 - t)), 255], i);
    } else image.data.set([lum, lum, lum, 255], i);
  }
  return { image, ratio: bad / (W * H), mean: sum / (W * H) };
}

function canvasOf(img: ImageData): HTMLCanvasElement {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  c.getContext('2d')!.putImageData(img, 0, 0);
  return c;
}

function figure(label: string, el: HTMLElement): HTMLElement {
  const f = document.createElement('figure');
  const cap = document.createElement('figcaption');
  cap.textContent = label;
  f.append(el, cap);
  return f;
}

const results: { file: string; mismatch: number; mean: number }[] = [];
const blinkers: { el: HTMLCanvasElement; ds: ImageData; ours: ImageData }[] = [];
const tbody = document.querySelector('#summary tbody')!;
const list = document.getElementById('cases')!;

for (const c of RECORD_CASES) {
  const [ds, ours] = [await dsPixels(c.url), await ourPixels(c)];
  const { image, ratio, mean } = diff(ds, ours);
  results.push({ file: c.file, mismatch: ratio, mean });
  const pct = `${(ratio * 100).toFixed(1)}%`;
  const box = document.createElement('section');
  box.className = 'case';
  const h = document.createElement('h2');
  h.innerHTML = `${c.file} — ずれ <b>${pct}</b>${c.note ? `（${c.note}）` : ''}`;
  const oursCanvas = canvasOf(ours);
  blinkers.push({ el: oursCanvas, ds, ours });
  const row = document.createElement('div');
  row.className = 'row';
  row.append(
    figure('DS 版', canvasOf(ds)),
    figure('逆裁', oursCanvas),
    figure('違い', canvasOf(image)),
  );
  box.append(h, row);
  list.append(box);
  const tr = document.createElement('tr');
  tr.innerHTML = `<td>${c.tab === 'evidence' ? '証拠品' : '人物'}${c.detail ? 'の詳細' : 'の一覧'}${c.present ? '（つきつける）' : ''}</td><td>${c.file}</td><td class="num">${pct}</td><td class="num">${mean.toFixed(1)}</td><td>${c.note ?? ''}</td>`;
  tbody.append(tr);
}
const avg = (f: (r: (typeof results)[number]) => number) =>
  results.reduce((s, r) => s + f(r), 0) / Math.max(1, results.length);
const tr = document.createElement('tr');
tr.innerHTML = `<td><b>平均</b></td><td></td><td class="num"><b>${(avg((r) => r.mismatch) * 100).toFixed(1)}%</b></td><td class="num"><b>${avg((r) => r.mean).toFixed(1)}</b></td><td></td>`;
tbody.append(tr);
(window as unknown as { __recordCompare: unknown }).__recordCompare = {
  results,
  average: avg((r) => r.mismatch),
  averageDiff: avg((r) => r.mean),
};

// 重ねて切り替える表示
let on = false;
setInterval(() => {
  const blink = (document.getElementById('blink') as HTMLInputElement).checked;
  on = blink && !on;
  for (const b of blinkers) b.el.getContext('2d')!.putImageData(on ? b.ds : b.ours, 0, 0);
}, 500);

/**
 * 調べる用: i 番目の画面の、行（row）か列（col）n の色の並びを、DS 版とこちらで並べた文字列。
 * 開発者ツールで __recordRuns(0, 'row', 45) のように使う
 */
function runs(
  i: number,
  mode: 'row' | 'col',
  n: number,
  from = 0,
  to = mode === 'row' ? W : H,
): string {
  const b = blinkers[i];
  if (!b) return '';
  const line = (img: ImageData) => {
    const out: string[] = [];
    let prev = '',
      start = from;
    for (let k = from; k <= to; k++) {
      let c = '';
      if (k < to) {
        const o = (mode === 'row' ? n * W + k : k * W + n) * 4;
        c = [img.data[o]!, img.data[o + 1]!, img.data[o + 2]!]
          .map((v) => v.toString(16).padStart(2, '0'))
          .join('');
      }
      if (c !== prev) {
        if (prev) out.push(`${start}-${k - 1}:${prev}`);
        prev = c;
        start = k;
      }
    }
    return out.join(' ');
  };
  return `DS : ${line(b.ds)}\nOUR: ${line(b.ours)}`;
}
(window as unknown as { __recordRuns: typeof runs }).__recordRuns = runs;

/** 調べる用: i 番目の画面の一部を、DS 版（上）とこちら（下）で拡大して画面の左上に出す。__recordZoom(0, 0, 0, 128, 32) */
function zoom(i: number, x: number, y: number, w: number, h: number, s = 6): void {
  document.getElementById('record-zoom')?.remove();
  const b = blinkers[i];
  if (!b) return;
  const c = document.createElement('canvas');
  c.id = 'record-zoom';
  c.width = w * s;
  c.height = h * s * 2 + 8;
  c.style.cssText = `position:fixed;left:0;top:0;z-index:10;width:${w * s}px;height:${h * s * 2 + 8}px;background:#f0f`;
  const g = c.getContext('2d')!;
  g.imageSmoothingEnabled = false;
  g.drawImage(canvasOf(b.ds), x, y, w, h, 0, 0, w * s, h * s);
  g.drawImage(canvasOf(b.ours), x, y, w, h, 0, h * s + 8, w * s, h * s);
  c.addEventListener('click', () => c.remove());
  document.body.append(c);
}
(window as unknown as { __recordZoom: typeof zoom }).__recordZoom = zoom;
