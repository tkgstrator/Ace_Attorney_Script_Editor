// 「調べる」範囲の編集。背景（256×192 ドット）を 2 倍で表示し、ドラッグで範囲を描く・動かす・大きさを変える。
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { cn } from '@/lib/utils';
import { getAssets } from '@/preview/assets.ts';

export type Area = [number, number, number, number];
const W = 256;
const H = 192;
const SCALE = 2;

export interface AreaItem {
  area: Area;
  label: string;
}

interface Props {
  background: string;
  items: AreaItem[];
  selected: number | null;
  onSelect: (i: number | null) => void;
  /** ドラッグを終えたときに 1 回だけ呼ぶ */
  onChange: (i: number, area: Area) => void;
  onCreate: (area: Area) => void;
}

type Drag =
  | { mode: 'move' | 'resize'; index: number; start: [number, number]; origin: Area; area: Area }
  | { mode: 'draw'; start: [number, number]; area: Area };

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** 範囲を画面の中に収め、整数にする */
function normalize([x, y, w, h]: Area): Area {
  const nx = clamp(Math.round(w < 0 ? x + w : x), 0, W - 1);
  const ny = clamp(Math.round(h < 0 ? y + h : y), 0, H - 1);
  return [
    nx,
    ny,
    clamp(Math.round(Math.abs(w)), 1, W - nx),
    clamp(Math.round(Math.abs(h)), 1, H - ny),
  ];
}

export function AreaCanvas({ background, items, selected, onSelect, onChange, onCreate }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hasImage, setHasImage] = useState(true);

  useEffect(() => {
    let alive = true;
    void getAssets().then((a) => {
      const ctx = canvas.current?.getContext('2d');
      if (!alive || !ctx) return;
      ctx.imageSmoothingEnabled = false;
      ctx.fillStyle = '#9ca3af';
      ctx.fillRect(0, 0, W, H);
      const img = a.background?.(background);
      setHasImage(img !== undefined);
      if (img) ctx.drawImage(img, 0, 0, W, H);
    });
    return () => {
      alive = false;
    };
  }, [background]);

  const point = (e: PointerEvent): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [clamp((e.clientX - r.left) / SCALE, 0, W), clamp((e.clientY - r.top) / SCALE, 0, H)];
  };

  const onDown = (e: PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const p = point(e);
    e.currentTarget.setPointerCapture(e.pointerId);
    const target = (e.target as Element).closest('[data-area]');
    const handle = (e.target as Element).closest('[data-handle]');
    if (target) {
      const index = Number(target.getAttribute('data-area'));
      const origin = items[index]!.area;
      onSelect(index);
      setDrag({ mode: handle ? 'resize' : 'move', index, start: p, origin, area: origin });
    } else {
      onSelect(null);
      setDrag({ mode: 'draw', start: p, area: [p[0], p[1], 0, 0] });
    }
  };

  const onMove = (e: PointerEvent<SVGSVGElement>) => {
    if (!drag) return;
    const [px, py] = point(e);
    const dx = px - drag.start[0];
    const dy = py - drag.start[1];
    if (drag.mode === 'draw') {
      setDrag({ ...drag, area: [drag.start[0], drag.start[1], dx, dy] });
    } else if (drag.mode === 'move') {
      const [x, y, w, h] = drag.origin;
      setDrag({
        ...drag,
        area: [clamp(Math.round(x + dx), 0, W - w), clamp(Math.round(y + dy), 0, H - h), w, h],
      });
    } else {
      const [x, y, w, h] = drag.origin;
      setDrag({ ...drag, area: [x, y, Math.max(1, w + dx), Math.max(1, h + dy)] });
    }
  };

  const onUp = () => {
    if (!drag) return;
    const area = normalize(drag.area);
    if (drag.mode === 'draw') {
      if (area[2] >= 4 && area[3] >= 4) onCreate(area);
    } else if (area.some((v, k) => v !== drag.origin[k])) {
      onChange(drag.index, area);
    }
    setDrag(null);
  };

  const shown = items.map((it, i) =>
    drag && drag.mode !== 'draw' && drag.index === i ? { ...it, area: normalize(drag.area) } : it,
  );

  return (
    <div
      className="relative w-fit select-none rounded border bg-muted"
      style={{ width: W * SCALE, height: H * SCALE }}
    >
      <canvas
        ref={canvas}
        width={W}
        height={H}
        className="absolute inset-0 size-full [image-rendering:pixelated]"
      />
      {!hasImage && (
        <div className="absolute inset-0 grid place-items-center text-xs text-white/80">
          背景「{background}」の絵がありません
        </div>
      )}
      <svg
        className="absolute inset-0 size-full cursor-crosshair"
        viewBox={`0 0 ${W} ${H}`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
      >
        {shown.map((it, i) => {
          const [x, y, w, h] = it.area;
          const on = i === selected;
          return (
            <g key={i} data-area={i} className="cursor-move">
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                strokeWidth={on ? 1 : 0.75}
                className={cn(
                  on ? 'fill-amber-400/30 stroke-amber-400' : 'fill-sky-400/15 stroke-sky-300',
                )}
              />
              <text
                x={x + 2}
                y={y + 7}
                className="fill-white text-[6px] font-bold"
                style={{ paintOrder: 'stroke', stroke: '#000', strokeWidth: 1.5 }}
              >
                {i + 1}. {it.label}
              </text>
              {on && (
                <rect
                  data-handle
                  x={x + w - 4}
                  y={y + h - 4}
                  width={5}
                  height={5}
                  className="cursor-nwse-resize fill-amber-400"
                />
              )}
            </g>
          );
        })}
        {drag?.mode === 'draw' &&
          (() => {
            const [x, y, w, h] = normalize(drag.area);
            return (
              <rect
                x={x}
                y={y}
                width={w}
                height={h}
                className="fill-emerald-400/25 stroke-emerald-400"
                strokeWidth={0.75}
                strokeDasharray="2 1"
              />
            );
          })()}
      </svg>
    </div>
  );
}
