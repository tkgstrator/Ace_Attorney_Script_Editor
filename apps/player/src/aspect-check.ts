// 画面の幅（4:3 / 16:9）の確かめ。章を決まった手順で進めて撮り（aspect-check-play.ts）、
// 4:3 の画素のハッシュを、このブラウザに保存した基準と比べる。16:9 の絵も並べて出す（見た目の確かめ用）。
import { type Assets, loadFonts } from '@gyakusai/runtime';
import { loadScenario } from '@gyakusai/script';
import { type Aspect, playShots, type Shot } from './aspect-check-play.ts';
import { CASES } from './cases.ts';
import { loadDsFont } from './ds-font.ts';
import { withOfficialAnims } from './official-anims.ts';
import { isOfficialAvailable, loadOfficialAssets } from './official-assets.ts';
import type { OfficialGame } from './official-game.ts';
import { withOfficialRecord } from './official-record.ts';
import { withOfficialStage } from './official-stage.ts';
import { withOfficialUi } from './official-ui.ts';
import { createPlaceholderAssets } from './placeholder-art.ts';

const BASELINE_KEY = 'gyakusai:aspect-check:baseline';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const params = new URLSearchParams(location.search);
const caseIds = (params.get('cases') ?? 'clocktower,ep1,ep2,aa2-ep1,aa3-ep1').split(',');
const max = Number(params.get('max') ?? 150);
const showWide = params.get('wide') !== '0';

/** 絵（DS 版の絵があればそれ、なければコードで描く仮の絵。PNG の仮の絵は使わない: 作業中に変わりうるため） */
async function assetsFor(game: OfficialGame): Promise<Assets> {
  const generated = createPlaceholderAssets();
  if (!isOfficialAvailable(game)) return generated;
  return withOfficialUi(
    await withOfficialStage(
      await withOfficialRecord(
        await withOfficialAnims(await loadOfficialAssets(generated, game), game),
        game,
      ),
      game,
    ),
  );
}

function loadBaseline(): Record<string, string> {
  try {
    return JSON.parse(localStorage.getItem(BASELINE_KEY) ?? '{}');
  } catch {
    return {};
  }
}

await loadFonts();
const fonts = await loadDsFont();
const baseline = loadBaseline();
const result: Record<string, string> = {};
const rows = $('table').querySelector('tbody')!;
const shotsBox = $('shots');
let n = 0,
  ng = 0,
  missing = 0;

const figure = (s: Shot, caption: string) => {
  const f = document.createElement('figure');
  const img = new Image();
  img.src = s.url;
  img.width = s.width / 2;
  const cap = document.createElement('figcaption');
  cap.textContent = caption;
  f.append(img, cap);
  return f;
};

for (const id of caseIds) {
  const entry = CASES.find((c) => c.id === id);
  if (!entry) continue;
  const { scenario } = loadScenario(await entry.load());
  if (!scenario) continue;
  const assets = await assetsFor(entry.game);
  // 画像は非同期に読み込まれるものがあるので、少し待ってから撮る
  await new Promise((r) => setTimeout(r, 500));
  const run = (aspect: Aspect) => playShots(scenario, assets, fonts, aspect, max);
  const narrow = run('4:3');
  const wide = showWide ? run('16:9') : [];
  narrow.forEach((s, i) => {
    const k = `${id}#${i} ${s.label}`;
    result[k] = s.hash;
    const base = baseline[k];
    const bad = base !== undefined && base !== s.hash;
    n++;
    if (bad) ng++;
    if (base === undefined) missing++;
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${n}</td><td></td><td>${s.hash}</td><td class="${bad ? 'ng' : ''}">${base ?? '（なし）'}</td>`;
    tr.children[1]!.textContent = k;
    rows.append(tr);
    const w = wide[i];
    if (bad) shotsBox.append(figure(s, `4:3（基準と違う）${k}`));
    if (w) shotsBox.append(figure(w, `16:9 ${k}`));
  });
}

$('status').innerHTML =
  ng > 0
    ? `<b class="ng">基準と違う場面が ${ng} 件</b>（全 ${n} 場面）`
    : missing === n
      ? `基準がありません（全 ${n} 場面）。「今の結果を基準として保存」を押してください`
      : `<b class="ok">4:3 は基準と同じ</b>（全 ${n} 場面、基準のない場面 ${missing}）`;
Object.assign(window, { __aspectCheck: { result, n, ng, missing } });
const save = $<HTMLButtonElement>('save');
save.disabled = false;
save.addEventListener('click', () => {
  localStorage.setItem(BASELINE_KEY, JSON.stringify(result));
  save.textContent = '保存しました';
});
const copy = $<HTMLButtonElement>('copy');
copy.disabled = false;
copy.addEventListener('click', () => void navigator.clipboard.writeText(JSON.stringify(result)));
