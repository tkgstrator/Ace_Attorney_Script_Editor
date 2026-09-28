// 「調べる」範囲の編集。背景の全体（横長なら 512×192 ドットなど）を欄の幅に合わせて（縮めて、最大 2 倍で）表示し、
// ドラッグで範囲を描く・動かす・大きさを変える。範囲は背景の座標で持つ（ゲームでは背景をスクロールして調べる）。
// ポインターの位置は、実際に表示している大きさから換算する
import { type PointerEvent, useEffect, useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { useScreenWidth } from '@/preview/aspect.ts';
import { getAssets } from '@/preview/assets.ts';

export type Area = [number, number, number, number];
/** 4:3 の画面（背景の見える窓）の大きさ。絵が無いときの背景の大きさにも使う */
const SCREEN_W = 256;
const SCREEN_H = 192;
/** いちばん大きく表示するときの倍率（横長の背景は、欄の幅に収まるよう縮める） */
const MAX_SCALE = 2;
type Size = { w: number; h: number };

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

/** 範囲を背景の中に収め、整数にする */
export function normalize([x, y, w, h]: Area, { w: W, h: H }: Size): Area {
  const nx = clamp(Math.round(w < 0 ? x + w : x), 0, W - 1);
  const ny = clamp(Math.round(h < 0 ? y + h : y), 0, H - 1);
  return [
    nx,
    ny,
    clamp(Math.round(Math.abs(w)), 1, W - nx),
    clamp(Math.round(Math.abs(h)), 1, H - ny),
  ];
}

/**
 * 画面より大きい背景で、スクロールの端で見える窓（左端・右端など）の境目の線の位置。
 * screenW はプレビューの画面の幅（4:3 なら 256、16:9 なら 342。16:9 では見える窓が広い）
 */
export function screenEdges({ w, h }: Size, screenW = SCREEN_W): { x: number[]; y: number[] } {
  const cut = (size: number, screen: number) =>
    size > screen ? [...new Set([screen, size - screen])].filter((v) => v > 0 && v < size) : [];
  return { x: cut(w, screenW), y: cut(h, SCREEN_H) };
}

export function AreaCanvas({ background, items, selected, onSelect, onChange, onCreate }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const screenW = useScreenWidth();
  const [drag, setDrag] = useState<Drag | null>(null);
  const [hasImage, setHasImage] = useState(true);
  const [image, setImage] = useState<CanvasImageSource | null>(null);
  // 背景の大きさ（絵の大きさ。絵が無ければ画面の大きさ）
  const size = imageSize(image);
  const { w: W, h: H } = size;

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    void getAssets().then((a) => {
      // 番号の背景（bg12 など）は読み込み中は undefined なので、少しの間は待ち直す
      const load = (tries: number) => {
        if (!alive) return;
        const img = a.background?.(background);
        if (img === undefined && tries > 0) {
          timer = setTimeout(() => load(tries - 1), 150);
          return;
        }
        setHasImage(img !== undefined);
        setImage(img ?? null);
      };
      load(20);
    });
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [background]);

  // 大きさが変わるとキャンバスが作り直されるので、描くのは大きさが決まった後
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#9ca3af';
    ctx.fillRect(0, 0, W, H);
    if (image) ctx.drawImage(image, 0, 0, W, H);
  }, [image, W, H]);

  const point = (e: PointerEvent): [number, number] => {
    const r = e.currentTarget.getBoundingClientRect();
    return [
      clamp(((e.clientX - r.left) / r.width) * W, 0, W),
      clamp(((e.clientY - r.top) / r.height) * H, 0, H),
    ];
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
    const area = normalize(drag.area, size);
    if (drag.mode === 'draw') {
      if (area[2] >= 4 && area[3] >= 4) onCreate(area);
    } else if (area.some((v, k) => v !== drag.origin[k])) {
      onChange(drag.index, area);
    }
    setDrag(null);
  };

  const edges = screenEdges(size, screenW);
  const shown = items.map((it, i) =>
    drag && drag.mode !== 'draw' && drag.index === i
      ? { ...it, area: normalize(drag.area, size) }
      : it,
  );

  return (
    <div
      className="relative w-full select-none rounded border bg-muted"
      style={{ maxWidth: W * MAX_SCALE, aspectRatio: `${W} / ${H}` }}
      data-size={`${W}x${H}`}
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
        role="img"
        aria-label={`調べる範囲（背景 ${W}×${H} ドットの座標。ドラッグで描く・動かす。下の一覧でも数値で変えられます）`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onPointerCancel={() => setDrag(null)}
      >
        {/* 画面より大きい背景: スクロールの端で見える窓の境目 */}
        {edges.x.map((x) => (
          <line
            key={`x${x}`}
            x1={x}
            x2={x}
            y1={0}
            y2={H}
            className="pointer-events-none stroke-white/70"
            strokeWidth={0.75}
            strokeDasharray="3 2"
          />
        ))}
        {edges.y.map((y) => (
          <line
            key={`y${y}`}
            x1={0}
            x2={W}
            y1={y}
            y2={y}
            className="pointer-events-none stroke-white/70"
            strokeWidth={0.75}
            strokeDasharray="3 2"
          />
        ))}
        {shown.map((it, i) => {
          const [x, y, w, h] = it.area;
          const on = i === selected;
          return (
            // biome-ignore lint/suspicious/noArrayIndexKey: 範囲は一覧の順番そのもの（data-area と同じ）
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
            const [x, y, w, h] = normalize(drag.area, size);
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

function imageSize(img: CanvasImageSource | null): Size {
  const i = img as { width?: number; height?: number } | null;
  return i?.width && i.height ? { w: i.width, h: i.height } : { w: SCREEN_W, h: SCREEN_H };
}
