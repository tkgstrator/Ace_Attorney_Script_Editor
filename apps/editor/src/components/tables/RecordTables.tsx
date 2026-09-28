// 人物・証拠品・フラグの表
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { uniqueId } from '@/model/paths.ts';
import type { Path } from '@/model/yaml-doc.ts';
import { useActions, useData, type FlagValue } from '@/state/editor-store.tsx';
import { KeyInput, NumberInput, TextInput, useSetter } from '../fields.tsx';
import { FlagValueInput } from '../steps/state-fields.tsx';
import { IconButton } from '../steps/StepCard.tsx';

type Rec = Record<string, unknown>;
const rec = (v: unknown): Rec =>
  typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Rec) : {};

/** マップ（ID → 値）を表にする共通の枠 */
function RecordTable({
  path,
  title,
  columns,
  addValue,
  addBase,
  renderRow,
  note,
}: {
  path: Path;
  title: string;
  columns: string[];
  addValue: unknown;
  addBase: string;
  renderRow: (id: string, value: unknown, p: Path) => ReactNode;
  note?: ReactNode;
}) {
  const data = useData();
  const { edit } = useActions();
  const map = rec(path.reduce<unknown>((o, k) => rec(o)[k], data));
  const keys = Object.keys(map);
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">{title}</h2>
        <span className="text-sm text-muted-foreground">{keys.length} 件</span>
        <Button
          size="sm"
          className="ml-auto h-8"
          onClick={() =>
            edit([{ op: 'set', path: [...path, uniqueId(addBase, keys)], value: addValue }])
          }
        >
          <Plus /> 追加
        </Button>
      </div>
      {note && <p className="text-xs text-muted-foreground">{note}</p>}
      <table className="w-full border-separate border-spacing-y-1 text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            {columns.map((c) => (
              <th key={c} className="px-1 font-medium">
                {c}
              </th>
            ))}
            <th className="w-20" />
          </tr>
        </thead>
        <tbody>
          {keys.map((id, i) => (
            <tr key={id} className="align-top" data-path={JSON.stringify([...path, id])}>
              <td className="w-40 px-1">
                <KeyInput
                  value={id}
                  taken={keys}
                  onRename={(to) => edit([{ op: 'renameKey', path, from: id, to }])}
                />
              </td>
              {renderRow(id, map[id], [...path, id])}
              <td className="px-1 whitespace-nowrap">
                <IconButton
                  title="上へ"
                  disabled={i === 0}
                  onClick={() => edit([{ op: 'move', path, from: i, to: i - 1 }])}
                >
                  <ArrowUp />
                </IconButton>
                <IconButton
                  title="下へ"
                  disabled={i === keys.length - 1}
                  onClick={() => edit([{ op: 'move', path, from: i, to: i + 1 }])}
                >
                  <ArrowDown />
                </IconButton>
                <IconButton
                  title="消す"
                  className="hover:text-destructive"
                  onClick={() => edit([{ op: 'delete', path: [...path, id] }])}
                >
                  <Trash2 />
                </IconButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const ID_NOTE =
  'ID を変えても、シナリオの中の参照（台詞・条件など）は書き換わりません。右の診断で確認してください。';

export function CharactersTable() {
  return (
    <RecordTable
      path={['characters']}
      title="人物"
      addBase="character"
      addValue={{ name: '新しい人物' }}
      columns={['ID', '名前（名前欄）', '立ち位置', '氏名（人物ファイル）', '年齢', '説明']}
      note={ID_NOTE}
      renderRow={(_id, v, p) => {
        const c = rec(v);
        const prof = rec(c.profile);
        return (
          <>
            <td className="w-32 px-1">
              <TextInput path={[...p, 'name']} value={c.name} />
            </td>
            <td className="w-32 px-1">
              <TextInput
                path={[...p, 'stand']}
                value={c.stand}
                optional
                mono
                placeholder="defense など"
              />
            </td>
            <td className="w-36 px-1">
              <TextInput path={[...p, 'profile', 'name']} value={prof.name} optional />
            </td>
            <td className="w-20 px-1">
              <NumberInput
                path={[...p, 'profile', 'age']}
                value={prof.age}
                optional
                className="w-16"
                min={0}
              />
            </td>
            <td className="px-1">
              <TextInput
                multiline
                path={[...p, 'profile', 'description']}
                value={prof.description}
                placeholder="人物ファイルの説明"
              />
            </td>
          </>
        );
      }}
    />
  );
}

export function EvidenceTable() {
  return (
    <RecordTable
      path={['evidence']}
      title="証拠品"
      addBase="evidence"
      addValue={{ name: '新しい証拠品', description: '' }}
      columns={['ID', '名前', '説明']}
      note={ID_NOTE}
      renderRow={(_id, v, p) => {
        const e = rec(v);
        return (
          <>
            <td className="w-40 px-1">
              <TextInput path={[...p, 'name']} value={e.name} />
            </td>
            <td className="px-1">
              <TextInput multiline path={[...p, 'description']} value={e.description} />
            </td>
          </>
        );
      }}
    />
  );
}

const typeOf = (v: unknown) =>
  typeof v === 'number' ? 'number' : typeof v === 'string' ? 'string' : 'boolean';

export function FlagsTable() {
  const { set } = useSetter();
  return (
    <RecordTable
      path={['flags']}
      title="フラグ"
      addBase="flag"
      addValue={false}
      columns={['名前', '型', '初期値']}
      note="型は初期値から決まります。条件式（has(…)・seen(…) など）やステップの set / add で使います。"
      renderRow={(_id, v, p) => (
        <>
          <td className="w-32 px-1">
            <NativeSelect
              size="sm"
              className="h-8 w-28"
              value={typeOf(v)}
              aria-label="型"
              onChange={(e) =>
                set(
                  p,
                  ({ boolean: false, number: 0, string: '' } as Record<string, FlagValue>)[
                    e.target.value
                  ]!,
                )
              }
            >
              <NativeSelectOption value="boolean">真偽</NativeSelectOption>
              <NativeSelectOption value="number">数値</NativeSelectOption>
              <NativeSelectOption value="string">文字列</NativeSelectOption>
            </NativeSelect>
          </td>
          <td className="px-1">
            <FlagValueInput path={p} value={v} initial={v as FlagValue} />
          </td>
        </>
      )}
    />
  );
}
