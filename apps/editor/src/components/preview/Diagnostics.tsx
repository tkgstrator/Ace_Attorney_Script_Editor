// 診断の一覧。押すと、その入力欄を開いてフォーカスする。YAML の行があれば、YAML の直接編集でその行も開ける
import type { Diagnostic } from '@gyakusai/script';
import { AlertTriangle, CircleX, FileCode2 } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { selectionFromPath, selectionPath, startsWith } from '@/model/paths.ts';
import { useActions, useEditorState } from '@/state/editor-store.tsx';

export function Diagnostics({
  diagnostics,
  pending,
  stale,
}: {
  diagnostics: Diagnostic[];
  pending: boolean;
  /** 最後の編集より前の内容の診断 */
  stale: boolean;
}) {
  const { select } = useActions();
  const selection = useEditorState((s) => s.selection);
  const [errorsOnly, setErrorsOnly] = useState(false);
  const [here, setHere] = useState(false);
  const errorsId = useId();
  const hereId = useId();
  const errors = diagnostics.filter((d) => d.severity === 'error').length;
  const scope = selectionPath(selection);
  const shown = useMemo(
    () =>
      diagnostics.filter(
        (d) =>
          (!errorsOnly || d.severity === 'error') &&
          (!here || (scope !== null && startsWith(d.path, scope))),
      ),
    [diagnostics, errorsOnly, here, scope],
  );
  return (
    <section className="flex min-h-0 flex-1 flex-col" aria-label="診断">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 px-3 py-2 text-xs font-semibold">
        診断
        {pending ? (
          <span className="font-normal text-muted-foreground">コンパイル中…</span>
        ) : diagnostics.length === 0 ? (
          <span className="font-normal text-emerald-700">問題はありません</span>
        ) : (
          <span className="font-normal text-muted-foreground">
            エラー {errors}・警告 {diagnostics.length - errors}
          </span>
        )}
        {stale && <span className="font-normal text-amber-700">（最後の編集より前の内容）</span>}
        <span className="ml-auto flex items-center gap-2 font-normal text-muted-foreground">
          <span className="flex items-center gap-1">
            <Checkbox
              id={errorsId}
              checked={errorsOnly}
              onCheckedChange={(c) => setErrorsOnly(c === true)}
            />
            <label htmlFor={errorsId}>エラーのみ</label>
          </span>
          <span className="flex items-center gap-1">
            <Checkbox id={hereId} checked={here} onCheckedChange={(c) => setHere(c === true)} />
            <label htmlFor={hereId}>開いている項目のみ</label>
          </span>
        </span>
      </div>
      <ul className="flex-1 space-y-1 overflow-y-auto px-3 pb-3">
        {shown.map((d) => {
          const target = selectionFromPath(d.path);
          const Icon = d.severity === 'error' ? CircleX : AlertTriangle;
          const where = d.path.join('.');
          return (
            <li key={`${where}\u0000${d.message}`} className="flex items-start gap-0.5">
              <button
                type="button"
                disabled={!target}
                onClick={() => target && select(target.selection, target.focus)}
                className={cn(
                  'flex min-w-0 flex-1 items-start gap-1.5 rounded-md p-1.5 text-left text-xs hover:bg-accent disabled:cursor-default',
                  d.severity === 'error' ? 'text-destructive' : 'text-amber-800',
                )}
              >
                <Icon
                  className="mt-0.5 size-3.5 shrink-0"
                  aria-label={d.severity === 'error' ? 'エラー' : '警告'}
                />
                <span className="min-w-0">
                  <span className="block">{d.message}</span>
                  <span className="block font-mono text-[10px] text-muted-foreground">
                    {d.line !== undefined ? `${d.line}:${d.column} ` : ''}
                    {where}
                  </span>
                </span>
              </button>
              {d.line !== undefined && (
                <button
                  type="button"
                  className="mt-1 rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground"
                  title={`YAML の ${d.line} 行目を開く（コンパイルしたときの行）`}
                  aria-label={`YAML の ${d.line} 行目を開く`}
                  onClick={() => select({ kind: 'yaml' }, undefined, d.line)}
                >
                  <FileCode2 className="size-3.5" />
                </button>
              )}
            </li>
          );
        })}
        {shown.length === 0 && diagnostics.length > 0 && (
          <li className="text-xs text-muted-foreground">絞り込みに当てはまる診断はありません</li>
        )}
      </ul>
    </section>
  );
}
