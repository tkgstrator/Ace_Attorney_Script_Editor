// 整合性チェック（詰み・到達しないシーンなど）。Web Worker で verifyScenario を動かし、結果を一覧にする
import type { VerifyResult } from '@gyakusai/script';
import { AlertTriangle, CircleX, Loader2, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { selectionForNodeIn } from '@/model/paths.ts';
import type { Compiled } from '@/preview/use-compile.ts';
import type { VerifyRequest, VerifyResponse } from '@/preview/verify.worker.ts';
import { useActions, useEditorState } from '@/state/editor-store.tsx';

/** 自動チェックは、コンパイルが通ってからこれだけ待つ */
const AUTO_DELAY = 1500;

/** version: チェックした内容の版（編集の version） */
type State =
  | { kind: 'idle' }
  | { kind: 'compiling' }
  | { kind: 'running'; version: number; progress?: number }
  | { kind: 'done'; version: number; result: VerifyResult; ms: number }
  | { kind: 'error'; version: number | null; error: string };

export function VerifyPanel({
  compiled,
  version,
  large,
  onCompile,
}: {
  /** 最後のコンパイル結果（自動のチェックに使う） */
  compiled: Compiled | null;
  /** 今の編集の版 */
  version: number;
  large: boolean;
  /** 今の内容でコンパイルする（「チェック」を押したとき、まずこれで最新にする） */
  onCompile: () => Promise<Compiled | null>;
}) {
  const parts = useEditorState((s) => s.tree);
  const { select } = useActions();
  const worker = useRef<Worker | null>(null);
  const serial = useRef(0);
  const [auto, setAuto] = useState(false);
  const [state, setState] = useState<State>({ kind: 'idle' });
  const autoId = useId();

  const stop = useCallback(() => {
    worker.current?.terminate();
    worker.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const run = (text: string, v: number) => {
    // 前のチェックが終わっていなければ止めて、やり直す
    stop();
    const w = new Worker(new URL('../../preview/verify.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.current = w;
    const id = ++serial.current;
    w.onmessage = (e: MessageEvent<VerifyResponse>) => {
      if (e.data.id !== serial.current) return;
      const r = e.data;
      if ('progress' in r) {
        setState({ kind: 'running', version: v, progress: r.progress });
        return;
      }
      setState(
        r.ok
          ? { kind: 'done', version: v, result: r.result, ms: r.ms }
          : { kind: 'error', version: v, error: r.error },
      );
      stop();
    };
    w.onerror = (e) => {
      setState({ kind: 'error', version: v, error: e.message || 'チェック中にエラーが起きました' });
      stop();
    };
    setState({ kind: 'running', version: v });
    w.postMessage({ id, text } satisfies VerifyRequest);
  };
  const runRef = useRef(run);
  runRef.current = run;

  /** 「チェック」: 今の編集の内容をコンパイルしてから調べる */
  const checkNow = async () => {
    stop();
    setState({ kind: 'compiling' });
    const c = await onCompile();
    if (!c) {
      setState({ kind: 'error', version: null, error: 'コンパイルできませんでした' });
      return;
    }
    if (!c.result.scenario) {
      setState({
        kind: 'error',
        version: c.version,
        error: 'コンパイルエラーがあるため、チェックできません（診断を見てください）',
      });
      return;
    }
    runRef.current(c.text, c.version);
  };

  // 自動: コンパイルが通った内容が変わったら、しばらく待ってから調べる
  const good = compiled?.result.scenario ? compiled : null;
  const checked = 'version' in state ? state.version : null;
  useEffect(() => {
    if (!auto || large || !good || checked === good.version) return;
    const t = setTimeout(() => runRef.current(good.text, good.version), AUTO_DELAY);
    return () => clearTimeout(t);
  }, [auto, large, good, checked]);

  const busy = state.kind === 'running' || state.kind === 'compiling';
  const stale = !busy && checked !== null && checked !== version;
  const findings = state.kind === 'done' ? state.result.findings : [];
  const errors = findings.filter((f) => f.severity === 'error').length;

  return (
    <section className="border-b px-3 py-2" aria-label="整合性チェック">
      <div className="flex items-center gap-2 text-xs font-semibold">
        整合性チェック
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[11px]"
          disabled={busy}
          onClick={() => void checkNow()}
          title="今の編集の内容をコンパイルし、すべての遊び方を試して、詰みや到達しない場所を探します"
        >
          {busy ? <Loader2 className="animate-spin" /> : <ShieldCheck />} チェック
        </Button>
        {busy && (
          <Button
            size="sm"
            variant="ghost"
            className="h-6 px-2 text-[11px]"
            onClick={() => {
              stop();
              setState({ kind: 'idle' });
            }}
          >
            中止
          </Button>
        )}
        <span
          className="ml-auto flex items-center gap-1.5 font-normal text-muted-foreground"
          title={large ? '大きな章では時間がかかるので、チェックボタンで行ってください' : undefined}
        >
          <Switch id={autoId} checked={auto && !large} disabled={large} onCheckedChange={setAuto} />
          <label htmlFor={autoId}>自動</label>
        </span>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground" role="status">
        {state.kind === 'idle' && '未チェック（「チェック」で今の内容を調べます）'}
        {state.kind === 'compiling' && 'コンパイルしています…'}
        {state.kind === 'running' &&
          `調べています…${state.progress ? `（${state.progress.toLocaleString()} 件）` : ''}`}
        {state.kind === 'error' && <span className="text-destructive">{state.error}</span>}
        {state.kind === 'done' && (
          <>
            調べた状態 {state.result.states.toLocaleString()} 件・{(state.ms / 1000).toFixed(2)} 秒
            {state.result.truncated && (
              <span className="text-amber-600">
                ・状態が多すぎて途中で打ち切りました（結果は一部です）
              </span>
            )}
            {findings.length === 0 && (
              <span className="text-emerald-600">・問題は見つかりませんでした</span>
            )}
            {findings.length > 0 && `・エラー ${errors}・警告 ${findings.length - errors}`}
          </>
        )}
        {stale && (
          <span className="text-amber-700">
            （チェックした後に編集があります。結果は前の内容のものです）
          </span>
        )}
      </div>
      {findings.length > 0 && (
        <ul className={cn('mt-1 max-h-48 space-y-0.5 overflow-y-auto', stale && 'opacity-60')}>
          {findings.map((f) => {
            const target = f.scene ? selectionForNodeIn(parts, f.scene) : null;
            const Icon = f.severity === 'error' ? CircleX : AlertTriangle;
            return (
              <li key={`${f.scene ?? ''}\u0000${f.message}`}>
                <button
                  type="button"
                  disabled={!target}
                  onClick={() => target && select(target)}
                  className={cn(
                    'flex w-full items-start gap-1.5 rounded-md p-1 text-left text-xs hover:bg-accent disabled:cursor-default',
                    f.severity === 'error' ? 'text-destructive' : 'text-amber-800',
                  )}
                >
                  <Icon className="mt-0.5 size-3.5 shrink-0" />
                  <span className="min-w-0">
                    {f.message}
                    {f.scene && (
                      <span className="ml-1 font-mono text-[10px] text-muted-foreground">
                        {f.scene}
                      </span>
                    )}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
