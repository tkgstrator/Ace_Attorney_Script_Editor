import { Engine, type Snapshot, type Value } from '@gyakusai/core';
import { createAudio, fitCanvas, loadFonts, localStorageStore, Player } from '@gyakusai/runtime';
import { formatDiagnostic, loadScenario } from '@gyakusai/script';
import { CASES, selectedCase } from './cases.ts';
import { loadDsFont } from './ds-font.ts';
import { loadImageAssets } from './image-assets.ts';
import { withOfficialAnims } from './official-anims.ts';
import { isOfficialAvailable, loadOfficialAssets } from './official-assets.ts';
import {
  defaultOfficialAudioKind,
  isOfficialAudioAvailable,
  type OfficialAudioKind,
  officialSounds,
  soundIdsToPreload,
} from './official-audio.ts';
import { withOfficialRecord } from './official-record.ts';
import { withOfficialStage } from './official-stage.ts';
import { withOfficialUi } from './official-ui.ts';
import { createPlaceholderAssets } from './placeholder-art.ts';
import { sampleSounds } from './sounds.ts';

const SAVE_KEY = 'gyakusai:player:save';
// 自動保存（進むたびに覚え、再読み込みしたらその場面から再開する。スロットは章の ID）
const AUTOSAVE_KEY = 'gyakusai:player:autosave';
const AUTOSAVE_ON_KEY = 'gyakusai:player:autosave-on';
const MARKERS_KEY = 'gyakusai:player:examineMarkers';
const VOLUME_KEY = 'gyakusai:player:volume';
const MUTE_KEY = 'gyakusai:player:mute';
const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const chosen = selectedCase();
const { scenario, diagnostics } = loadScenario(await chosen.load());

// 章の切り替え: タイトル（作品）を選ぶと、そのタイトルの章が並ぶ
const seriesSelect = $<HTMLSelectElement>('series');
const caseSelect = $<HTMLSelectElement>('case');
const seriesList = [...new Set(CASES.map((c) => c.series))];
seriesSelect.replaceChildren(...seriesList.map((s) => new Option(s, s)));
seriesSelect.value = chosen.series;
const listChapters = (series: string) =>
  caseSelect.replaceChildren(
    ...CASES.filter((c) => c.series === series).map((c) => new Option(c.chapter, c.id)),
  );
listChapters(chosen.series);
caseSelect.value = chosen.id;
const openCase = (id: string) => {
  const url = new URL(location.href);
  url.searchParams.set('case', id);
  location.href = url.href;
};
seriesSelect.addEventListener('change', () => {
  const first = CASES.find((c) => c.series === seriesSelect.value);
  if (first) openCase(first.id);
});
caseSelect.addEventListener('change', () => openCase(caseSelect.value));

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
  // 音: DS 版の音を取り出してあれば、それ（名前で指定したもの・割り当てたもの）を優先し、なければ合成した仮の音。
  // 「サウンド」で選ぶ（グラフィックとは別）: DS（原音）= ?sound=ncsf（NCSF で書き出した音）、
  // DS（互換）= ?sound=compat（自前で書き出した音）、仮の音 = ?sound=synth。
  // 指定がなければ 原音 → 互換 → 仮の音 の順に、使えるものを選ぶ。書き出していないものは選べない
  const defaultKind = defaultOfficialAudioKind(game);
  const soundParam = new URLSearchParams(location.search).get('sound');
  const audioKind: OfficialAudioKind | null =
    soundParam === 'synth'
      ? null
      : (soundParam === 'ncsf' || soundParam === 'compat') &&
          isOfficialAudioAvailable(game, soundParam)
        ? soundParam
        : defaultKind;
  const sound = $<HTMLSelectElement>('sound');
  sound.value = audioKind ?? 'synth';
  for (const kind of ['ncsf', 'compat'] as const) {
    sound.querySelector<HTMLOptionElement>(`option[value="${kind}"]`)!.disabled =
      !isOfficialAudioAvailable(game, kind);
  }
  sound.addEventListener('change', () => {
    const url = new URL(location.href);
    if (sound.value === (defaultKind ?? 'synth')) url.searchParams.delete('sound');
    else url.searchParams.set('sound', sound.value);
    location.href = url.href;
  });
  const audio = createAudio(
    audioKind ? officialSounds(sampleSounds(), game, audioKind) : sampleSounds(),
  );
  // 音量とミュート（このブラウザに覚えておく）
  const volume = $<HTMLInputElement>('volume');
  const mute = $<HTMLInputElement>('mute');
  volume.value = String(loadNumber(VOLUME_KEY, 100));
  mute.checked = loadFlag(MUTE_KEY, false);
  audio.setVolume?.(Number(volume.value) / 100);
  audio.setMuted?.(mute.checked);
  volume.addEventListener('input', () => {
    audio.setVolume?.(Number(volume.value) / 100);
    saveNumber(VOLUME_KEY, Number(volume.value));
  });
  mute.addEventListener('change', () => {
    audio.setMuted?.(mute.checked);
    saveFlag(MUTE_KEY, mute.checked);
    canvas.focus({ preventScroll: true });
  });
  // 効果音は先に読み込んでおく（初めて鳴らすときに遅れないように。待たずに進める）
  void audio.preload?.(
    audioKind
      ? soundIdsToPreload(game, audioKind)
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
  // 画面の幅（?aspect=16:9 で 16:9。既定は 4:3）
  const aspect = new URLSearchParams(location.search).get('aspect') === '16:9' ? '16:9' : '4:3';
  const aspectSelect = $<HTMLSelectElement>('aspect');
  aspectSelect.value = aspect;
  aspectSelect.addEventListener('change', () => {
    const url = new URL(location.href);
    if (aspectSelect.value === '16:9') url.searchParams.set('aspect', '16:9');
    else url.searchParams.delete('aspect');
    location.href = url.href;
  });
  const player = new Player({
    canvas,
    engine,
    assets,
    aspect,
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

  // 自動保存: 状態が変わるたびに（まとめて 300ms 後に）覚える。切り替えはこのブラウザに覚えておく
  const autoStore = localStorageStore(AUTOSAVE_KEY);
  const autosave = $<HTMLInputElement>('autosave');
  autosave.checked = loadFlag(AUTOSAVE_ON_KEY, true);
  let autosaveTimer: ReturnType<typeof setTimeout> | undefined;
  const scheduleAutosave = () => {
    if (!autosave.checked) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => {
      void autoStore.save(chosen.id, engine.snapshot()).catch(() => {});
    }, 300);
  };
  autosave.addEventListener('change', () => {
    saveFlag(AUTOSAVE_ON_KEY, autosave.checked);
    if (autosave.checked) scheduleAutosave();
    else void autoStore.remove(chosen.id);
    canvas.focus({ preventScroll: true });
  });

  const start = (snapshot?: Snapshot) => {
    unsubscribe();
    engine = new Engine(scenario, snapshot);
    player.setEngine(engine);
    unsubscribe = engine.subscribe(() => {
      renderDebug();
      scheduleAutosave();
    });
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
  // 最初から: オートセーブも消す（再読み込みしても最初から）
  $('restart').addEventListener('click', () => {
    clearTimeout(autosaveTimer);
    void autoStore.remove(chosen.id).then(() => {
      start();
      message('最初から始めました');
    });
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

  // 自動保存があれば、その場面から再開する（シナリオを書き換えて合わなくなったら最初から）
  const resumed = autosave.checked ? await autoStore.load(chosen.id).catch(() => null) : null;
  try {
    start(resumed ?? undefined);
    if (resumed) message('オートセーブした場面から再開しました');
  } catch {
    start();
    message('オートセーブがこの章と合わないため、最初から始めました');
  }
}

function el(tag: string, text: string) {
  const e = document.createElement(tag);
  e.textContent = text;
  return e;
}

function loadFlag(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === 'on';
  } catch {
    return fallback;
  }
}

function saveFlag(key: string, on: boolean) {
  try {
    localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    /* 覚えられなくてもよい */
  }
}

function loadNumber(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return localStorage.getItem(key) === null || Number.isNaN(v) ? fallback : v;
  } catch {
    return fallback;
  }
}

function saveNumber(key: string, value: number) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* 覚えられなくてもよい */
  }
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
