// ステップ列の行（ドロップの受け口とカード）。長い列では、行を CHUNK 個ずつのまとまりにして、
// 1 文字の編集で描き直すのを、変わった行のあるまとまりだけにする。遠くの行は空の箱にしておく（Lazy）。
// 隠した種類の連続する行は、1 行（FoldRow）にまとめる
import { memo, type ReactNode, useEffect, useRef, useState } from 'react';
import { pathKey } from '@/model/paths.ts';
import type { Rows } from '@/model/row-keys.ts';
import { chunkRanges, foldUnits } from '@/model/step-groups.ts';
import type { Path } from '@/model/yaml-doc.ts';
import { useRevealListener } from '../reveal.ts';
import { DropLine, FoldRow } from './FoldRow.tsx';
import { StepCard } from './StepCard.tsx';
import type { StepOps } from './StepList.tsx';

/** 1 つのまとまりの行の数 */
const CHUNK = 40;

export function StepRows({
  rows,
  listPath,
  ops,
  dropAt,
  visible,
}: {
  rows: Rows<unknown>;
  listPath: Path;
  ops: StepOps;
  dropAt: number | null;
  /** 行ごとに見せるか（null ならすべて見せる） */
  visible: boolean[] | null;
}) {
  const count = rows.items.length;
  const lazy = count > LAZY_FROM;
  const ranges: [number, number][] = [];
  if (visible) ranges.push(...chunkRanges(visible, CHUNK));
  else for (let s = 0; s < count; s += CHUNK) ranges.push([s, Math.min(count, s + CHUNK)]);
  return ranges.map(([start, end]) => (
    <Chunk
      key={start}
      start={start}
      items={rows.items.slice(start, end)}
      keys={rows.keys.slice(start, end)}
      vis={
        visible
          ? visible
              .slice(start, end)
              .map((v) => (v ? '1' : '0'))
              .join('')
          : ''
      }
      count={count}
      listPath={listPath}
      ops={ops}
      lazy={lazy}
      dropAt={dropAt !== null && dropAt >= start && dropAt <= end ? dropAt : null}
    />
  ));
}

interface ChunkProps {
  start: number;
  items: unknown[];
  keys: string[];
  /** 行ごとに見せるか（'1' / '0'）。空ならすべて見せる */
  vis: string;
  count: number;
  listPath: Path;
  ops: StepOps;
  lazy: boolean;
  dropAt: number | null;
}

const sameItems = (a: unknown[], b: unknown[]) =>
  a.length === b.length && a.every((x, i) => x === b[i]);

const Chunk = memo(
  function Chunk({ start, items, keys, vis, count, listPath, ops, lazy, dropAt }: ChunkProps) {
    const units = vis
      ? foldUnits(
          [...vis].map((c) => c === '1'),
          start,
        )
      : items.map((_, k) => ({ row: start + k }));
    return units.map((u) => {
      if ('fold' in u) {
        const [a, b] = u.fold;
        return (
          <FoldRow
            key={`fold-${keys[a - start]}`}
            listPath={listPath}
            start={a}
            end={b}
            items={items.slice(a - start, b - start + 1)}
            ops={ops}
            drop={dropAt === a ? 'top' : dropAt === b + 1 && b === count - 1 ? 'bottom' : null}
          />
        );
      }
      const i = u.row;
      const k = i - start;
      return (
        <Row
          key={keys[k]}
          rowKey={keys[k]!}
          listPath={listPath}
          step={items[k]}
          index={i}
          count={count}
          ops={ops}
          lazy={lazy && i >= EAGER}
          drop={dropAt === i ? 'top' : dropAt === i + 1 && i === count - 1 ? 'bottom' : null}
        />
      );
    });
  },
  (a, b) =>
    a.start === b.start &&
    a.count === b.count &&
    a.vis === b.vis &&
    a.listPath === b.listPath &&
    a.ops === b.ops &&
    a.lazy === b.lazy &&
    a.dropAt === b.dropAt &&
    sameItems(a.items, b.items) &&
    sameItems(a.keys, b.keys),
);

/** 列の 1 行（ドロップの受け口とカード）。変わった行だけ描き直す */
const Row = memo(function Row({
  listPath,
  step,
  index,
  count,
  ops,
  lazy,
  drop,
  rowKey,
}: {
  listPath: Path;
  step: unknown;
  index: number;
  count: number;
  ops: StepOps;
  lazy: boolean;
  drop: 'top' | 'bottom' | null;
  rowKey: string;
}) {
  const card = (
    <StepCard
      listPath={listPath}
      step={step}
      index={index}
      count={count}
      ops={ops}
      rowKey={rowKey}
    />
  );
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: ドラッグの受け口
    <div
      onDragOver={(e) => ops.dragOver(index, e)}
      onDrop={(e) => ops.drop(index, e)}
      className="relative"
    >
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

/** 画面の近くに来た・離れたことを知らせる（1 つの IntersectionObserver を使い回す） */
let observer: IntersectionObserver | null = null;
const handlers = new WeakMap<Element, (near: boolean, height: number) => void>();
function observe(el: Element, fn: (near: boolean, height: number) => void): () => void {
  observer ??= new IntersectionObserver(
    (entries) => {
      for (const e of entries)
        handlers.get(e.target)?.(e.isIntersecting, e.boundingClientRect.height);
    },
    { rootMargin: '1500px 0px' },
  );
  handlers.set(el, fn);
  observer.observe(el);
  return () => {
    observer?.unobserve(el);
    handlers.delete(el);
  };
}

/**
 * 画面の近くに来るまでは、高さの見積もりだけの空の箱を置く。遠く離れたら、また空の箱に戻す
 * （フォーカスがある・未反映の入力がある・メニューを開いているカードは戻さない）。
 * 診断から開いたときのために、空の箱にも data-path を付け、editor:reveal で作る（reveal.ts）
 */
function Lazy({ pathKey: key, children }: { pathKey: string; children: ReactNode }) {
  const [shown, setShown] = useState(false);
  const height = useRef(64);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    return observe(el, (near, h) => {
      if (near) {
        setShown(true);
        return;
      }
      const busy =
        el.contains(document.activeElement) ||
        el.querySelector('[aria-invalid="true"], [aria-expanded="true"]') !== null ||
        el.matches(':hover');
      if (busy) return;
      if (h > 0) height.current = h;
      setShown(false);
    });
  }, []);
  const reveal = useRevealListener<HTMLDivElement>(!shown, () => setShown(true));
  if (shown) return <div ref={box}>{children}</div>;
  return (
    <div ref={box}>
      <div
        ref={reveal}
        data-path={key}
        data-reveal=""
        className="rounded-md border border-dashed"
        style={{ height: height.current }}
      />
    </div>
  );
}
