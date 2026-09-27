// 右: プレビュー。編集中の YAML をコンパイルした結果の診断と、実際に遊べる画面
import { Engine, type CompiledScenario } from '@gyakusai/core';
import { Player, fitCanvas, loadFonts } from '@gyakusai/runtime';
import type { CompileResult, Diagnostic } from '@gyakusai/script';
import { AlertTriangle, CircleX, Loader2, Play, RefreshCw, RotateCcw } from 'lucide-react';
import { memo, useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { selectionFromPath } from '@/model/paths.ts';
import { getAssets, getAudio, getDsFont } from '@/preview/assets.ts';
import { useActions } from '@/state/editor-store.tsx';
import { VerifyPanel } from './VerifyPanel.tsx';

export interface PlayRequest {
  scene: string | null;
  serial: number;
}

interface Props {
  result: CompileResult | null;
  source: string | null;
  play: PlayRequest;
  /** result の後に編集されている */
  stale: boolean;
  compiling: boolean;
  /** 今の内容でコンパイルし直す（変わっていなければ前の結果） */
  onReload: () => Promise<CompileResult | null>;
  /** 大きな章（自動のコンパイル・整合性チェックはしない） */
  large: boolean;
}

/** 入力のたびには描き直さない（コンパイルの結果か、古くなったかどうかが変わったときだけ） */
export const Preview = memo(function Preview({ result, source, play, stale, compiling, onReload, large }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const stage = useRef<HTMLDivElement>(null);
  const player = useRef<Player | null>(null);
  const [ready, setReady] = useState(false);
  const [auto, setAuto] = useState(false);
  const [from, setFrom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const scenario = result?.scenario ?? null;
  // 最後に正しくコンパイルできたもの（エラーの間も遊べるように）
  const lastGood = useRef<CompiledScenario | null>(null);
  if (scenario) lastGood.current = scenario;

  /** エンジンを作り直して、指定のシーン（なければ最初）から始める */
  const restart = (sc: CompiledScenario | null, scene: string | null) => {
    const p = player.current;
    if (!p || !sc) return;
    try {
      const engine = new Engine(sc);
      if (scene) {
        if (!sc.scenes[scene]) throw new Error(`シーン「${scene}」はコンパイル結果にありません`);
        engine.jumpTo(scene);
      }
      p.setEngine(engine);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  // Player は 1 回だけ作る
  useEffect(() => {
    let alive = true;
    let stopFit = () => {};
    void (async () => {
      try { await loadFonts(); } catch (e) { console.error('フォントを読み込めませんでした', e); }
      const [assets, fonts] = await Promise.all([getAssets(), getDsFont()]);
      const sc = lastGood.current;
      if (!alive || !canvas.current || !stage.current || !sc) return;
      stopFit = fitCanvas(canvas.current, stage.current, 0.5);
      player.current = new Player({
        canvas: canvas.current, engine: new Engine(sc), assets, audio: getAudio(), ...fonts,
        onRestart: () => restart(lastGood.current, null),
      });
      setReady(true);
    })();
    return () => { alive = false; stopFit(); player.current?.destroy(); player.current = null; };
  }, [lastGood.current === null]);

  // コンパイルし直したら（自動再読み込みがオンなら）作り直す
  useEffect(() => {
    if (ready && auto && scenario) restart(scenario, from);
  }, [scenario, ready]);

  /** 今の内容でコンパイルし直して、scene から（null なら最初から）遊ぶ */
  const reload = async (scene: string | null) => {
    const r = await onReload();
    restart(r?.scenario ?? lastGood.current, scene);
  };

  // 「ここから再生」
  useEffect(() => {
    if (play.serial === 0) return;
    setFrom(play.scene);
    restart(lastGood.current, play.scene);
    canvas.current?.focus({ preventScroll: true });
  }, [play.serial]);

  return (
    <div className="flex h-full flex-col">
      <div className="space-y-2 border-b p-3">
        <div ref={stage} className="flex justify-center rounded-md bg-black">
          <canvas ref={canvas} tabIndex={0} className="outline-none" aria-label="プレビュー画面" />
        </div>
        {!scenario && !lastGood.current && <p className="text-xs text-muted-foreground">コンパイルに成功すると、ここで遊べます。</p>}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm" variant={stale ? 'default' : 'outline'} className="h-7 text-xs" disabled={compiling}
            onClick={() => void reload(from)} title="今の内容でコンパイルし直して、プレビューを作り直します"
          >
            {compiling ? <Loader2 className="animate-spin" /> : <RefreshCw />} 再読み込み
          </Button>
          <Button size="sm" variant="outline" className="h-7 text-xs" disabled={compiling} onClick={() => { setFrom(null); void reload(null); }}>
            <RotateCcw /> 最初から
          </Button>
          {from && (
            <Button size="sm" variant="outline" className="h-7 text-xs" disabled={compiling} onClick={() => void reload(from)}>
              <Play /> {from} から
            </Button>
          )}
          <label className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground" title={large ? '大きな章では、コンパイルは「再読み込み」を押したときだけ行います' : undefined}>
            <Switch checked={auto} onCheckedChange={setAuto} /> {large ? 'コンパイルしたら作り直す' : '編集したら再読み込み'}
          </label>
        </div>
        {stale && (
          <p className="text-[11px] text-amber-600">
            {compiling ? 'コンパイルしています…' : 'プレビューと診断は、最後の編集より前の内容です（「再読み込み」で更新）'}
          </p>
        )}
        {error && <p className="text-xs text-destructive">{error}</p>}
        <p className="text-[11px] text-muted-foreground">クリック/Enter で進む・X で法廷記録・尋問中 ←→ Z。画面をクリックしてから操作してください。</p>
      </div>
      <VerifyPanel source={source} large={large} />
      <Diagnostics diagnostics={result?.diagnostics ?? []} pending={result === null} />
    </div>
  );
});

function Diagnostics({ diagnostics, pending }: { diagnostics: Diagnostic[]; pending: boolean }) {
  const { select } = useActions();
  const errors = diagnostics.filter(d => d.severity === 'error').length;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold">
        診断
        {pending ? <span className="font-normal text-muted-foreground">コンパイル中…</span>
          : diagnostics.length === 0 ? <span className="font-normal text-emerald-600">問題はありません</span>
          : <span className="font-normal text-muted-foreground">エラー {errors}・警告 {diagnostics.length - errors}</span>}
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {diagnostics.map((d, i) => {
          const target = selectionFromPath(d.path);
          const Icon = d.severity === 'error' ? CircleX : AlertTriangle;
          return (
            <li key={i}>
              <button
                type="button" disabled={!target}
                onClick={() => target && select(target.selection, target.focus)}
                className={cn('flex w-full items-start gap-1.5 rounded-md p-1.5 text-left text-xs hover:bg-accent disabled:cursor-default',
                  d.severity === 'error' ? 'text-destructive' : 'text-amber-700')}
              >
                <Icon className="mt-0.5 size-3.5 shrink-0" />
                <span className="min-w-0">
                  <span className="block">{d.message}</span>
                  <span className="block font-mono text-[10px] text-muted-foreground">
                    {d.line !== undefined ? `${d.line}:${d.column} ` : ''}{d.path.join('.')}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
