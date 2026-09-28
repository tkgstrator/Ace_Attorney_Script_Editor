// ステップ列の編集。カードの追加・差し込み・複製・削除・並べ替え（ドラッグか ↑↓）ができる。
import { type DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { pathKey } from '@/model/paths.ts';
import { visibleRows } from '@/model/step-groups.ts';
import { type CommandName, lastSpeakerBefore, profileIds, stepTemplate } from '@/model/steps.ts';
import type { Path } from '@/model/yaml-doc.ts';
import { useActions, useEditorState, useFlagValues, useIds } from '@/state/editor-store.tsx';
import { focusTarget } from '../reveal.ts';
import { useRows } from '../use-rows.ts';
import { AddStepMenu } from './AddStepMenu.tsx';
import { useFoldSerial } from './Nested.tsx';
import { StepRows } from './StepRows.tsx';
import { useViewSettings } from './view-store.ts';

/** ドラッグ中のステップ（同じ列の中でだけ動かせる） */
let dragging: { list: string; index: number } | null = null;

/** カードからの操作（列の中の位置を受け取る）。StepList ごとに 1 つ作り、変えない */
export interface StepOps {
  dragStart(index: number): void;
  dragEnd(): void;
  insertAfter(index: number, name: CommandName): void;
  insertAt(index: number, name: CommandName): void;
  /** action: 押したボタン（動かした後、同じカードの同じボタンにフォーカスを戻す） */
  move(index: number, delta: number, action?: string): void;
  duplicate(index: number): void;
  remove(index: number): void;
  /** last: 隠した行のかたまりの上なら、その最後の行（下半分に落とすと、かたまりの後ろへ） */
  dragOver(index: number, e: DragEvent<HTMLDivElement>, last?: number): void;
  /** 隠した行のかたまり（start から end まで）を開く */
  expand(start: number, end: number): void;
  drop(index: number, e: DragEvent<HTMLDivElement>): void;
}

/** 操作の後にフォーカスを移す先（列の中の位置と、カードの中のボタン。なければ最初の入力欄） */
interface FocusAfter {
  index: number;
  action?: string;
}

export function StepList({
  path: rawPath,
  steps,
  emptyLabel,
  className,
}: {
  path: Path;
  steps: unknown;
  emptyLabel?: string;
  className?: string;
}) {
  const ids = useIds();
  const flagValues = useFlagValues();
  const characters = useEditorState((s) => s.data?.characters);
  const { edit } = useActions();
  const list = Array.isArray(steps) ? steps : EMPTY;
  const rows = useRows(list);
  const key = pathKey(rawPath);
  // 描き直しのたびに新しい配列が来ても、中身が同じなら同じものを使う（カードの memo を効かせるため）
  // biome-ignore lint/correctness/useExhaustiveDependencies: key（パスの中身）が同じなら同じもの
  const path = useMemo(() => rawPath, [key]);
  const [dropAt, setDropAt] = useState<number | null>(null);
  const focusAfter = useRef<FocusAfter | null>(null);

  // 隠した種類の行のうち、開いた行（行のキー）。種類の切り替え・「すべて折りたたむ」で閉じ直す
  const { hidden } = useViewSettings();
  const foldSerial = useFoldSerial();
  const expanded = useRef(new Set<string>());
  const [, setExpandSerial] = useState(0);
  const resetBy = useRef({ hidden, foldSerial });
  if (resetBy.current.hidden !== hidden || resetBy.current.foldSerial !== foldSerial) {
    resetBy.current = { hidden, foldSerial };
    expanded.current = new Set();
  }
  // 追加した行は、隠す種類でも見せる（足したものが見えないと困る）
  const added = focusAfter.current && rows.keys[focusAfter.current.index];
  if (added && hidden.size > 0) expanded.current.add(added);
  const visible =
    hidden.size > 0 ? visibleRows(rows.items, rows.keys, hidden, expanded.current) : null;

  // 操作の関数からは、いつも最新の値を見る
  const latest = useRef({ list, ids, flagValues, characters, path, edit, rows });
  latest.current = { list, ids, flagValues, characters, path, edit, rows };

  const dropRef = useRef(dropAt);
  dropRef.current = dropAt;

  const ops = useMemo<StepOps>(() => {
    const insert = (index: number, name: CommandName) => {
      const { list: l, ids: i, flagValues: fv, characters: c, path: p, edit: e } = latest.current;
      const value = stepTemplate(name, {
        ...i,
        flagValues: fv,
        profiles: profileIds(c),
        lastSpeaker: lastSpeakerBefore(l, index),
      });
      if (e([{ op: 'insert', path: p, index, value }])) focusAfter.current = { index };
    };
    return {
      dragStart: (index) => {
        dragging = { list: key, index };
      },
      dragEnd: () => {
        dragging = null;
        setDropAt(null);
      },
      dragOver: (index, e, last = index) => {
        if (!dragging || dragging.list !== key) return;
        e.preventDefault();
        e.stopPropagation();
        const r = e.currentTarget.getBoundingClientRect();
        setDropAt(e.clientY < r.top + r.height / 2 ? index : last + 1);
      },
      drop: (index, e) => {
        if (!dragging || dragging.list !== key) return;
        e.preventDefault();
        e.stopPropagation();
        const at = dropRef.current ?? index;
        const from = dragging.index;
        const to = from < at ? at - 1 : at;
        if (from !== to) latest.current.edit([{ op: 'move', path: latest.current.path, from, to }]);
        dragging = null;
        setDropAt(null);
      },
      insertAfter: (index, name) => insert(index + 1, name),
      move: (index, delta, action) => {
        const to = index + delta;
        if (latest.current.edit([{ op: 'move', path: latest.current.path, from: index, to }]))
          focusAfter.current = { index: to, action };
      },
      duplicate: (index) => {
        const { list: l, path: p, edit: e } = latest.current;
        if (e([{ op: 'insert', path: p, index: index + 1, value: structuredClone(l[index]) }]))
          focusAfter.current = { index: index + 1 };
      },
      remove: (index) => {
        if (latest.current.edit([{ op: 'delete', path: [...latest.current.path, index] }]))
          focusAfter.current = { index: Math.max(0, index - 1), action: 'grip' };
      },
      insertAt: insert,
      expand: (start, end) => {
        const keys = latest.current.rows.keys.slice(start, end + 1);
        for (const k of keys) expanded.current.add(k);
        setExpandSerial((n) => n + 1);
        focusAfter.current = { index: start, action: 'grip' };
      },
    };
  }, [key]);

  // 追加・複製・並べ替え・隠した行を開いた後: 新しいカードの入力欄、動かしたカードの同じボタンにフォーカスする。
  // 行が隠れていれば（削除の後など）、その前の見えている行へ
  useEffect(() => {
    const f = focusAfter.current;
    if (!f) return;
    focusAfter.current = null;
    for (let i = f.index; i >= 0; i--) {
      const rowKey = rows.keys[i];
      const card = rowKey && document.querySelector<HTMLElement>(`[data-row-key="${rowKey}"]`);
      if (!card) continue;
      const action = i === f.index ? f.action : 'grip';
      const target = action
        ? document.querySelector<HTMLElement>(`[data-owner="${rowKey}"][data-action="${action}"]`)
        : focusTarget(card);
      (target ?? card).focus({ preventScroll: true });
      (target ?? card).scrollIntoView({ block: 'nearest' });
      return;
    }
  });

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: ドラッグの受け口から出たことを見るだけ
    <div
      className={cn('space-y-1', className)}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null);
      }}
    >
      {list.length === 0 && (
        <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">
          {emptyLabel ?? 'ステップがありません'}
        </div>
      )}
      <StepRows rows={rows} listPath={path} ops={ops} dropAt={dropAt} visible={visible} />
      <AddStepMenu onPick={(name) => ops.insertAt(list.length, name)} />
    </div>
  );
}

const EMPTY: unknown[] = [];
