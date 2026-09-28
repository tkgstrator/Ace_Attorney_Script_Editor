// フラグ・証拠品・移動・吹き出しなど、値を 1〜数個持つステップの入力欄（表示まわりは display-fields.tsx）
import { Plus, X } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { pathKey } from '@/model/paths.ts';
import { flagDefault, flagsOfType, idList, idListValue } from '@/model/steps.ts';
import type { Path } from '@/model/yaml-doc.ts';
import { type FlagValue, useActions, useFlagValues, useIds } from '@/state/editor-store.tsx';
import { IdChips, IdSelect, useCharacterLabels, useEvidenceLabels, useSetter } from '../fields.tsx';
import { RefJump } from '../ref-jump.tsx';
import type { BodyProps } from './say-fields.tsx';

const record = (v: unknown) =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {};

/** フラグ名 → 値 の組を編集する（set と add で使う）。add は数値のフラグだけ */
function FlagRows({ path, value, numeric }: { path: Path; value: unknown; numeric?: boolean }) {
  const ids = useIds();
  const flagValues = useFlagValues();
  const { edit, select } = useActions();
  const { set } = useSetter();
  const entries = Object.entries(record(value));
  const options = numeric ? flagsOfType({ flags: ids.flags, flagValues }, 'number') : ids.flags;
  const unused = options.find((f) => !entries.some(([k]) => k === f));
  return (
    <div className="flex flex-col gap-1">
      {entries.map(([name, v]) => (
        <div key={name} className="flex items-center gap-1">
          <IdSelect
            value={name}
            options={options}
            aria-label="フラグ"
            onChange={(to) => {
              if (to) edit([{ op: 'renameKey', path, from: name, to }]);
            }}
          />
          <span className="text-xs text-muted-foreground">{numeric ? '+=' : '='}</span>
          <FlagValueInput
            path={[...path, name]}
            value={v}
            initial={numeric ? 0 : flagValues[name]}
            label={`${name} の値`}
          />
          <button
            type="button"
            className="text-muted-foreground hover:text-destructive"
            title="消す"
            aria-label={`${name} を消す`}
            onClick={() => edit([{ op: 'delete', path: [...path, name] }])}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      {unused && (
        <button
          type="button"
          className="flex w-fit items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          onClick={() => set([...path, unused], numeric ? 1 : flagDefault(flagValues[unused]))}
        >
          <Plus className="size-3" /> フラグを追加
        </button>
      )}
      {options.length === 0 && (
        <p className="text-[11px] text-amber-700">
          {numeric ? '数値のフラグがありません。' : 'フラグがありません。'}
          <button
            type="button"
            className="ml-1 underline"
            onClick={() => select({ kind: 'flags' })}
          >
            フラグの表で作る
          </button>
        </p>
      )}
    </div>
  );
}

/** フラグの値の欄。型は初期値（flags）に合わせる */
export function FlagValueInput({
  path,
  value,
  initial,
  label = '値',
}: {
  path: Path;
  value: unknown;
  initial: FlagValue | undefined;
  label?: string;
}) {
  const { set } = useSetter();
  const type = typeof (initial ?? value);
  const dp = pathKey(path);
  if (type === 'boolean') {
    return (
      <NativeSelect
        size="sm"
        className="h-8 w-24"
        value={String(value)}
        onChange={(e) => set(path, e.target.value === 'true')}
        aria-label={label}
        data-path={dp}
      >
        <NativeSelectOption value="true">true</NativeSelectOption>
        <NativeSelectOption value="false">false</NativeSelectOption>
      </NativeSelect>
    );
  }
  if (type === 'number') {
    return (
      <Input
        type="number"
        className="h-8 w-24"
        value={typeof value === 'number' ? value : ''}
        aria-label={label}
        data-path={dp}
        onChange={(e) => {
          const n = Number(e.target.value);
          if (e.target.value !== '' && Number.isFinite(n)) set(path, n, true);
        }}
      />
    );
  }
  return (
    <Input
      className="h-8 w-40"
      value={String(value ?? '')}
      onChange={(e) => set(path, e.target.value, true)}
      aria-label={label}
      data-path={dp}
    />
  );
}

export function SetBody({ path, step }: BodyProps) {
  return <FlagRows path={[...path, 'set']} value={step.set} />;
}

export function AddBody({ path, step }: BodyProps) {
  return <FlagRows path={[...path, 'add']} value={step.add} numeric />;
}

export function GiveTakeBody({ path, step, name }: BodyProps & { name: 'give' | 'take' }) {
  const ids = useIds();
  const { set } = useSetter();
  const labels = useEvidenceLabels();
  return (
    <IdChips
      value={idList(step[name])}
      options={ids.evidence}
      labels={labels}
      path={[...path, name]}
      aria-label={name === 'give' ? '渡す証拠品' : '外す証拠品'}
      onChange={(v) => set([...path, name], idListValue(v))}
    />
  );
}

export function GotoBody({ path, step }: BodyProps) {
  const ids = useIds();
  const { set } = useSetter();
  return (
    <div className="flex items-center gap-1">
      <IdSelect
        path={[...path, 'goto']}
        value={step.goto}
        options={ids.scenes}
        onChange={(v) => v && set([...path, 'goto'], v)}
        aria-label="移動先のシーン"
      />
      <RefJump id={step.goto} from={path} />
    </div>
  );
}

export function InvestigateBody({ path, step }: BodyProps) {
  const ids = useIds();
  const { set } = useSetter();
  return (
    <div className="flex items-center gap-1">
      <IdSelect
        path={[...path, 'investigate']}
        value={step.investigate}
        options={ids.places}
        onChange={(v) => v && set([...path, 'investigate'], v)}
        aria-label="場所"
      />
      <RefJump id={step.investigate} from={path} />
    </div>
  );
}

export function PenaltyBody({ path, step }: BodyProps) {
  const { set } = useSetter();
  const v = step.penalty;
  return (
    <div className="flex items-center gap-2">
      <NativeSelect
        size="sm"
        className="h-8 w-36"
        value={v === true ? 'default' : 'number'}
        aria-label="減らす量"
        onChange={(e) => set([...path, 'penalty'], e.target.value === 'default' ? true : 1)}
      >
        <NativeSelectOption value="default">既定の量</NativeSelectOption>
        <NativeSelectOption value="number">量を指定</NativeSelectOption>
      </NativeSelect>
      {v !== true && (
        <Input
          type="number"
          min={1}
          className="h-8 w-20"
          value={typeof v === 'number' ? v : ''}
          aria-label="量"
          onChange={(e) => {
            const n = Number(e.target.value);
            if (n > 0) set([...path, 'penalty'], n, true);
          }}
        />
      )}
    </div>
  );
}

const SHOUTS = [
  { value: 'objection', label: '異議あり！' },
  { value: 'hold', label: '待った！' },
  { value: 'takethat', label: 'くらえ！' },
];

export function ShoutBody({ path, step }: BodyProps) {
  const ids = useIds();
  const { set, setOptional } = useSetter();
  const labels = useCharacterLabels();
  return (
    <div className="flex flex-wrap items-center gap-1">
      <NativeSelect
        size="sm"
        className="h-8 w-32"
        value={String(step.shout)}
        onChange={(e) => set([...path, 'shout'], e.target.value)}
        aria-label="吹き出し"
      >
        {SHOUTS.map((s) => (
          <NativeSelectOption key={s.value} value={s.value}>
            {s.label}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <IdSelect
        path={[...path, 'by']}
        value={step.by}
        options={ids.characters}
        labels={labels}
        noneLabel="（叫ぶ人: 指定なし）"
        aria-label="叫ぶ人"
        onChange={(v) => setOptional([...path, 'by'], v ?? undefined)}
      />
    </div>
  );
}
