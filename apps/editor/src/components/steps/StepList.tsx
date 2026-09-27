// ステップ列の編集。カードの追加・差し込み・複製・削除・並べ替え（ドラッグか ↑↓）ができる。
import { memo, useEffect, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import { pathKey } from '@/model/paths.ts';
import { lastSpeakerBefore, stepTemplate, type CommandName } from '@/model/steps.ts';
import type { Path } from '@/model/yaml-doc.ts';
import { useActions, useIds } from '@/state/editor-store.tsx';
import { AddStepMenu } from './AddStepMenu.tsx';
import { StepCard } from './StepCard.tsx';

/** ドラッグ中のステップ（同じ列の中でだけ動かせる） */
let dragging: { list: string; index: number } | null = null;

/** カードからの操作（列の中の位置を受け取る）。StepList ごとに 1 つ作り、変えない */
export interface StepOps {
  dragStart(index: number): void;
  dragEnd(): void;
  insertAfter(index: number, name: CommandName): void;
  move(index: number, delta: number): void;
  duplicate(index: number): void;
  remove(index: number): void;
  dragOver(index: number, e: DragEvent<HTMLDivElement>): void;
  drop(index: number, e: DragEvent<HTMLDivElement>): void;
}

export function StepList({ path: rawPath, steps, emptyLabel, className }: { path: Path; steps: unknown; emptyLabel?: string; className?: string }) {
  const ids = useIds();
  const { edit } = useActions();
  const list = Array.isArray(steps) ? steps : [];
  const key = pathKey(rawPath);
  // 描き直しのたびに新しい配列が来ても、中身が同じなら同じものを使う（カードの memo を効かせるため）
  const path = useMemo(() => rawPath, [key]);
  const [dropAt, setDropAt] = useState<number | null>(null);

  // 操作の関数からは、いつも最新の値を見る
  const latest = useRef({ list, ids, path, edit });
  latest.current = { list, ids, path, edit };

  const insert = (index: number, name: CommandName) => {
    const { list: l, ids: i, path: p, edit: e } = latest.current;
    const value = stepTemplate(name, { ...i, lastSpeaker: lastSpeakerBefore(l, index) });
    e([{ op: 'insert', path: p, index, value }]);
  };

  const dropRef = useRef(dropAt);
  dropRef.current = dropAt;

  const ops = useMemo<StepOps>(() => ({
    dragStart: index => { dragging = { list: key, index }; },
    dragEnd: () => { dragging = null; setDropAt(null); },
    dragOver: (index, e) => {
      if (!dragging || dragging.list !== key) return;
      e.preventDefault();
      e.stopPropagation();
      const r = e.currentTarget.getBoundingClientRect();
      setDropAt(e.clientY < r.top + r.height / 2 ? index : index + 1);
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
    move: (index, delta) => latest.current.edit([{ op: 'move', path: latest.current.path, from: index, to: index + delta }]),
    duplicate: index => {
      const { list: l, path: p, edit: e } = latest.current;
      e([{ op: 'insert', path: p, index: index + 1, value: structuredClone(l[index]) }]);
    },
    remove: index => latest.current.edit([{ op: 'delete', path: [...latest.current.path, index] }]),
  }), [key]);

  const lazy = list.length > LAZY_FROM;
  return (
    <div className={cn('space-y-1', className)} onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropAt(null); }}>
      {list.length === 0 && (
        <div className="rounded-md border border-dashed px-3 py-2 text-xs text-muted-foreground">{emptyLabel ?? 'ステップがありません'}</div>
      )}
      {list.map((step, i) => (
        <Row
          key={i} listPath={path} step={step} index={i} count={list.length} ops={ops} lazy={lazy && i >= EAGER}
          drop={dropAt === i ? 'top' : dropAt === i + 1 && i === list.length - 1 ? 'bottom' : null}
        />
      ))}
      <AddStepMenu onPick={name => insert(list.length, name)} />
    </div>
  );
}

/** 列の 1 行（ドロップの受け口とカード）。変わった行だけ描き直す */
const Row = memo(function Row({ listPath, step, index, count, ops, lazy, drop }: {
  listPath: Path; step: unknown; index: number; count: number; ops: StepOps; lazy: boolean; drop: 'top' | 'bottom' | null;
}) {
  const card = <StepCard listPath={listPath} step={step} index={index} count={count} ops={ops} />;
  return (
    <div onDragOver={e => ops.dragOver(index, e)} onDrop={e => ops.drop(index, e)} className="relative">
      {drop === 'top' && <DropLine top />}
      {lazy ? <Lazy pathKey={pathKey([...listPath, index])}>{card}</Lazy> : card}
      {drop === 'bottom' && <DropLine />}
    </div>
  );
});

/** これより長い列では、画面の近くに来たカードだけを作る（何百ものカードを一度に作ると開くのに何秒もかかる） */
const LAZY_FROM = 80;
/** 最初から作っておくカードの数 */
const EAGER = 30;

let observer: IntersectionObserver | null = null;
const shows = new WeakMap<Element, () => void>();
function observe(el: Element, show: () => void): () => void {
  observer ??= new IntersectionObserver(entries => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      shows.get(e.target)?.();
      observer?.unobserve(e.target);
    }
  }, { rootMargin: '1200px 0px' });
  shows.set(el, show);
  observer.observe(el);
  return () => { observer?.unobserve(el); shows.delete(el); };
}

/**
 * 画面の近くに来るまでは、高さの見積もりだけの空の箱を置く。一度作ったらそのまま。
 * 診断から開いたときのために、空の箱にも data-path を付けておく（MainPane がスクロールして光らせる）
 */
function Lazy({ pathKey: key, children }: { pathKey: string; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (shown || !box.current) return;
    return observe(box.current, () => setShown(true));
  }, [shown]);
  if (shown) return children;
  return <div ref={box} data-path={key} className="h-16 rounded-md border border-dashed" />;
}

function DropLine({ top }: { top?: boolean }) {
  return <div className={cn('pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded bg-blue-500', top ? '-top-0.5' : '-bottom-0.5')} />;
}
