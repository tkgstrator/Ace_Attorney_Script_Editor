// 人物・証拠品・フラグの表
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Fragment, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select';
import { extraRecordKeys } from '@/model/form-keys.ts';
import { pathKey, uniqueId } from '@/model/paths.ts';
import { findRefs, RECORD_TARGET } from '@/model/refs.ts';
import type { Path } from '@/model/yaml-doc.ts';
import { type FlagValue, useActions, useData, useEditorStore } from '@/state/editor-store.tsx';
import { ExtraFields } from '../ExtraFields.tsx';
import { KeyInput, NumberInput, TextInput, useSetter } from '../fields.tsx';
import { IconButton } from '../steps/StepCard.tsx';
import { FlagValueInput } from '../steps/state-fields.tsx';

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
  renderExtra,
  minWidth = 0,
  note,
  noun,
}: {
  path: ['characters' | 'evidence' | 'flags'];
  title: string;
  columns: string[];
  addValue: unknown;
  addBase: string;
  renderRow: (id: string, value: unknown, p: Path) => ReactNode;
  /** 行の下に出すもの（フォームにない項目など。なければ null） */
  renderExtra?: (id: string, value: unknown, p: Path) => ReactNode;
  /** 表の最小の幅（狭いときは横にスクロールする） */
  minWidth?: number;
  note?: ReactNode;
  /** 読み上げに使う名前（人物・証拠品・フラグ） */
  noun: string;
}) {
  const data = useData();
  const store = useEditorStore();
  const { edit, notify } = useActions();
  const map = rec(path.reduce<unknown>((o, k) => rec(o)[k], data));
  const keys = Object.keys(map);
  const target = RECORD_TARGET[path[0]]!;
  /** ID を変え、章の中の参照も書き換える */
  const rename = (from: string, to: string) => {
    const refs = findRefs(store.state.data, target, from).length;
    if (
      edit([
        { op: 'renameKey', path, from, to },
        { op: 'renameRefs', target, from, to },
      ])
    )
      notify(`${noun}の ID を ${from} → ${to} に変えました（参照 ${refs} か所も書き換え）`);
  };
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
      <div className="overflow-x-auto">
        <table className="w-full border-separate border-spacing-y-1 text-sm" style={{ minWidth }}>
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
            {keys.map((id, i) => {
              const extra = renderExtra?.(id, map[id], [...path, id]);
              return (
                <Fragment key={id}>
                  <tr className="align-top" data-path={pathKey([...path, id])}>
                    <td className="w-40 px-1">
                      <KeyInput
                        value={id}
                        taken={keys}
                        label={`${noun} ${id} の ID`}
                        onRename={(to) => rename(id, to)}
                      />
                    </td>
                    {renderRow(id, map[id], [...path, id])}
                    <td className="px-1 whitespace-nowrap">
                      <IconButton
                        title={`${id} を上へ`}
                        disabled={i === 0}
                        onClick={() => edit([{ op: 'move', path, from: i, to: i - 1 }])}
                      >
                        <ArrowUp />
                      </IconButton>
                      <IconButton
                        title={`${id} を下へ`}
                        disabled={i === keys.length - 1}
                        onClick={() => edit([{ op: 'move', path, from: i, to: i + 1 }])}
                      >
                        <ArrowDown />
                      </IconButton>
                      <IconButton
                        title={`${id} を消す`}
                        className="hover:text-destructive"
                        onClick={() => edit([{ op: 'delete', path: [...path, id] }])}
                      >
                        <Trash2 />
                      </IconButton>
                    </td>
                  </tr>
                  {extra && (
                    <tr>
                      <td />
                      <td colSpan={columns.length} className="px-1">
                        {extra}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

const ID_NOTE =
  'ID を変えると、章の中の参照（台詞の人物・つきつけ・条件式など）も書き換えます。台詞の本文の中の文中コマンド（[show …] など）は書き換えないので、右の診断で確かめてください。';

export function CharactersTable() {
  return (
    <RecordTable
      path={['characters']}
      title="人物"
      addBase="character"
      addValue={{ name: '新しい人物' }}
      noun="人物"
      columns={['ID', '名前（名前欄）', '立ち位置', '氏名（人物ファイル）', '年齢', '説明']}
      note={ID_NOTE}
      renderRow={(id, v, p) => {
        const c = rec(v);
        const prof = rec(c.profile);
        return (
          <>
            <td className="w-32 px-1">
              <TextInput
                path={[...p, 'name']}
                value={c.name}
                aria-label={`${id} の名前（名前欄）`}
              />
            </td>
            <td className="w-32 px-1">
              <TextInput
                path={[...p, 'stand']}
                value={c.stand}
                optional
                mono
                placeholder="defense など"
                aria-label={`${id} の立ち位置`}
              />
            </td>
            <td className="w-36 px-1">
              <TextInput
                path={[...p, 'profile', 'name']}
                value={prof.name}
                optional
                aria-label={`${id} の氏名（人物ファイル）`}
              />
            </td>
            <td className="w-20 px-1">
              <NumberInput
                path={[...p, 'profile', 'age']}
                value={prof.age}
                optional
                className="w-16"
                min={0}
                aria-label={`${id} の年齢`}
              />
            </td>
            <td className="px-1">
              <TextInput
                multiline
                path={[...p, 'profile', 'description']}
                value={prof.description}
                placeholder="人物ファイルの説明"
                aria-label={`${id} の説明（人物ファイル）`}
              />
            </td>
          </>
        );
      }}
      renderExtra={(_id, v, p) => {
        const c = rec(v);
        const own = extraRecordKeys(c, ['name', 'stand', 'profile']);
        const prof = extraRecordKeys(c.profile, ['name', 'age', 'description']);
        if (own.length === 0 && prof.length === 0) return null;
        return (
          <div className="flex flex-wrap gap-x-4">
            <ExtraFields path={p} value={c} keys={own} />
            <ExtraFields path={[...p, 'profile']} value={rec(c.profile)} keys={prof} />
          </div>
        );
      }}
      minWidth={880}
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
      noun="証拠品"
      columns={['ID', '名前', '説明']}
      note={ID_NOTE}
      renderRow={(id, v, p) => {
        const e = rec(v);
        return (
          <>
            <td className="w-40 px-1">
              <TextInput path={[...p, 'name']} value={e.name} aria-label={`${id} の名前`} />
            </td>
            <td className="px-1">
              <TextInput
                multiline
                path={[...p, 'description']}
                value={e.description}
                aria-label={`${id} の説明`}
              />
            </td>
          </>
        );
      }}
      renderExtra={(_id, v, p) => {
        const keys = extraRecordKeys(v, ['name', 'description']);
        return keys.length > 0 ? <ExtraFields path={p} value={rec(v)} keys={keys} /> : null;
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
      noun="フラグ"
      columns={['名前', '型', '初期値']}
      note="型は初期値から決まります。条件式やステップの set / add で使います。名前を変えると、set / add と条件式の中の参照も書き換えます。"
      renderRow={(id, v, p) => (
        <>
          <td className="w-32 px-1">
            <NativeSelect
              size="sm"
              className="h-8 w-28"
              value={typeOf(v)}
              aria-label={`${id} の型`}
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
            <FlagValueInput path={p} value={v} initial={v as FlagValue} label={`${id} の初期値`} />
          </td>
        </>
      )}
    />
  );
}
