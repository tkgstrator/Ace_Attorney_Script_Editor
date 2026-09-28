// YAML のまま編集する小さな欄。打っている間は下書きで、フォーカスを外す・保存・元に戻すの前に反映する。
// 入力中の Ctrl/Cmd+Z は、この欄の中の取り消しになる（data-local-undo）
import { useEffect, useId, useRef, useState } from 'react';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { useDraft } from '@/state/editor-store.tsx';

interface Props {
  value: unknown;
  /** 読めた値を反映する。反映できない理由を返してもよい */
  onCommit: (v: unknown) => string | null | undefined;
  /** 反映する前の確かめ（だめなら理由） */
  validate?: (v: unknown) => string | null;
  hint?: string;
  className?: string;
  'aria-label': string;
  autoFocus?: boolean;
}

export function YamlDraft({
  value,
  onCommit,
  validate,
  hint,
  className,
  autoFocus,
  ...rest
}: Props) {
  const source = stringifyYaml(value, { lineWidth: 0 }).trimEnd();
  const [draft, setDraft] = useState(source);
  const [error, setError] = useState<string | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const hintId = useId();

  /** 最後に反映した下書き（欄がなくなるときに、もう一度反映しないため） */
  const done = useRef<string | null>(null);
  useEffect(() => {
    setDraft(source);
    setError(null);
    done.current = null;
  }, [source]);
  const flush = (): string | null => {
    if (draft === source || draft === done.current) return null;
    let v: unknown;
    try {
      v = parseYaml(draft) as unknown;
    } catch (e) {
      const m = `YAML として読めません: ${(e as Error).message.split('\n')[0] ?? ''}`;
      setError(m);
      return m;
    }
    const bad = validate?.(v) ?? onCommit(v) ?? null;
    if (bad === null) done.current = draft;
    setError(bad);
    return bad;
  };
  useDraft(draft !== source, flush, area);

  return (
    <div className="space-y-1">
      <Textarea
        ref={area}
        data-local-undo
        spellCheck={false}
        autoFocus={autoFocus}
        className={cn('min-h-9 resize-none py-1.5 font-mono text-xs', className)}
        value={draft}
        aria-label={rest['aria-label']}
        aria-invalid={error !== null}
        aria-describedby={hintId}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={flush}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && draft !== source) {
            e.stopPropagation();
            setDraft(source);
            setError(null);
          }
        }}
      />
      <p
        id={hintId}
        className={cn('text-[11px]', error ? 'text-destructive' : 'text-muted-foreground')}
      >
        {error ?? hint}
        {draft !== source && !error && '（フォーカスを外すと反映・Esc で取り消し）'}
      </p>
    </div>
  );
}
