// 人物ファイル・証言へ戻る・画面の色・文字の枠・BGM の一時停止など、小さなコマンドの入力欄
import { useMemo } from 'react';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { pathKey } from '@/model/paths.ts';
import { idList, idListValue, profileIds } from '@/model/steps.ts';
import { useEditorState } from '@/state/editor-store.tsx';
import { IdChips, useCharacterLabels, useSetter } from '../fields.tsx';
import { FramesInput } from './effect-fields.tsx';
import type { BodyProps } from './say-fields.tsx';

/** 人物ファイルに加える・外す（人物ファイルのある人物から選ぶ） */
export function ProfileBody({
  path,
  step,
  name,
}: BodyProps & { name: 'giveProfile' | 'takeProfile' }) {
  const characters = useEditorState((s) => s.data?.characters);
  const profiles = useMemo(() => profileIds(characters), [characters]);
  const labels = useCharacterLabels();
  const { set } = useSetter();
  return (
    <IdChips
      value={idList(step[name])}
      options={profiles}
      labels={labels}
      path={[...path, name]}
      aria-label={name === 'giveProfile' ? '人物ファイルに加える人物' : '人物ファイルから外す人物'}
      onChange={(v) => set([...path, name], idListValue(v))}
    />
  );
}

interface Choice {
  value: string;
  label: string;
}

/** 決まった値から 1 つ選ぶ欄 */
function Pick({
  path,
  value,
  choices,
  label,
  toValue = (s) => s,
}: {
  path: BodyProps['path'];
  value: unknown;
  choices: Choice[];
  label: string;
  toValue?: (s: string) => unknown;
}) {
  const { set } = useSetter();
  return (
    <NativeSelect
      size="sm"
      className="h-8 w-56"
      value={String(value)}
      aria-label={label}
      data-path={pathKey(path)}
      onChange={(e) => set(path, toValue(e.target.value))}
    >
      {choices.map((c) => (
        <NativeSelectOption key={c.value} value={c.value}>
          {c.label}
        </NativeSelectOption>
      ))}
    </NativeSelect>
  );
}

const bool = (s: string) => s === 'true';

export function ResumeBody({ path, step }: BodyProps) {
  return (
    <Pick
      path={[...path, 'resume']}
      value={step.resume}
      label="戻る先"
      choices={[
        { value: 'next', label: '次の証言へ' },
        { value: 'stay', label: '同じ証言へ' },
        { value: 'first', label: '最初の証言へ' },
      ]}
    />
  );
}

export function PaletteBody({ path, step }: BodyProps) {
  return (
    <Pick
      path={[...path, 'palette']}
      value={step.palette}
      label="画面の色"
      choices={[
        { value: 'normal', label: 'ふつう' },
        { value: 'grayscale', label: '白黒（回想）' },
      ]}
    />
  );
}

export function TextboxBody({ path, step }: BodyProps) {
  return (
    <Pick
      path={[...path, 'textbox']}
      value={step.textbox}
      label="文字の枠"
      toValue={bool}
      choices={[
        { value: 'true', label: '出す' },
        { value: 'false', label: '隠す' },
      ]}
    />
  );
}

export function BgmPauseBody({ path, step }: BodyProps) {
  const { setOptional } = useSetter();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Pick
        path={[...path, 'bgmPause']}
        value={step.bgmPause}
        label="一時停止・再開"
        toValue={bool}
        choices={[
          { value: 'true', label: '一時停止する' },
          { value: 'false', label: '続きから再開する' },
        ]}
      />
      <FramesInput
        label="フェード"
        placeholder="0"
        path={[...path, 'frames']}
        value={step.frames}
        onChange={(v) => setOptional([...path, 'frames'], v)}
      />
    </div>
  );
}
