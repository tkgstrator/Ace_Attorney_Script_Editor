// 台詞・ナレーション・帯テキスト・日時表示、それと種類の分からないステップの入力欄
import { useEffect, useState } from 'react';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { cn } from '@/lib/utils';
import { makeSay, readSay, sayTextKey, type Step } from '@/model/steps.ts';
import type { Path } from '@/model/yaml-doc.ts';
import { useIds } from '@/state/editor-store.tsx';
import { IdSelect, TextInput, useCharacterLabels, useSetter } from '../fields.tsx';

export interface BodyProps {
  path: Path;
  step: Step;
}

export const TEXT_COLORS: { value: string; label: string; className: string }[] = [
  { value: 'white', label: '白', className: '' },
  { value: 'blue', label: '青（心の声）', className: 'text-sky-600' },
  { value: 'green', label: '緑', className: 'text-emerald-600' },
  { value: 'orange', label: 'オレンジ', className: 'text-orange-500' },
  { value: 'red', label: '赤（強調）', className: 'text-red-600' },
];

export function SayBody({ path, step }: BodyProps) {
  const ids = useIds();
  const { set } = useSetter();
  const labels = useCharacterLabels();
  const v = readSay(step);
  const color = TEXT_COLORS.find((c) => c.value === v.color);
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <IdSelect
          value={v.speaker}
          options={ids.characters}
          labels={labels}
          nullLabel="（名前なし）"
          aria-label="話す人物"
          onChange={(s) => set(path, makeSay({ ...v, speaker: s ?? null }))}
        />
        <NativeSelect
          size="sm"
          className={cn('h-8 w-32', color?.className)}
          value={v.color ?? ''}
          aria-label="文字の色"
          onChange={(e) => set(path, makeSay({ ...v, color: e.target.value || undefined }))}
        >
          <NativeSelectOption value="">色: 既定</NativeSelectOption>
          {TEXT_COLORS.map((c) => (
            <NativeSelectOption key={c.value} value={c.value}>
              {c.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        {'say' in step && v.speaker && !v.color && (
          <button
            type="button"
            className="text-[11px] text-muted-foreground underline"
            onClick={() => set(path, makeSay(v))}
          >
            省略形にする
          </button>
        )}
      </div>
      <TextInput
        multiline
        path={[...path, sayTextKey(step)]}
        value={v.text}
        placeholder="台詞"
        className={cn(color?.className, v.text.startsWith('（') && !v.color && 'text-sky-700')}
        aria-label="台詞"
      />
    </div>
  );
}

export function NarrateBody({ path, step }: BodyProps) {
  return (
    <TextInput
      multiline
      path={[...path, 'narrate']}
      value={step.narrate}
      placeholder="ナレーション"
      aria-label="ナレーション"
    />
  );
}

export function TextCommandBody({ path, step, name }: BodyProps & { name: 'banner' | 'card' }) {
  return (
    <TextInput
      multiline={name === 'card'}
      path={[...path, name]}
      value={step[name]}
      placeholder={name === 'card' ? '日時・場所（改行できます）' : '帯に出す文字（例: 無罪）'}
    />
  );
}

/** 種類の分からないステップは、YAML のまま編集する */
export function UnknownBody({ path, step }: BodyProps) {
  const { set } = useSetter();
  const source = stringifyYaml(step, { lineWidth: 0 }).trimEnd();
  const [draft, setDraft] = useState(source);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => setDraft(source), [source]);
  return (
    <div className="space-y-1">
      <Textarea
        className="min-h-9 resize-none py-1.5 font-mono text-xs"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          try {
            const v = parseYaml(draft) as unknown;
            setError(null);
            if (draft !== source) set(path, v);
          } catch (e) {
            setError((e as Error).message.split('\n')[0] ?? '');
          }
        }}
      />
      <p className="text-[11px] text-destructive">
        {error ?? 'コマンドが分かりません。YAML のまま直してください'}
      </p>
    </div>
  );
}
