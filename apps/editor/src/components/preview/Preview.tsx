// 右: プレビュー。編集中の YAML をコンパイルした結果の診断と、実際に遊べる画面と、整合性チェック。
// 「ゲーム」「整合性チェック」「診断」はそれぞれ隠せる。どれも、どの版（編集の version）の内容かを持ち、
// 今の編集より古ければそう書く。章を切り替えたら作り直す（App で key に章の名前を渡す）
// 再読み込みでは、遊んでいた状態（セーブデータと同じもの）を新しい内容に持ち込み、同じ場面の続きから遊ぶ
import { type CompiledScenario, Engine, type RestoreResult, restoreEngine } from '@gyakusai/core';
import { fitCanvas, loadFonts, Player } from '@gyakusai/runtime';
import { memo, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { getAssets, getAudio, getDsFont } from '@/preview/assets.ts';
import type { Compiled } from '@/preview/use-compile.ts';
import { Diagnostics } from './Diagnostics.tsx';
import { PlayControls, type Restart } from './PlayControls.tsx';
import { usePanels } from './panels.ts';
import { VerifyPanel } from './VerifyPanel.tsx';

export interface PlayRequest {
  scene: string | null;
  serial: number;
}

interface Props {
  /** この章の最後のコンパイル結果 */
  compiled: Compiled | null;
  /** 今の編集の版 */
  version: number;
  play: PlayRequest;
  compiling: boolean;
  /** 今の内容でコンパイルし直す（変わっていなければ前の結果） */
  onCompile: () => Promise<Compiled | null>;
  /** 大きな章（自動のコンパイル・整合性チェックはしない） */
  large: boolean;
}

interface Good {
  scenario: CompiledScenario;
  version: number;
}

/** 入力のたびには描き直さない（コンパイルの結果か、版が変わったときだけ） */
export const Preview = memo(function Preview({
  compiled,
  version,
  play,
  compiling,
  onCompile,
  large,
}: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const [ready, setReady] = useState(false);
  const [auto, setAuto] = useState(false);
  const [from, setFrom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** 再読み込みで何が起きたか（続きから・シーンの始めから・最初から） */
  const [notice, setNotice] = useState<{ text: string; warn: boolean; detail: string[] } | null>(
    null,
  );
  /** ゲームで動いている内容の版 */
  const [playing, setPlaying] = useState<number | null>(null);
  const [panels, toggle] = usePanels();
  const result = compiled?.result ?? null;
  const scenario = result?.scenario ?? null;
  // 最後に正しくコンパイルできたもの（エラーの間も遊べるように）
  const lastGood = useRef<Good | null>(null);
  if (scenario && compiled) lastGood.current = { scenario, version: compiled.version };

  /** エンジンを作り直して、how のとおりに始める（続きから・最初から・シーンの頭から） */
  const restart = (g: Good | null, how: Restart) => {
    const p = player.current;
    if (!p || !g) return;
    try {
      if (how.kind === 'continue' || how.kind === 'jump') {
        const prev = { scenario: p.engine.scenario, state: p.engine.state };
        const r = restoreEngine(g.scenario, prev, how.kind === 'jump' ? { scene: how.scene } : {});
        p.setEngine(r.engine);
        setNotice(describe(how, r.result, r.scene, r.notes));
      } else {
        const engine = new Engine(g.scenario);
        if (how.kind === 'scene') {
          if (!g.scenario.scenes[how.scene])
            throw new Error(`シーン「${how.scene}」はコンパイル結果にありません`);
          engine.jumpTo(how.scene);
        }
        p.setEngine(engine);
        setNotice(null);
      }
      setPlaying(g.version);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const restartRef = useRef(restart);
  restartRef.current = restart;

  // Player は、最初に正しくコンパイルできたときに 1 回だけ作る
  const hasGood = lastGood.current !== null;
  useEffect(() => {
    if (!hasGood) return;
    let alive = true;
    let stopFit = () => {};
    void (async () => {
      try {
        await loadFonts();
      } catch (e) {
        console.error('フォントを読み込めませんでした', e);
      }
      const [assets, fonts] = await Promise.all([getAssets(), getDsFont()]);
      const g = lastGood.current;
      if (!alive || !canvas.current || !stage.current || !g) return;
      stopFit = fitCanvas(canvas.current, stage.current, 0.5);
      player.current = new Player({
        canvas: canvas.current,
        engine: new Engine(g.scenario),
        assets,
        audio: getAudio(),
        ...fonts,
        onRestart: () => restartRef.current(lastGood.current, { kind: 'start' }),
      });
      setPlaying(g.version);
      setReady(true);
    })();
    return () => {
      alive = false;
      stopFit();
      player.current?.destroy();
      player.current = null;
    };
  }, [hasGood]);

  // コンパイルし直したら（自動再読み込みがオンなら）、遊んでいた場面の続きから作り直す
  // biome-ignore lint/correctness/useExhaustiveDependencies: 新しい結果が来たときだけ
  useEffect(() => {
    if (ready && auto && scenario) restartRef.current(lastGood.current, { kind: 'continue' });
  }, [scenario, ready]);

  /** 今の内容でコンパイルし直して、how のとおりに遊ぶ */
  const reload = async (how: Restart) => {
    if (how.kind === 'start') setFrom(null);
    await onCompile();
    restartRef.current(lastGood.current, how);
    canvas.current?.focus({ preventScroll: true });
  };

  // 「ここから再生」
  // biome-ignore lint/correctness/useExhaustiveDependencies: 頼まれたときだけ
  useEffect(() => {
    if (play.serial === 0) return;
    setFrom(play.scene);
    restartRef.current(
      lastGood.current,
      play.scene ? { kind: 'scene', scene: play.scene } : { kind: 'start' },
    );
    canvas.current?.focus({ preventScroll: true });
  }, [play.serial]);

  const compileStale = compiled !== null && compiled.version !== version;
  const playStale = playing !== null && playing !== version;

  return (
    <div className="flex h-full flex-col">
      <div
        className="flex items-center gap-1 border-b px-3 py-1.5 text-xs"
        role="toolbar"
        aria-label="表示する欄"
      >
        <span className="mr-1 text-muted-foreground">表示:</span>
        {(
          [
            ['game', 'ゲーム'],
            ['verify', '整合性チェック'],
            ['diagnostics', '診断'],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            aria-pressed={panels[k]}
            onClick={() => toggle(k)}
            className={cn(
              'rounded-full border px-2 py-0.5',
              panels[k]
                ? 'border-primary bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent',
            )}
          >
            {label}
          </button>
        ))}
      </div>
      <section
        className={cn('space-y-2 border-b p-3', !panels.game && 'hidden')}
        aria-label="ゲーム"
      >
        <div ref={stage} className="flex justify-center rounded-md bg-black">
          <canvas
            ref={canvas}
            tabIndex={0}
            className="outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2"
            aria-label="プレビュー画面（クリックか Enter で進む）"
          />
        </div>
        {!lastGood.current && (
          <p className="text-xs text-muted-foreground">コンパイルに成功すると、ここで遊べます。</p>
        )}
        <PlayControls
          compiling={compiling}
          stale={playStale}
          from={from}
          scenes={Object.keys(lastGood.current?.scenario.scenes ?? {})}
          auto={auto}
          onAuto={setAuto}
          large={large}
          onReload={(how) => void reload(how)}
        />
        {notice && (
          <p
            className={cn('text-[11px]', notice.warn ? 'text-amber-700' : 'text-muted-foreground')}
            role="status"
            title={notice.detail.join('\n') || undefined}
          >
            {notice.text}
            {notice.detail.length > 0 && `（${notice.detail.length} 件の補正）`}
          </p>
        )}
        {playStale && (
          <p className="text-[11px] text-amber-700" role="status">
            ゲームは最後の編集より前の内容です（「再読み込み」で今の内容にします）
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <p className="text-[11px] text-muted-foreground">
          クリック/Enter で進む・X で法廷記録・尋問中 ←→ Z。画面をクリックしてから操作してください。
        </p>
      </section>
      {panels.verify && (
        <VerifyPanel compiled={compiled} version={version} large={large} onCompile={onCompile} />
      )}
      {panels.diagnostics && (
        <Diagnostics
          diagnostics={result?.diagnostics ?? []}
          pending={result === null}
          stale={compileStale}
        />
      )}
      {compileStale && compiling && (
        <p className="px-3 pb-2 text-[11px] text-muted-foreground">コンパイルしています…</p>
      )}
    </div>
  );
});

/** 再読み込みの結果を、短い知らせにする（直したデータなどは detail に。ツールチップで見せる） */
function describe(how: Restart, result: RestoreResult, scene: string, notes: string[]) {
  if (result === 'same' || result === 'moved') {
    const fixed = result === 'moved' ? '（編集に合わせて位置を直しました）' : '';
    return { text: `シーン「${scene}」の続きから遊んでいます${fixed}`, warn: false, detail: notes };
  }
  if (result === 'sceneStart' && how.kind === 'jump')
    return { text: `状態を保って、シーン「${scene}」の頭へ移りました`, warn: false, detail: notes };
  // 続けられなかった理由は notes の最後にある
  return {
    text: notes.at(-1) ?? '最初から始めました',
    warn: true,
    detail: notes.slice(0, -1),
  };
}
