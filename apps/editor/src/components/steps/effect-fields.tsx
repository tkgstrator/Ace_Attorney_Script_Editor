// 音と画面の演出（bgm・se・shake・flash・fade・wait）のステップの入力欄。時間の単位はフレーム（1/60 秒）
import { DEFAULT_FLASH_FRAMES, DEFAULT_SHAKE_FRAMES } from '@gyakusai/core';
import { useId } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { pathKey } from '@/model/paths.ts';
import type { Path } from '@/model/yaml-doc.ts';
import { useSetter } from '../fields.tsx';
import type { BodyProps } from './say-fields.tsx';

/** フレーム数（1/60 秒）の欄。空にするとキーを消す（既定値に戻す）。placeholder に既定値を出す */
export function FramesInput({
  value,
  onChange,
  placeholder,
  label,
  path,
}: {
  value: unknown;
  onChange: (v: number | undefined) => void;
  placeholder: string;
  label: string;
  path?: Path;
}) {
  const id = useId();
  return (
    <span className="flex items-center gap-1 text-xs text-muted-foreground">
      <label htmlFor={id}>{label}</label>
      <Input
        id={id}
        type="number"
        min={0}
        step={1}
        className="h-8 w-20"
        placeholder={placeholder}
        title={`空欄なら既定の ${placeholder} フレーム`}
        data-path={path ? pathKey(path) : undefined}
        value={typeof value === 'number' ? value : ''}
        onChange={(e) => onChange(e.target.value === '' ? undefined : Number(e.target.value))}
      />
      フレーム
    </span>
  );
}

/** 音の ID の欄（null は「止める」） */
function SoundId({
  value,
  onChange,
  label,
  allowStop,
}: {
  value: unknown;
  onChange: (v: string | null) => void;
  label: string;
  allowStop?: boolean;
}) {
  const stopped = value === null;
  return (
    <div className="flex items-center gap-1">
      {allowStop && (
        <NativeSelect
          size="sm"
          className="h-8 w-24"
          value={stopped ? 'stop' : 'play'}
          aria-label="流す・止める"
          onChange={(e) => onChange(e.target.value === 'stop' ? null : '')}
        >
          <NativeSelectOption value="play">流す</NativeSelectOption>
          <NativeSelectOption value="stop">止める</NativeSelectOption>
        </NativeSelect>
      )}
      {!stopped && (
        <Input
          className="h-8 w-40 font-mono"
          placeholder="ID"
          aria-label={label}
          value={typeof value === 'string' ? value : ''}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
    </div>
  );
}

export function BgmBody({ path, step }: BodyProps) {
  const { set, setOptional } = useSetter();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <SoundId
        value={step.bgm}
        label="BGM の ID"
        allowStop
        onChange={(v) => set([...path, 'bgm'], v, true)}
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

export function SeBody({ path, step }: BodyProps) {
  const { set } = useSetter();
  return (
    <SoundId
      value={step.se}
      label="効果音の ID"
      onChange={(v) => set([...path, 'se'], v ?? '', true)}
    />
  );
}

export function ShakeBody({ path, step }: BodyProps) {
  const { set, setOptional } = useSetter();
  const strength = typeof step.strength === 'number' ? step.strength : 0;
  return (
    <div className="flex flex-wrap items-center gap-2">
      <FramesInput
        label="長さ"
        placeholder={String(DEFAULT_SHAKE_FRAMES)}
        path={[...path, 'shake']}
        value={step.shake}
        onChange={(v) => set([...path, 'shake'], v ?? true)}
      />
      <NativeSelect
        size="sm"
        className="h-8 w-24"
        value={String(strength)}
        aria-label="強さ"
        onChange={(e) =>
          setOptional(
            [...path, 'strength'],
            e.target.value === '0' ? undefined : Number(e.target.value),
          )
        }
      >
        <NativeSelectOption value="0">強さ: 小</NativeSelectOption>
        <NativeSelectOption value="1">強さ: 中</NativeSelectOption>
        <NativeSelectOption value="2">強さ: 大</NativeSelectOption>
      </NativeSelect>
    </div>
  );
}

export function FlashBody({ path, step }: BodyProps) {
  const { set, setOptional } = useSetter();
  const color = step.flash === 'red' ? 'red' : 'white';
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect
        size="sm"
        className="h-8 w-28"
        value={color}
        aria-label="色"
        onChange={(e) => set([...path, 'flash'], e.target.value === 'white' ? true : 'red')}
      >
        <NativeSelectOption value="white">白</NativeSelectOption>
        <NativeSelectOption value="red">赤</NativeSelectOption>
      </NativeSelect>
      <FramesInput
        label="長さ"
        placeholder={String(DEFAULT_FLASH_FRAMES)}
        path={[...path, 'frames']}
        value={step.frames}
        onChange={(v) => setOptional([...path, 'frames'], v)}
      />
    </div>
  );
}

export function FadeBody({ path, step }: BodyProps) {
  const { set, setOptional } = useSetter();
  const nowaitId = useId();
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect
        size="sm"
        className="h-8 w-36"
        value={step.fade === 'in' ? 'in' : 'out'}
        aria-label="向き"
        onChange={(e) => set([...path, 'fade'], e.target.value)}
      >
        <NativeSelectOption value="out">フェードアウト（覆う）</NativeSelectOption>
        <NativeSelectOption value="in">フェードイン（明ける）</NativeSelectOption>
      </NativeSelect>
      <NativeSelect
        size="sm"
        className="h-8 w-24"
        value={step.color === 'white' ? 'white' : 'black'}
        aria-label="色"
        onChange={(e) =>
          setOptional([...path, 'color'], e.target.value === 'black' ? undefined : 'white')
        }
      >
        <NativeSelectOption value="black">黒</NativeSelectOption>
        <NativeSelectOption value="white">白</NativeSelectOption>
      </NativeSelect>
      <FramesInput
        label="長さ"
        placeholder="30"
        path={[...path, 'frames']}
        value={step.frames}
        onChange={(v) => setOptional([...path, 'frames'], v)}
      />
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Checkbox
          id={nowaitId}
          checked={step.nowait === true}
          onCheckedChange={(c) => setOptional([...path, 'nowait'], c === true ? true : undefined)}
        />
        <label htmlFor={nowaitId} title="終わるのを待たずに次へ進みます（元のゲームのフェード）">
          待たずに進む
        </label>
      </span>
    </div>
  );
}

export function WaitBody({ path, step }: BodyProps) {
  const { set } = useSetter();
  return (
    <FramesInput
      label="待つ"
      placeholder="30"
      path={[...path, 'wait']}
      value={step.wait}
      onChange={(v) => set([...path, 'wait'], v ?? 30)}
    />
  );
}
