// 隠した種類の、連続するステップをまとめた 1 行（「演出 3」）。押すと、そのかたまりだけ開く。
// 診断・検索から中のステップへ飛んだときのために、中の行の data-path を持ち、editor:reveal で開く（reveal.ts）
import { ChevronRight } from 'lucide-react';
import { memo } from 'react';
import { cn } from '@/lib/utils';
import { pathKey } from '@/model/paths.ts';
import { foldLabel } from '@/model/step-groups.ts';
import { stepSummary } from '@/model/steps.ts';
import type { Path } from '@/model/yaml-doc.ts';
import { useRevealListener } from '../reveal.ts';
import type { StepOps } from './StepList.tsx';

export const FoldRow = memo(function FoldRow({
  listPath,
  start,
  end,
  items,
  ops,
  drop,
}: {
  listPath: Path;
  start: number;
  end: number;
  items: unknown[];
  ops: StepOps;
  drop: 'top' | 'bottom' | null;
}) {
  const reveal = useRevealListener<HTMLButtonElement>(true, () => ops.expand(start, end));
  const label = foldLabel(items);
  const n = end - start + 1;
  const range = n === 1 ? `${start + 1}` : `${start + 1}〜${end + 1}`;
  const preview = items
    .slice(0, 5)
    .map((s) => stepSummary(s))
    .join('\n');
  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: ドラッグの受け口
    <div
      className="relative"
      onDragOver={(e) => ops.dragOver(start, e, end)}
      onDrop={(e) => ops.drop(start, e)}
    >
      {drop === 'top' && <DropLine top />}
      <button
        ref={reveal}
        type="button"
        data-reveal=""
        className="flex w-full items-center gap-1 rounded border border-dashed px-2 py-0.5 text-left text-[11px] text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        title={`${preview}${n > 5 ? `\n…ほか ${n - 5} 件` : ''}\n\n押すと、このかたまりだけ開きます`}
        aria-label={`隠れているステップ ${range}（${label}、${n} 件）を開く`}
        onClick={() => ops.expand(start, end)}
      >
        <ChevronRight className="size-3" />
        <span className="w-14 shrink-0 tabular-nums">{range}</span>
        <span className="truncate">
          {label}（{n} 件）
        </span>
        {Array.from({ length: n }, (_, k) => pathKey([...listPath, start + k])).map((key) => (
          <span key={key} hidden data-path={key} />
        ))}
      </button>
      {drop === 'bottom' && <DropLine />}
    </div>
  );
});

/** ドロップする位置の線 */
export function DropLine({ top }: { top?: boolean }) {
  return (
    <div
      className={cn(
        'pointer-events-none absolute inset-x-0 z-10 h-0.5 rounded bg-blue-500',
        top ? '-top-0.5' : '-bottom-0.5',
      )}
    />
  );
}
