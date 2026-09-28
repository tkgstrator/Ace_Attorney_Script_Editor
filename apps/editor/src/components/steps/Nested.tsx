// 入れ子のステップ列の枠（左に線を引いて、見出しを付ける）。折りたたむと、中のステップの要約を 1〜3 行だけ出す。
// 「すべて折りたたむ・開く」は foldAll で全部の枠に伝える
import { ChevronDown, ChevronRight } from 'lucide-react';
import { type ReactNode, useRef, useState, useSyncExternalStore } from 'react';
import { pathKey } from '@/model/paths.ts';
import { stepGroup } from '@/model/step-groups.ts';
import { stepSummary } from '@/model/steps.ts';
import type { Path } from '@/model/yaml-doc.ts';
import { useRevealListener } from '../reveal.ts';
import { useViewSettings } from './view-store.ts';

let signal = { serial: 0, open: true };
/** 「すべて折りたたむ」を押した回数（隠した種類の開いたかたまりも閉じ直す） */
let closeSerial = 0;
const listeners = new Set<() => void>();
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

/** 入れ子の枠をすべて折りたたむ（open = false）・開く */
export function foldAll(open: boolean): void {
  signal = { serial: signal.serial + 1, open };
  if (!open) closeSerial++;
  for (const fn of listeners) fn();
}

/** これから作る枠も開いた状態にする（別のシーンを開いたとき） */
export function resetFold(): void {
  if (!signal.open) signal = { serial: signal.serial, open: true };
}

export const foldState = () => signal.open;

/** 「すべて折りたたむ」を押すたびに変わる数 */
export function useFoldSerial(): number {
  return useSyncExternalStore(subscribe, () => closeSerial);
}

function useFold(): [boolean, (o: boolean) => void] {
  const [open, setOpen] = useState(() => signal.open);
  const s = useSyncExternalStore(subscribe, () => signal);
  const seen = useRef(s.serial);
  if (seen.current !== s.serial) {
    seen.current = s.serial;
    if (open !== s.open) setOpen(s.open);
  }
  return [open, setOpen];
}

export function Nested({
  label,
  children,
  actions,
  path,
  steps,
}: {
  label: ReactNode;
  children: ReactNode;
  actions?: ReactNode;
  /** 中の列のパス（診断から開いたとき、折りたたんでいれば開く） */
  path?: Path;
  /** 折りたたんだときに要約を出すステップ列 */
  steps?: unknown;
}) {
  const [open, setOpen] = useFold();
  const box = useRevealListener<HTMLDivElement>(!open, () => setOpen(true));
  const list = Array.isArray(steps) ? steps : [];
  // 折りたたんだときの要約には、隠した種類のステップを出さない
  const { hidden } = useViewSettings();
  const summary = open
    ? []
    : list.filter((s) => {
        const g = stepGroup(s);
        return g === null || !hidden.has(g);
      });
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <div
      ref={box}
      className="mt-1 border-l-2 border-muted pl-2"
      data-path={path ? pathKey(path) : undefined}
      data-reveal={open ? undefined : ''}
    >
      <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        <button
          type="button"
          className="-ml-1 flex items-center gap-0.5 rounded px-0.5 hover:bg-accent hover:text-foreground"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          <Icon className="size-3.5" />
          {label}
          {!open && steps !== undefined && (
            <span className="font-normal">（{list.length} ステップ）</span>
          )}
        </button>
        <div className="ml-auto flex items-center">{actions}</div>
      </div>
      {open ? (
        children
      ) : (
        <ul className="mb-1 space-y-0.5 text-[11px] text-muted-foreground">
          {summary.slice(0, 3).map((s, i) => (
            // biome-ignore lint/suspicious/noArrayIndexKey: 並べ替えない読むだけの要約
            <li key={i} className="truncate">
              {stepSummary(s)}
            </li>
          ))}
          {list.length > Math.min(3, summary.length) && (
            <li>…ほか {list.length - Math.min(3, summary.length)} ステップ</li>
          )}
        </ul>
      )}
    </div>
  );
}
