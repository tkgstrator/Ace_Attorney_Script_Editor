import { Engine, type Snapshot, type Value } from '@gyakusai/core';
import {
  createAudio,
  downloadSnapshot,
  fitCanvas,
  loadFonts,
  localStorageStore,
  Player,
  pickSnapshotFile,
} from '@gyakusai/runtime';
import { formatDiagnostic, loadScenario } from '@gyakusai/script';
import { CASES, selectedCase } from './cases.ts';
import { loadDsFont } from './ds-font.ts';
import { loadImageAssets } from './image-assets.ts';
import { withOfficialAnims } from './official-anims.ts';
import { isOfficialAvailable, loadOfficialAssets } from './official-assets.ts';
import { isOfficialAudioAvailable, officialSounds, soundIdsToPreload } from './official-audio.ts';
import { withOfficialRecord } from './official-record.ts';
import { withOfficialStage } from './official-stage.ts';
import { withOfficialUi } from './official-ui.ts';
import { createPlaceholderAssets } from './placeholder-art.ts';
import { sampleSounds } from './sounds.ts';

const SAVE_KEY = 'gyakusai:player:save';
const MARKERS_KEY = 'gyakusai:player:examineMarkers';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const chosen = selectedCase();
const { scenario, diagnostics } = loadScenario(await chosen.load());

// 章の切り替え
const caseSelect = $<HTMLSelectElement>('case');
caseSelect.replaceChildren(...CASES.map((c) => new Option(c.label, c.id)));
caseSelect.value = chosen.id;
caseSelect.addEventListener('change', () => {
  const url = new URL(location.href);
  url.searchParams.set('case', caseSelect.value);
  location.href = url.href;
});

// 診断（エラー・警告）があれば画面下に出す
if (diagnostics.length > 0) {
  const box = $('diagnostics');
  box.hidden = false;
  box.replaceChildren(
    ...diagnostics.map((d) => {
      const line = document.createElement('div');
      line.className = d.severity;
      line.textContent = formatDiagnostic(d, `${chosen.id}.yaml`);
      return line;
    }),
  );
}

if (scenario) {
  document.title = `${scenario.title} | 逆裁`;
  $('title').textContent = scenario.title;

  const canvas = $<HTMLCanvasElement>('screen');
  fitCanvas(canvas, $('stage'));
  try {
    await loadFonts();
  } catch (e) {
    console.error('フォントを読み込めませんでした', e);
  }

  let engine = new Engine(scenario);
  // 絵の切り替え。ROM から取り出した DS 版の絵（手元用）があれば、それを使う。?art=generated で生成したドット絵。
  // 逆転裁判2・3 から変換した章は、そのゲームの絵と音（chosen.game）
  const game = chosen.game;
  const official =
    new URLSearchParams(location.search).get('art') !== 'generated' && isOfficialAvailable(game);
  const generated = await loadImageAssets(createPlaceholderAssets());
  const assets = official
    ? await withOfficialUi(
        await withOfficialStage(
          await withOfficialRecord(
            await withOfficialAnims(await loadOfficialAssets(generated, game), game),
            game,
          ),
          game,
        ),
      )
    : generated;
  const art = $<HTMLSelectElement>('art');
  art.value = official ? 'official' : 'generated';
  art.querySelector<HTMLOptionElement>('option[value="official"]')!.disabled =
    !isOfficialAvailable(game);
  art.addEventListener('change', () => {
    const url = new URL(location.href);
    if (art.value === 'generated') url.searchParams.set('art', 'generated');
    else url.searchParams.delete('art');
    location.href = url.href;
  });
  const fonts = await loadDsFont();
  // 音: DS 版の音を取り出してあれば、それ（名前で指定したもの・割り当てたもの）を優先し、なければ合成した仮の音
  const officialAudio = official && isOfficialAudioAvailable(game);
  const audio = createAudio(officialAudio ? officialSounds(sampleSounds(), game) : sampleSounds());
  // 効果音は先に読み込んでおく（初めて鳴らすときに遅れないように。待たずに進める）
  void audio.preload?.(
    officialAudio
      ? soundIdsToPreload(game)
      : [
          'blip_male',
          'blip_female',
          'blip_typewriter',
          'ui_page',
          'ui_select',
          'ui_decide',
          'damage',
        ],
  );
  const player = new Player({
    canvas,
    engine,
    assets,
    audio,
    ...fonts,
    onRestart: () => start(),
  });
  // 「調べる」の目印（元のゲームにはない手助け）。切り替えはこのブラウザに覚えておく
  const markers = $<HTMLInputElement>('markers');
  markers.checked = loadMarkers();
  player.examineMarkers = markers.checked;
  markers.addEventListener('change', () => {
    player.examineMarkers = markers.checked;
    saveMarkers(markers.checked);
    canvas.focus({ preventScroll: true });
  });
  let unsubscribe = () => {};

  const start = (snapshot?: Snapshot) => {
    unsubscribe();
    engine = new Engine(scenario, snapshot);
    player.setEngine(engine);
    unsubscribe = engine.subscribe(renderDebug);
    renderDebug();
    canvas.focus({ preventScroll: true });
  };

  // ---- デバッグパネル ----
  const message = (text: string) => {
    $('message').textContent = text;
  };

  const jump = $<HTMLSelectElement>('jump');
  jump.replaceChildren(
    new Option('（選択）', ''),
    ...Object.keys(scenario.scenes).map((id) => new Option(id, id)),
  );
  jump.addEventListener('change', () => {
    if (!jump.value) return;
    engine.jumpTo(jump.value);
    message(`シーン「${jump.value}」へ移動しました`);
    jump.value = '';
    canvas.focus({ preventScroll: true });
  });
  $('restart').addEventListener('click', () => {
    start();
    message('最初から始めました');
  });
  // セーブデータ: 保存先は SaveStore で差し替えられる（Web では localStorage。スロットは章の ID）
  const store = localStorageStore(SAVE_KEY);
  const fail = (what: string) => (e: unknown) =>
    message(`${what}できませんでした: ${(e as Error).message}`);
  $('save').addEventListener('click', () => {
    store.save(chosen.id, engine.snapshot()).then(() => message('セーブしました'), fail('セーブ'));
  });
  $('load').addEventListener('click', () => {
    store.load(chosen.id).then((data) => {
      if (!data) {
        message('セーブデータがありません');
        return;
      }
      start(data);
      message('ロードしました');
    }, fail('ロード'));
  });
  $('export').addEventListener('click', () => {
    downloadSnapshot(engine.snapshot());
    message('セーブデータを書き出しました');
  });
  $('import').addEventListener('click', () => {
    pickSnapshotFile(scenario!.id).then((data) => {
      if (!data) return;
      start(data);
      message('セーブデータを読み込みました');
    }, fail('読み込み'));
  });

  function renderDebug() {
    const s = engine.state;
    const phase =
      s.mode === 'testimony'
        ? {
            intro: '証言開始',
            reading: '証言',
            crossIntro: '尋問開始',
            cross: '尋問',
          }[s.phase]
        : s.mode === 'investigate'
          ? '探偵メニュー'
          : `命令 ${s.pc}`;
    const rows: [string, string][] = [
      ['シーン', s.scene],
      ['状態', phase],
      ['ライフ', `${s.life} / ${scenario!.maxLife}`],
      ['表示中', s.stage.character ?? '—'],
      ['訪問済み', s.visited.join(', ')],
    ];
    $('where').replaceChildren(...rows.flatMap(([k, v]) => [el('dt', k), el('dd', v)]));

    const flags = $('flags');
    const focused = document.activeElement?.closest('#flags');
    if (!focused)
      flags.replaceChildren(
        ...Object.entries(s.flags).flatMap(([k, v]) => [el('dt', k), flagEditor(k, v)]),
      );

    $('evidence').replaceChildren(
      ...s.evidence.map((id) => el('li', scenario!.evidence[id]?.name ?? id)),
    );
  }

  // フラグはその場で書き換えられる（分岐の確認用）
  function flagEditor(name: string, value: Value): HTMLElement {
    const dd = el('dd', '');
    const input = document.createElement('input');
    input.setAttribute('aria-label', `フラグ ${name}`);
    if (typeof value === 'boolean') {
      input.type = 'checkbox';
      input.checked = value;
      input.addEventListener('change', () => engine.setFlag(name, input.checked));
    } else {
      input.type = typeof value === 'number' ? 'number' : 'text';
      input.value = String(value);
      input.addEventListener('change', () =>
        engine.setFlag(name, typeof value === 'number' ? Number(input.value) : input.value),
      );
    }
    dd.append(input);
    return dd;
  }

  start();
}

function el(tag: string, text: string) {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}

function loadMarkers(): boolean {
  try {
    return localStorage.getItem(MARKERS_KEY) !== 'off';
  } catch {
    return true;
  }
}

function saveMarkers(on: boolean) {
  try {
    localStorage.setItem(MARKERS_KEY, on ? 'on' : 'off');
  } catch {
    /* 覚えられなくてもよい */
  }
}
