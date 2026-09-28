// 入力欄の小さな部品。値の書き込みは useActions().edit で、パスを指定して行う。
import { type ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { isValidId, pathKey } from '@/model/paths.ts';
import type { Path } from '@/model/yaml-doc.ts';
import { useActions, useDraft, useEditorState } from '@/state/editor-store.tsx';

export { CondInput } from './cond-input.tsx';

/** パスに値を書く関数（空文字なら省略＝キーを消す、を選べる） */
export function useSetter() {
  const { edit } = useActions();
  return {
    set: (path: Path, value: unknown, coalesce = false) =>
      edit([{ op: 'set', path, value }], coalesce ? pathKey(path) : undefined),
    /** '' や undefined ならキーを消す */
    setOptional: (path: Path, value: unknown, coalesce = false) =>
      edit(
        value === '' || value === undefined
          ? [{ op: 'delete', path }]
          : [{ op: 'set', path, value }],
        coalesce ? pathKey(path) : undefined,
      ),
    remove: (path: Path) => edit([{ op: 'delete', path }]),
  };
}

export function Field({
  label,
  children,
  className,
  hint,
}: {
  label: string;
  children: ReactNode;
  className?: string;
  hint?: string;
}) {
  return (
    // biome-ignore lint/a11y/noLabelWithoutControl: 入力欄は children で渡す（label の中に入る）
    <label className={cn('flex min-w-0 flex-col gap-1', className)} title={hint}>
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

interface TextProps {
  path: Path;
  value: unknown;
  placeholder?: string;
  /** 空にしたらキーを消す */
  optional?: boolean;
  multiline?: boolean;
  mono?: boolean;
  className?: string;
  'aria-label'?: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

/** 文字列の値を編集する欄 */
export function TextInput({
  path,
  value,
  placeholder,
  optional,
  multiline,
  mono,
  className,
  ...rest
}: TextProps) {
  const { set, setOptional } = useSetter();
  const v =
    typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
  const onChange = (s: string) => (optional ? setOptional(path, s, true) : set(path, s, true));
  const cls = cn(mono && 'font-mono text-xs', className);
  const common = {
    value: v,
    placeholder,
    onChange: (e: { target: { value: string } }) => onChange(e.target.value),
    'aria-label': rest['aria-label'],
    'aria-invalid': rest['aria-invalid'],
    'aria-describedby': rest['aria-describedby'],
    'data-path': pathKey(path),
  };
  if (multiline)
    return (
      <Textarea className={cn('min-h-9 min-w-full resize-none py-1.5', cls)} rows={1} {...common} />
    );
  return <Input className={cn('h-8', cls)} {...common} />;
}

/** 数値の欄。空にすると省略（optional のとき） */
export function NumberInput({
  path,
  value,
  optional,
  className,
  min,
  step,
  ...rest
}: {
  path: Path;
  value: unknown;
  optional?: boolean;
  className?: string;
  min?: number;
  step?: number;
  'aria-label'?: string;
}) {
  const { set, setOptional } = useSetter();
  return (
    <Input
      type="number"
      className={cn('h-8 w-24', className)}
      min={min}
      step={step}
      aria-label={rest['aria-label']}
      data-path={pathKey(path)}
      value={typeof value === 'number' ? value : ''}
      onChange={(e) => {
        const s = e.target.value;
        if (s === '') {
          if (optional) setOptional(path, undefined);
          return;
        }
        const n = Number(s);
        if (Number.isFinite(n)) set(path, n, true);
      }}
    />
  );
}

const NULL = '\u0000null';
const NONE = '\u0000none';

interface IdSelectProps {
  value: unknown;
  options: string[];
  onChange: (v: string | null | undefined) => void;
  /** null を選べるようにする（その表示名） */
  nullLabel?: string;
  /** 省略（undefined）を選べるようにする（その表示名） */
  noneLabel?: string;
  labels?: Record<string, string>;
  className?: string;
  /** 診断から開いたときにフォーカスするためのパス */
  path?: Path;
  'aria-label'?: string;
}

/** ID を選ぶ欄。今の値が一覧になくても、そのまま出す（! 付き） */
export function IdSelect({
  value,
  options,
  onChange,
  nullLabel,
  noneLabel,
  labels,
  className,
  path,
  ...rest
}: IdSelectProps) {
  const current = value === null ? NULL : value === undefined ? NONE : String(value);
  const unknown = typeof value === 'string' && !options.includes(value);
  return (
    <NativeSelect
      size="sm"
      className={cn('h-8 min-w-28', unknown && 'border-destructive text-destructive', className)}
      value={current}
      aria-label={rest['aria-label']}
      aria-invalid={unknown || undefined}
      title={unknown ? `「${String(value)}」はこの章にありません` : undefined}
      data-path={path ? pathKey(path) : undefined}
      onChange={(e) => {
        const v = e.target.value;
        onChange(v === NULL ? null : v === NONE ? undefined : v);
      }}
    >
      {noneLabel !== undefined && <NativeSelectOption value={NONE}>{noneLabel}</NativeSelectOption>}
      {nullLabel !== undefined && <NativeSelectOption value={NULL}>{nullLabel}</NativeSelectOption>}
      {value === undefined && noneLabel === undefined && (
        <NativeSelectOption value={NONE}>（選択）</NativeSelectOption>
      )}
      {unknown && <NativeSelectOption value={String(value)}>! {String(value)}</NativeSelectOption>}
      {options.map((id) => (
        <NativeSelectOption key={id} value={id}>
          {labels?.[id] ? `${labels[id]}（${id}）` : id}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/** 人物の表示名（ID → name） */
export function useCharacterLabels(): Record<string, string> {
  return useLabels(useEditorState((s) => s.data?.characters));
}

/** 証拠品の表示名 */
export function useEvidenceLabels(): Record<string, string> {
  return useLabels(useEditorState((s) => s.data?.evidence));
}

/** ID → name の表。元のマップが変わったときだけ作り直す */
function useLabels(map: unknown): Record<string, string> {
  return useMemo(() => {
    const m = (typeof map === 'object' && map !== null ? map : {}) as Record<
      string,
      { name?: string } | null
    >;
    return Object.fromEntries(Object.entries(m).map(([id, c]) => [id, c?.name ?? id]));
  }, [map]);
}

/** 複数の ID をチップで選ぶ（証拠品の一覧など） */
export function IdChips({
  value,
  options,
  labels,
  onChange,
  path,
  ...rest
}: {
  value: string[];
  options: string[];
  labels?: Record<string, string>;
  onChange: (v: string[]) => void;
  path?: Path;
  'aria-label': string;
}) {
  const all = [...options, ...value.filter((v) => !options.includes(v))];
  return (
    // biome-ignore lint/a11y/useSemanticElements: 見た目を変えずにまとまりの名前を付けるため
    <div
      className="flex flex-wrap gap-1"
      role="group"
      aria-label={rest['aria-label']}
      data-path={path ? pathKey(path) : undefined}
    >
      {all.map((id) => {
        const on = value.includes(id);
        return (
          <button
            key={id}
            type="button"
            aria-pressed={on}
            title={options.includes(id) ? id : `「${id}」はこの章にありません`}
            className={cn(
              'rounded-full border px-2 py-0.5 text-xs transition-colors',
              on
                ? 'border-primary bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:bg-accent',
              !options.includes(id) && 'border-destructive',
            )}
            onClick={() => onChange(on ? value.filter((v) => v !== id) : [...value, id])}
          >
            {labels?.[id] ?? id}
          </button>
        );
      })}
      {all.length === 0 && <span className="text-xs text-muted-foreground">（ありません）</span>}
    </div>
  );
}

/** 見出しつきのまとまり */
export function Section({
  title,
  children,
  actions,
  className,
}: {
  title: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn('space-y-2', className)}>
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </div>
      {children}
    </section>
  );
}

/**
 * マップのキー（ID）の欄。確定（Enter かフォーカスを外す）したときに名前を変える。
 * 正しくない ID は入力を残したまま理由を欄の下に出す（Esc で元に戻す）。保存の前にも確かめる
 */
export function KeyInput({
  value,
  taken,
  onRename,
  className,
  label = 'ID',
}: {
  value: string;
  taken: string[];
  onRename: (to: string) => void;
  className?: string;
  label?: string;
}) {
  const [draft, setDraft] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  const errorId = useId();
  const error =
    draft === value
      ? null
      : !isValidId(draft)
        ? 'ID は英字・数字・_ で、先頭は英字か _ にしてください'
        : taken.includes(draft)
          ? 'この ID はすでに使われています'
          : null;
  /** 最後に反映した下書き（欄がなくなるときに、もう一度反映しないため） */
  const done = useRef<string | null>(null);
  useEffect(() => {
    setDraft(value);
    done.current = null;
  }, [value]);
  const commit = (): string | null => {
    if (draft === value || draft === done.current) return null;
    if (error) return `${label}: ${error}`;
    done.current = draft;
    onRename(draft);
    return null;
  };
  useDraft(draft !== value, commit, input);
  return (
    <div className="space-y-0.5">
      <Input
        ref={input}
        data-local-undo
        className={cn('h-8 font-mono text-xs', error && 'border-destructive', className)}
        value={draft}
        title="Enter で確定・Esc で取り消し"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit();
          if (e.key === 'Escape') setDraft(value);
        }}
        aria-label={label}
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
      />
      {error && (
        <p id={errorId} className="text-[11px] leading-tight text-destructive">
          {error}（Esc で元に戻す）
        </p>
      )}
    </div>
  );
}
