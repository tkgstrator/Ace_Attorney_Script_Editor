// 左右のパネルの幅を変える仕切り。ドラッグか、フォーカスして ←→ キーで変える。幅はこのブラウザに覚えておく
import { useCallback, useEffect, useState } from 'react';
import { cn } from '@/lib/utils';

/** 真ん中の編集の欄に、最低限残す幅 */
export const MIN_MAIN = 480;

function load(key: string, fallback: number): number {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : fallback;
  } catch {
    return fallback;
  }
}

/** パネルの幅（min〜max。覚えておく） */
export function usePanelWidth(key: string, initial: number, min: number, max: number) {
  const [width, setWidth] = useState(() => Math.min(max, Math.max(min, load(key, initial))));
  const set = useCallback(
    (w: number) => {
      const v = Math.round(Math.min(max, Math.max(min, w)));
      setWidth(v);
      try {
        localStorage.setItem(key, String(v));
      } catch {
        /* 覚えられなくてもよい */
      }
    },
    [key, min, max],
  );
  return [width, set] as const;
}

/** ウィンドウの幅（真ん中の欄の最低幅を守るのに使う） */
export function useWindowWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const on = () => setW(window.innerWidth);
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return w;
}

/**
 * 仕切り。side: 'left' なら左のパネルの右端（右へ動かすと広がる）、'right' なら右のパネルの左端
 */
export function Resizer({
  side,
  width,
  onChange,
  min,
  max,
  label,
}: {
  side: 'left' | 'right';
  width: number;
  onChange: (w: number) => void;
  min: number;
  max: number;
  label: string;
}) {
  const [drag, setDrag] = useState<{ x: number; w: number } | null>(null);
  const sign = side === 'left' ? 1 : -1;
  return (
    // biome-ignore lint/a11y/useSemanticElements: 幅を変える仕切り（hr では操作できない）
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuenow={width}
      aria-valuemin={min}
      aria-valuemax={max}
      tabIndex={0}
      title={`${label}（ドラッグか ←→ キー）`}
      className={cn(
        'relative z-20 w-1 shrink-0 cursor-col-resize bg-transparent outline-none hover:bg-primary/30 focus-visible:bg-primary/50',
        drag && 'bg-primary/40',
      )}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        setDrag({ x: e.clientX, w: width });
      }}
      onPointerMove={(e) => {
        if (drag) onChange(drag.w + sign * (e.clientX - drag.x));
      }}
      onPointerUp={() => setDrag(null)}
      onPointerCancel={() => setDrag(null)}
      onKeyDown={(e) => {
        const step = e.shiftKey ? 64 : 16;
        if (e.key === 'ArrowLeft') onChange(width - sign * step);
        else if (e.key === 'ArrowRight') onChange(width + sign * step);
        else return;
        e.preventDefault();
      }}
    />
  );
}
