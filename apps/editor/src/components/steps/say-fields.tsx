// 台詞・ナレーション・帯テキスト・日時表示、それと種類の分からないステップの入力欄
import { useId } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { cn } from '@/lib/utils';
import { pathKey } from '@/model/paths.ts';
import {
  COMMAND_LABELS,
  type CommandName,
  canShorten,
  commandDescription,
  readSay,
  type SayPatch,
  type Step,
  sayEditOps,
  sayTextKey,
  shortenOps,
} from '@/model/steps.ts';
import type { Path } from '@/model/yaml-doc.ts';
import { useActions, useIds } from '@/state/editor-store.tsx';
import { IdSelect, TextInput, useCharacterLabels } from '../fields.tsx';
import { YamlDraft } from '../yaml-draft.tsx';

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
  const { edit } = useActions();
  const labels = useCharacterLabels();
  const autoId = useId();
  const v = readSay(step);
  const color = TEXT_COLORS.find((c) => c.value === v.color);
  // 変えた属性だけを書き換える（auto などを消さない）
  const change = (patch: SayPatch) => edit(sayEditOps(path, step, patch));
  return (
    <div className="flex flex-col gap-1">
      <div className="flex flex-wrap items-center gap-1">
        <IdSelect
          path={'say' in step ? [...path, 'say'] : undefined}
          value={v.speaker}
          options={ids.characters}
          labels={labels}
          nullLabel="（名前なし）"
          aria-label="話す人物"
          onChange={(s) => change({ speaker: s ?? null })}
        />
        <NativeSelect
          size="sm"
          className={cn('h-8 w-32', color?.className)}
          value={v.color ?? ''}
          aria-label="文字の色"
          data-path={pathKey([...path, 'color'])}
          onChange={(e) => change({ color: e.target.value || undefined })}
        >
          <NativeSelectOption value="">色: 既定</NativeSelectOption>
          {TEXT_COLORS.map((c) => (
            <NativeSelectOption key={c.value} value={c.value}>
              {c.label}
            </NativeSelectOption>
          ))}
        </NativeSelect>
        <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
          <Checkbox
            id={autoId}
            checked={v.auto === true}
            data-path={pathKey([...path, 'auto'])}
            onCheckedChange={(c) => change({ auto: c === true })}
          />
          <label htmlFor={autoId} title="出し終えたら、ボタンを待たずに次へ進みます">
            自動送り
          </label>
        </span>
        {canShorten(step) && (
          <button
            type="button"
            className="text-[11px] text-muted-foreground underline"
            onClick={() => edit(shortenOps(path, step))}
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
      aria-label={name === 'card' ? '日時・場所' : '帯テキスト'}
    />
  );
}

/**
 * 種類の分からないステップや、専用の入力欄がないコマンドは、YAML のまま編集する。
 * known: 分かっているコマンドの名前（説明を出す）
 */
export function UnknownBody({ path, step, known }: BodyProps & { known?: CommandName }) {
  const { edit } = useActions();
  return (
    <div data-path={pathKey(path)}>
      <YamlDraft
        value={step}
        aria-label={known ? `${COMMAND_LABELS[known]}（YAML）` : 'ステップ（YAML）'}
        hint={
          known
            ? `専用の入力欄はありません。YAML で編集してください（${commandDescription(known)}）`
            : 'コマンドが分かりません。YAML のまま直してください'
        }
        onCommit={(v) => {
          edit([{ op: 'set', path, value: v }]);
          return null;
        }}
      />
    </div>
  );
}
