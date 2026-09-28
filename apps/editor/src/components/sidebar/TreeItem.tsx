// 左の一覧の 1 行。選ぶボタン・（あれば）開閉ボタン・操作メニューを並べる（どれもキーボードで届く）
import { ChevronDown, ChevronRight, MoreHorizontal } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { Selection } from '@/model/paths.ts';
import { useActions, useEditorState } from '@/state/editor-store.tsx';
import { LazyMenu } from '../lazy-menu.tsx';

/** 項目ごとの診断の数（キーは selectionKey） */
export type IssueCounts = Map<string, { errors: number; warnings: number }>;

export const selectionKey = (s: Selection) => JSON.stringify(s);

// 一覧の項目それぞれが「選ばれているか」を調べるので、今の選択のキーは 1 回だけ作る
const keys = new WeakMap<Selection, string>();
function cachedKey(s: Selection): string {
  const hit = keys.get(s);
  if (hit !== undefined) return hit;
  const k = selectionKey(s);
  keys.set(s, k);
  return k;
}

export function Item({
  sel,
  icon,
  label,
  name,
  count,
  issues,
  actions,
  depth = 0,
  className,
  expanded,
  onToggle,
}: {
  sel: Selection;
  icon: ReactNode;
  label: ReactNode;
  /** 読み上げ・メニューに使う名前 */
  name: string;
  count?: number;
  issues: IssueCounts;
  actions?: ReactNode;
  depth?: number;
  className?: string;
  /** 開閉できる行なら、開いているか */
  expanded?: boolean;
  onToggle?: () => void;
}) {
  const { select } = useActions();
  const key = selectionKey(sel);
  const active = useEditorState((s) => cachedKey(s.selection) === key);
  const n = issues.get(key);
  const Toggle = expanded ? ChevronDown : ChevronRight;
  return (
    <div
      className={cn(
        'group/item flex h-7 items-center gap-0.5 rounded-md pr-1',
        active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
        className,
      )}
      style={{ paddingLeft: 4 + depth * 14 }}
    >
      {onToggle && (
        <button
          type="button"
          className="rounded p-0.5 opacity-70 outline-none hover:opacity-100 focus-visible:ring-2 focus-visible:ring-ring"
          aria-expanded={expanded}
          aria-label={`${name}を${expanded ? '閉じる' : '開く'}`}
          onClick={onToggle}
        >
          <Toggle className="size-4" />
        </button>
      )}
      <button
        type="button"
        className="flex h-full min-w-0 flex-1 items-center gap-1.5 rounded pl-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring [&>svg]:size-4 [&>svg]:shrink-0"
        aria-current={active ? 'page' : undefined}
        onClick={() => select(sel)}
      >
        {icon}
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {n && n.errors > 0 && (
          <span className="rounded bg-destructive px-1 text-[10px] text-white">
            <span className="sr-only">エラー </span>
            {n.errors}
          </span>
        )}
        {n && n.errors === 0 && n.warnings > 0 && (
          <span className="rounded bg-amber-600 px-1 text-[10px] text-white">
            <span className="sr-only">警告 </span>
            {n.warnings}
          </span>
        )}
        {count !== undefined && (
          <span
            className={cn(
              'text-xs',
              active ? 'text-primary-foreground/80' : 'text-muted-foreground',
            )}
          >
            {count}
          </span>
        )}
      </button>
      {actions}
    </div>
  );
}

/** 項目ごとの操作メニュー（押されるまでメニューを作らない）。マウスが乗るかフォーカスが入ると見える */
export function Menu({ name, children }: { name: string; children: ReactNode }) {
  return (
    <LazyMenu
      className="w-48"
      trigger={(open) => (
        <Button
          variant="ghost"
          size="icon"
          className="size-6 opacity-0 group-focus-within/item:opacity-100 group-hover/item:opacity-100 focus-visible:opacity-100 data-[state=open]:opacity-100"
          title={`${name}の操作`}
          aria-label={`${name}の操作`}
          onClick={open}
        >
          <MoreHorizontal />
        </Button>
      )}
    >
      {children}
    </LazyMenu>
  );
}
