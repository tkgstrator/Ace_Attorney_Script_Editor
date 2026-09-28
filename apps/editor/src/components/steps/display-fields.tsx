// 表示まわり（人物・証拠品の小窓・場所）のステップの入力欄
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { pathKey } from '@/model/paths.ts';
import type { Path } from '@/model/yaml-doc.ts';
import { useIds } from '@/state/editor-store.tsx';
import { IdSelect, useCharacterLabels, useEvidenceLabels, useSetter } from '../fields.tsx';
import { FramesInput } from './effect-fields.tsx';
import type { BodyProps } from './say-fields.tsx';

export function ShowEvidenceBody({ path, step }: BodyProps) {
  const ids = useIds();
  const { set, setOptional } = useSetter();
  const labels = useEvidenceLabels();
  return (
    <div className="flex flex-wrap items-center gap-1">
      <IdSelect
        path={[...path, 'showEvidence']}
        value={step.showEvidence}
        options={ids.evidence}
        labels={labels}
        nullLabel="（小窓を消す）"
        aria-label="証拠品"
        onChange={(v) => set([...path, 'showEvidence'], v ?? null)}
      />
      {step.showEvidence !== null && (
        <NativeSelect
          size="sm"
          className="h-8 w-28"
          value={step.side === 'right' ? 'right' : 'left'}
          aria-label="小窓を出す側"
          data-path={pathKey([...path, 'side'])}
          onChange={(e) =>
            setOptional([...path, 'side'], e.target.value === 'left' ? undefined : 'right')
          }
        >
          <NativeSelectOption value="left">左に出す</NativeSelectOption>
          <NativeSelectOption value="right">右に出す</NativeSelectOption>
        </NativeSelect>
      )}
    </div>
  );
}

/** 人物の動き（番号か ID）。空にすると省略 */
function PoseInput({ path, value, label }: { path: Path; value: unknown; label: string }) {
  const { setOptional } = useSetter();
  return (
    <Input
      className="h-8 w-20 font-mono text-xs"
      value={value === undefined ? '' : String(value)}
      placeholder={label}
      title={`${label}（元のゲームの動きの番号など。空なら省略）`}
      aria-label={label}
      data-path={pathKey(path)}
      onChange={(e) => {
        const s = e.target.value.trim();
        setOptional(path, /^\d+$/.test(s) ? Number(s) : s, true);
      }}
    />
  );
}

export function ShowBody({ path, step }: BodyProps) {
  const ids = useIds();
  const { set, setOptional } = useSetter();
  const labels = useCharacterLabels();
  return (
    <div className="flex flex-wrap items-center gap-1">
      <IdSelect
        path={[...path, 'show']}
        value={step.show}
        options={ids.characters}
        labels={labels}
        nullLabel="（誰も出さない）"
        aria-label="人物"
        onChange={(v) => set([...path, 'show'], v ?? null)}
      />
      {step.show !== null && (
        <>
          <PoseInput path={[...path, 'talk']} value={step.talk} label="話す動き" />
          <PoseInput path={[...path, 'idle']} value={step.idle} label="黙る動き" />
        </>
      )}
      <FramesInput
        label="フェード"
        placeholder="0"
        path={[...path, 'frames']}
        value={step.frames}
        onChange={(v) => setOptional([...path, 'frames'], v || undefined)}
      />
    </div>
  );
}

export function LocationBody({ path, step }: BodyProps) {
  const ids = useIds();
  const { set } = useSetter();
  const listId = `location-${path.join('-')}`;
  return (
    <div className="flex items-center gap-2">
      <Input
        className="h-8 w-48 font-mono text-xs"
        list={listId}
        value={typeof step.location === 'string' ? step.location : ''}
        placeholder="空なら法廷に戻る"
        aria-label="場所（背景のキー）"
        data-path={pathKey([...path, 'location'])}
        onChange={(e) =>
          set([...path, 'location'], e.target.value === '' ? null : e.target.value, true)
        }
      />
      <datalist id={listId}>
        {ids.places.map((p) => (
          <option key={p} value={p} />
        ))}
      </datalist>
      {step.location === null && <span className="text-xs text-muted-foreground">法廷に戻る</span>}
    </div>
  );
}
