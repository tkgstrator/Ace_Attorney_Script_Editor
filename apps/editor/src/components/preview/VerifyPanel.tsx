// 整合性チェック（詰み・到達しないシーンなど）。Web Worker で verifyScenario を動かし、結果を一覧にする
import type { VerifyResult } from '@gyakusai/script';
import { AlertTriangle, CircleX, Loader2, ShieldCheck } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';
import { selectionForNodeIn } from '@/model/paths.ts';
import type { VerifyRequest, VerifyResponse } from '@/preview/verify.worker.ts';
import { useActions, useEditorState } from '@/state/editor-store.tsx';

/** 自動チェックは、コンパイルが通ってからこれだけ待つ */
const AUTO_DELAY = 1500;

type State =
  | { kind: 'idle' }
  | { kind: 'running'; text: string; progress?: number }
  | { kind: 'done'; text: string; result: VerifyResult; ms: number }
  | { kind: 'error'; text: string; error: string };

export function VerifyPanel({ source, large }: { source: string | null; large: boolean }) {
  const parts = useEditorState((s) => s.tree);
  const { select } = useActions();
  const worker = useRef<Worker | null>(null);
  const serial = useRef(0);
  const [auto, setAuto] = useState(false);
  const [state, setState] = useState<State>({ kind: 'idle' });

  const stop = () => {
    worker.current?.terminate();
    worker.current = null;
  };
  useEffect(() => stop, []);

  const run = (text: string) => {
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
        setState({ kind: 'running', text, progress: r.progress });
        return;
      }
      setState(
        r.ok
          ? { kind: 'done', text, result: r.result, ms: r.ms }
          : { kind: 'error', text, error: r.error },
      );
      stop();
    };
    w.onerror = (e) => {
      setState({ kind: 'error', text, error: e.message || 'チェック中にエラーが起きました' });
      stop();
    };
    setState({ kind: 'running', text });
    w.postMessage({ id, text } satisfies VerifyRequest);
  };

  // 自動: コンパイルが通った内容が変わったら、しばらく待ってから調べる
  useEffect(() => {
    if (!auto || large || !source) return;
    if (state.kind !== 'idle' && state.text === source) return;
    const t = setTimeout(() => run(source), AUTO_DELAY);
    return () => clearTimeout(t);
    // run と state は最新のものを使えばよい
  }, [auto, source]);

  const stale =
    state.kind !== 'idle' && state.kind !== 'running' && source !== null && state.text !== source;
  const findings = state.kind === 'done' ? state.result.findings : [];
  const errors = findings.filter((f) => f.severity === 'error').length;

  return (
    <div className="border-b px-3 py-2">
      <div className="flex items-center gap-2 text-xs font-semibold">
        整合性チェック
        <Button
          size="sm"
          variant="outline"
          className="h-6 px-2 text-[11px]"
          disabled={!source || state.kind === 'running'}
          onClick={() => source && run(source)}
          title="すべての遊び方を試して、詰みや到達しない場所を探します"
        >
          {state.kind === 'running' ? <Loader2 className="animate-spin" /> : <ShieldCheck />}{' '}
          チェック
        </Button>
        {state.kind === 'running' && (
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
        <label
          className="ml-auto flex items-center gap-1.5 font-normal text-muted-foreground"
          title={large ? '大きな章では時間がかかるので、チェックボタンで行ってください' : undefined}
        >
          <Switch checked={auto && !large} disabled={large} onCheckedChange={setAuto} /> 自動
        </label>
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground">
        {!source && 'コンパイルが通るとチェックできます。'}
        {source && state.kind === 'idle' && '未チェック'}
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
        {stale && <span className="text-amber-600">（チェックの後に変更があります）</span>}
      </div>
      {findings.length > 0 && (
        <ul className={cn('mt-1 max-h-48 space-y-0.5 overflow-y-auto', stale && 'opacity-60')}>
          {findings.map((f, i) => {
            const target = f.scene ? selectionForNodeIn(parts, f.scene) : null;
            const Icon = f.severity === 'error' ? CircleX : AlertTriangle;
            return (
              <li key={i}>
                <button
                  type="button"
                  disabled={!target}
                  onClick={() => target && select(target)}
                  className={cn(
                    'flex w-full items-start gap-1.5 rounded-md p-1 text-left text-xs hover:bg-accent disabled:cursor-default',
                    f.severity === 'error' ? 'text-destructive' : 'text-amber-700',
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
    </div>
  );
}
