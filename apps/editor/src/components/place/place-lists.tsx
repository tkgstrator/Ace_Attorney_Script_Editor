// 場所の「調べる」「話す」「移動する」の一覧
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { Path } from '@/model/yaml-doc.ts';
import { useActions, useIds } from '@/state/editor-store.tsx';
import { CondInput, IdSelect, TextInput, useSetter } from '../fields.tsx';
import { Nested } from '../steps/flow-fields.tsx';
import { IconButton } from '../steps/StepCard.tsx';
import { StepList } from '../steps/StepList.tsx';
import type { Area } from './AreaCanvas.tsx';

type Rec = Record<string, unknown>;

function ItemTools({ listPath, i, count }: { listPath: Path; i: number; count: number }) {
  const { edit } = useActions();
  return (
    <div className="ml-auto flex shrink-0">
      <IconButton
        title="上へ"
        disabled={i === 0}
        onClick={() => edit([{ op: 'move', path: listPath, from: i, to: i - 1 }])}
      >
        <ArrowUp />
      </IconButton>
      <IconButton
        title="下へ"
        disabled={i === count - 1}
        onClick={() => edit([{ op: 'move', path: listPath, from: i, to: i + 1 }])}
      >
        <ArrowDown />
      </IconButton>
      <IconButton
        title="消す"
        className="hover:text-destructive"
        onClick={() => edit([{ op: 'delete', path: [...listPath, i] }])}
      >
        <Trash2 />
      </IconButton>
    </div>
  );
}

export const asArea = (v: unknown): Area => {
  const a = Array.isArray(v) ? v.map(Number) : [];
  return [a[0] ?? 0, a[1] ?? 0, a[2] ?? 16, a[3] ?? 16];
};

export function ExamineList({
  path,
  items,
  selected,
  onSelect,
}: {
  path: Path;
  items: Rec[];
  selected: number | null;
  onSelect: (i: number) => void;
}) {
  const { set } = useSetter();
  return (
    <div className="space-y-2">
      {items.map((it, i) => {
        const p = [...path, i];
        const area = asArea(it.area);
        return (
          <div
            key={i}
            data-path={JSON.stringify(p)}
            onFocusCapture={() => onSelect(i)}
            onClick={() => onSelect(i)}
            className={cn(
              'rounded-lg border bg-card p-2 shadow-xs',
              i === selected && 'ring-2 ring-amber-400',
            )}
          >
            <div className="flex flex-wrap items-center gap-1">
              <span className="text-xs font-semibold">{i + 1}.</span>
              <TextInput
                path={[...p, 'name']}
                value={it.name}
                optional
                className="w-40"
                placeholder="表示名（エディタ用）"
                aria-label="表示名"
              />
              <TextInput
                path={[...p, 'id']}
                value={it.id}
                optional
                mono
                className="w-32"
                placeholder="ID（省略可）"
                aria-label="ID"
              />
              <span className="ml-1 text-[11px] text-muted-foreground">範囲</span>
              {(['x', 'y', '幅', '高さ'] as const).map((label, k) => (
                <Input
                  key={label}
                  type="number"
                  title={label}
                  aria-label={label}
                  className="h-8 w-16 px-1.5 text-xs"
                  value={area[k]}
                  onChange={(e) => {
                    const next = [...area] as Area;
                    next[k] = Number(e.target.value) || 0;
                    set([...p, 'area'], next, true);
                  }}
                />
              ))}
              <ItemTools listPath={path} i={i} count={items.length} />
            </div>
            <CondInput
              path={[...p, 'when']}
              value={it.when}
              optional
              className="mt-1"
              placeholder="調べられる条件（省略可）"
              aria-label="条件"
            />
            <Nested label="調べたとき">
              <StepList path={[...p, 'then']} steps={it.then} />
            </Nested>
          </div>
        );
      })}
    </div>
  );
}

export function TalkList({ path, items }: { path: Path; items: Rec[] }) {
  const { edit } = useActions();
  return (
    <div className="space-y-2">
      {items.map((it, i) => {
        const p = [...path, i];
        return (
          <div
            key={i}
            className="rounded-lg border bg-card p-2 shadow-xs"
            data-path={JSON.stringify(p)}
          >
            <div className="flex items-center gap-1">
              <span className="text-xs font-semibold">{i + 1}.</span>
              <TextInput
                path={[...p, 'topic']}
                value={it.topic}
                placeholder="話題"
                aria-label="話題"
              />
              <TextInput
                path={[...p, 'id']}
                value={it.id}
                optional
                mono
                className="w-32"
                placeholder="ID（省略可）"
                aria-label="ID"
              />
              <ItemTools listPath={path} i={i} count={items.length} />
            </div>
            <CondInput
              path={[...p, 'when']}
              value={it.when}
              optional
              className="mt-1"
              placeholder="話題に出る条件（例: seen(night)）"
              aria-label="条件"
            />
            <Nested label="話したとき">
              <StepList path={[...p, 'then']} steps={it.then} />
            </Nested>
          </div>
        );
      })}
      <Button
        variant="outline"
        size="sm"
        className="h-7"
        onClick={() =>
          edit([{ op: 'insert', path, value: { topic: `話題 ${items.length + 1}`, then: [] } }])
        }
      >
        <Plus /> 話題を追加
      </Button>
    </div>
  );
}

/** 行き先。条件がなければ ID だけ、あれば { to, when } の形で書く */
export function MoveList({ path, items, self }: { path: Path; items: unknown[]; self: string }) {
  const ids = useIds();
  const { edit } = useActions();
  const { set } = useSetter();
  const options = ids.places.filter((p) => p !== self);
  return (
    <div className="space-y-1">
      {items.map((it, i) => {
        const p = [...path, i];
        const obj = typeof it === 'object' && it !== null ? (it as Rec) : null;
        const to = obj ? obj.to : it;
        const when = obj && typeof obj.when === 'string' ? obj.when : '';
        return (
          <div key={i} className="flex items-center gap-1" data-path={JSON.stringify(p)}>
            <IdSelect
              value={to}
              options={options}
              aria-label="行き先"
              onChange={(v) => {
                if (v) set(obj ? [...p, 'to'] : p, v);
              }}
            />
            <Input
              className="h-8 font-mono text-xs"
              value={when}
              placeholder="行ける条件（省略可）"
              aria-label="条件"
              onChange={(e) => {
                const w = e.target.value;
                if (w === '') set(p, to);
                else if (obj) set([...p, 'when'], w, true);
                else set(p, { to, when: w }, true);
              }}
            />
            <ItemTools listPath={path} i={i} count={items.length} />
          </div>
        );
      })}
      {options.length > 0 && (
        <Button
          variant="outline"
          size="sm"
          className="h-7"
          onClick={() =>
            edit([
              { op: 'insert', path, value: options.find((o) => !items.includes(o)) ?? options[0] },
            ])
          }
        >
          <Plus /> 行き先を追加
        </Button>
      )}
    </div>
  );
}
