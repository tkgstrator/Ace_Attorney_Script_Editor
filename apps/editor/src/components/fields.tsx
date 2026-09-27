// 入力欄の小さな部品。値の書き込みは useActions().edit で、パスを指定して行う。
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { isValidId, pathKey } from '@/model/paths.ts';
import type { Path } from '@/model/yaml-doc.ts';
import { useActions, useEditorState } from '@/state/editor-store.tsx';

/** パスに値を書く関数（空文字なら省略＝キーを消す、を選べる） */
export function useSetter() {
  const { edit } = useActions();
  return {
    set: (path: Path, value: unknown, coalesce = false) =>
      edit([{ op: 'set', path, value }], coalesce ? pathKey(path) : undefined),
    /** '' や undefined ならキーを消す */
    setOptional: (path: Path, value: unknown, coalesce = false) =>
      edit(value === '' || value === undefined
        ? [{ op: 'delete', path }]
        : [{ op: 'set', path, value }], coalesce ? pathKey(path) : undefined),
    remove: (path: Path) => edit([{ op: 'delete', path }]),
  };
}

export function Field({ label, children, className, hint }: { label: string; children: ReactNode; className?: string; hint?: string }) {
  return (
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
}

/** 文字列の値を編集する欄 */
export function TextInput({ path, value, placeholder, optional, multiline, mono, className, ...rest }: TextProps) {
  const { set, setOptional } = useSetter();
  const v = typeof value === 'string' ? value : value === undefined || value === null ? '' : String(value);
  const onChange = (s: string) => (optional ? setOptional(path, s, true) : set(path, s, true));
  const cls = cn(mono && 'font-mono text-xs', className);
  if (multiline) {
    return (
      <Textarea
        className={cn('min-h-9 min-w-full resize-none py-1.5', cls)} rows={1} value={v} placeholder={placeholder}
        onChange={e => onChange(e.target.value)} aria-label={rest['aria-label']}
      />
    );
  }
  return <Input className={cn('h-8', cls)} value={v} placeholder={placeholder} onChange={e => onChange(e.target.value)} aria-label={rest['aria-label']} />;
}

/** 条件式の欄 */
export function CondInput(props: Omit<TextProps, 'mono'>) {
  return <TextInput mono placeholder="条件式（例: has(repair) and not asked）" {...props} />;
}

/** 数値の欄。空にすると省略（optional のとき） */
export function NumberInput({ path, value, optional, className, min, step }: { path: Path; value: unknown; optional?: boolean; className?: string; min?: number; step?: number }) {
  const { set, setOptional } = useSetter();
  return (
    <Input
      type="number" className={cn('h-8 w-24', className)} min={min} step={step}
      value={typeof value === 'number' ? value : ''}
      onChange={e => {
        const s = e.target.value;
        if (s === '') { if (optional) setOptional(path, undefined); return; }
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
  'aria-label'?: string;
}

/** ID を選ぶ欄。今の値が一覧になくても、そのまま出す（! 付き） */
export function IdSelect({ value, options, onChange, nullLabel, noneLabel, labels, className, ...rest }: IdSelectProps) {
  const current = value === null ? NULL : value === undefined ? NONE : String(value);
  const unknown = typeof value === 'string' && !options.includes(value);
  return (
    <NativeSelect
      size="sm" className={cn('h-8 min-w-28', unknown && 'border-destructive text-destructive', className)}
      value={current} aria-label={rest['aria-label']}
      onChange={e => {
        const v = e.target.value;
        onChange(v === NULL ? null : v === NONE ? undefined : v);
      }}
    >
      {noneLabel !== undefined && <NativeSelectOption value={NONE}>{noneLabel}</NativeSelectOption>}
      {nullLabel !== undefined && <NativeSelectOption value={NULL}>{nullLabel}</NativeSelectOption>}
      {value === undefined && noneLabel === undefined && <NativeSelectOption value={NONE}>（選択）</NativeSelectOption>}
      {unknown && <NativeSelectOption value={String(value)}>! {String(value)}</NativeSelectOption>}
      {options.map(id => (
        <NativeSelectOption key={id} value={id}>{labels?.[id] ? `${labels[id]}（${id}）` : id}</NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

/** 人物の表示名（ID → name） */
export function useCharacterLabels(): Record<string, string> {
  return useLabels(useEditorState(s => s.data?.characters));
}

/** 証拠品の表示名 */
export function useEvidenceLabels(): Record<string, string> {
  return useLabels(useEditorState(s => s.data?.evidence));
}

/** ID → name の表。元のマップが変わったときだけ作り直す */
function useLabels(map: unknown): Record<string, string> {
  return useMemo(() => {
    const m = (typeof map === 'object' && map !== null ? map : {}) as Record<string, { name?: string } | null>;
    return Object.fromEntries(Object.entries(m).map(([id, c]) => [id, c?.name ?? id]));
  }, [map]);
}

/** 複数の ID をチップで選ぶ（証拠品の一覧など） */
export function IdChips({ value, options, labels, onChange }: { value: string[]; options: string[]; labels?: Record<string, string>; onChange: (v: string[]) => void }) {
  const all = [...options, ...value.filter(v => !options.includes(v))];
  return (
    <div className="flex flex-wrap gap-1">
      {all.map(id => {
        const on = value.includes(id);
        return (
          <button
            key={id} type="button"
            className={cn(
              'rounded-full border px-2 py-0.5 text-xs transition-colors',
              on ? 'border-primary bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-accent',
              !options.includes(id) && 'border-destructive',
            )}
            onClick={() => onChange(on ? value.filter(v => v !== id) : [...value, id])}
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
export function Section({ title, children, actions, className }: { title: ReactNode; children: ReactNode; actions?: ReactNode; className?: string }) {
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

/** マップのキー（ID）の欄。確定（Enter かフォーカスを外す）したときに名前を変える */
export function KeyInput({ value, taken, onRename, className }: { value: string; taken: string[]; onRename: (to: string) => void; className?: string }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  const error = draft === value ? null : !isValidId(draft) ? 'ID は英字・数字・_ で、先頭は英字か _' : taken.includes(draft) ? 'すでに使われています' : null;
  const commit = () => {
    if (draft === value) return;
    if (error) { setDraft(value); return; }
    onRename(draft);
  };
  return (
    <Input
      className={cn('h-8 font-mono text-xs', error && 'border-destructive', className)} value={draft} title={error ?? 'Enter で確定'}
      onChange={e => setDraft(e.target.value)} onBlur={commit}
      onKeyDown={e => { if (e.key === 'Enter') commit(); if (e.key === 'Escape') setDraft(value); }}
      aria-label="ID" aria-invalid={error !== null}
    />
  );
}
