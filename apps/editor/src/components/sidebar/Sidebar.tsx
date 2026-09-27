// 左の一覧: 章の選択と、基本情報・人物・証拠品・フラグ・各編（シーン・場所）のツリー
import {
  BookOpen, ChevronDown, ChevronRight, Code2, Flag, Gavel, MapPin, MessageSquareQuote, MessagesSquare, MoreHorizontal, Package,
  Plus, Search, Users,
} from 'lucide-react';
import { memo, useState, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Selection } from '@/model/paths.ts';
import { PART_LABELS } from '@/model/structure.ts';
import { useActions, useEditorState, useEditorStore, useIds } from '@/state/editor-store.tsx';
import type { TreePart } from '@/state/store.ts';
import * as A from './actions.ts';
import { ChapterPicker } from './ChapterPicker.tsx';

/** 項目ごとの診断の数（キーは selectionKey） */
export type IssueCounts = Map<string, { errors: number; warnings: number }>;

export const selectionKey = (s: Selection) => JSON.stringify(s);

// 一覧の項目それぞれが「選ばれているか」を調べるので、今の選択のキーは 1 回だけ作る
const keys = new WeakMap<Selection, string>();
function cachedKey(s: Selection): string {
  let k = keys.get(s);
  if (k === undefined) keys.set(s, k = selectionKey(s));
  return k;
}

/** 1 文字打つたびには描き直さない（一覧に出すもの tree・件数・診断の数が変わったときだけ） */
export const Sidebar = memo(function Sidebar({ issues }: { issues: IssueCounts }) {
  const store = useEditorStore();
  const parts = useEditorState(s => s.tree);
  const hasData = useEditorState(s => s.data !== null);
  const ids = useIds();
  const api = () => store.api();
  const hasLegacy = parts.some(p => p.index === null);
  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r bg-muted/30">
      <ChapterPicker />
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2 text-sm">
        {hasData && (
          <>
            <Item sel={{ kind: 'meta' }} icon={<BookOpen />} label="基本情報" issues={issues} />
            <Item sel={{ kind: 'characters' }} icon={<Users />} label="人物" count={ids.characters.length} issues={issues} />
            <Item sel={{ kind: 'evidence' }} icon={<Package />} label="証拠品" count={ids.evidence.length} issues={issues} />
            <Item sel={{ kind: 'flags' }} icon={<Flag />} label="フラグ" count={ids.flags.length} issues={issues} />
            <div className="h-2" />
            {parts.map(p => <PartNode key={p.index ?? 'legacy'} part={p} total={parts.filter(x => x.index !== null).length} issues={issues} />)}
            <div className="flex gap-1 pt-2">
              <Button variant="outline" size="sm" className="h-7 flex-1 text-xs" onClick={() => A.addPart(api(), 'investigation')}>
                <Plus /> 探索編
              </Button>
              <Button variant="outline" size="sm" className="h-7 flex-1 text-xs" onClick={() => A.addPart(api(), 'trial')}>
                <Plus /> 裁判編
              </Button>
            </div>
            {hasLegacy && (
              <p className="px-1 pt-1 text-[11px] text-muted-foreground">
                この章は編に分かれていません（scenes だけの形式）。編を追加すると、今のシーンは最初の裁判編に移ります。
              </p>
            )}
          </>
        )}
        <div className="h-2" />
        <Item sel={{ kind: 'yaml' }} icon={<Code2 />} label="YAML（直接編集）" issues={issues} />
      </nav>
    </aside>
  );
});

function Item({ sel, icon, label, count, issues, actions, depth = 0, className }: {
  sel: Selection; icon: ReactNode; label: ReactNode; count?: number; issues: IssueCounts; actions?: ReactNode; depth?: number; className?: string;
}) {
  const { select } = useActions();
  const key = selectionKey(sel);
  const active = useEditorState(s => cachedKey(s.selection) === key);
  const n = issues.get(selectionKey(sel));
  return (
    <div
      className={cn(
        'group/item flex h-7 cursor-pointer items-center gap-1.5 rounded-md pr-1 [&>svg]:size-4 [&>svg]:shrink-0',
        active ? 'bg-primary text-primary-foreground' : 'hover:bg-accent',
        className,
      )}
      style={{ paddingLeft: 8 + depth * 14 }}
      onClick={() => select(sel)}
    >
      {icon}
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {n && n.errors > 0 && <span className="rounded bg-destructive px-1 text-[10px] text-white">{n.errors}</span>}
      {n && n.errors === 0 && n.warnings > 0 && <span className="rounded bg-amber-500 px-1 text-[10px] text-white">{n.warnings}</span>}
      {count !== undefined && <span className={cn('text-xs', active ? 'text-primary-foreground/70' : 'text-muted-foreground')}>{count}</span>}
      {actions && <div onClick={e => e.stopPropagation()}>{actions}</div>}
    </div>
  );
}

/**
 * 項目ごとの操作メニュー。一覧には何百もの項目があるので、押されるまでは Radix のメニューを作らず、
 * 見た目が同じボタンだけを置く（全部に DropdownMenu を置くと、一覧の描き直しに 1 秒以上かかる）
 */
function Menu({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const trigger = (
    <Button
      variant="ghost" size="icon" className="size-6 opacity-0 group-hover/item:opacity-100 data-[state=open]:opacity-100" title="操作"
      onClick={open ? undefined : () => setOpen(true)}
    >
      <MoreHorizontal />
    </Button>
  );
  if (!open) return trigger;
  return (
    <DropdownMenu open onOpenChange={setOpen}>
      <DropdownMenuTrigger asChild>{trigger}</DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-48">{children}</DropdownMenuContent>
    </DropdownMenu>
  );
}

function PartNode({ part, total, issues }: { part: TreePart; total: number; issues: IssueCounts }) {
  const store = useEditorStore();
  const api = () => store.api();
  const [open, setOpen] = useState(true);
  const idx = part.index;
  const Icon = part.kind === 'investigation' ? Search : Gavel;
  const headerSel: Selection = idx === null ? { kind: 'meta' } : { kind: 'part', part: idx };
  const Toggle = open ? ChevronDown : ChevronRight;
  return (
    <div className="pt-1">
      <Item
        sel={headerSel} issues={issues}
        icon={<Toggle onClick={e => { e.stopPropagation(); setOpen(!open); }} className="text-muted-foreground" />}
        className="font-medium"
        label={(
          <span className="flex items-center gap-1.5">
            <Icon className={cn('size-4', part.kind === 'investigation' ? 'text-emerald-600' : 'text-amber-600')} />
            <span className="text-[11px] opacity-70">{PART_LABELS[part.kind]}</span>
            <span className="truncate">{part.title || part.id}</span>
          </span>
        )}
        actions={(
          <Menu>
            <DropdownMenuItem onSelect={() => void A.addScene(api(), idx)}>シーンを追加</DropdownMenuItem>
            {idx !== null && part.kind === 'investigation' && <DropdownMenuItem onSelect={() => void A.addPlace(api(), idx)}>場所を追加</DropdownMenuItem>}
            <DropdownMenuSeparator />
            {idx === null ? (
              <DropdownMenuItem onSelect={() => A.convertToParts(api())}>編（parts）の形式に変える</DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem onSelect={() => store.actions.select({ kind: 'part', part: idx })}>名前・種類を変更</DropdownMenuItem>
                <DropdownMenuItem disabled={idx === 0} onSelect={() => A.movePart(api(), idx, -1)}>上へ</DropdownMenuItem>
                <DropdownMenuItem disabled={idx === total - 1} onSelect={() => A.movePart(api(), idx, 1)}>下へ</DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem variant="destructive" onSelect={() => void A.deletePart(api(), idx, part.title || part.id)}>削除</DropdownMenuItem>
              </>
            )}
          </Menu>
        )}
      />
      {open && (
        <div className="space-y-0.5">
          {part.kind === 'investigation' && idx !== null && (
            <>
              <GroupLabel label="場所" onAdd={() => void A.addPlace(api(), idx)} />
              {part.places.map((id, i) => (
                <Item
                  key={id} depth={1} sel={{ kind: 'place', part: idx, id }} issues={issues}
                  icon={<MapPin className="text-emerald-600" />}
                  label={<>{id} <span className="text-xs opacity-60">{part.placeNames[i]}</span></>}
                  actions={(
                    <Menu>
                      <DropdownMenuItem onSelect={() => void A.renamePlace(api(), idx, id)}>ID を変更</DropdownMenuItem>
                      <DropdownMenuItem disabled={i === 0} onSelect={() => A.movePlace(api(), idx, id, -1)}>上へ</DropdownMenuItem>
                      <DropdownMenuItem disabled={i === part.places.length - 1} onSelect={() => A.movePlace(api(), idx, id, 1)}>下へ</DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem variant="destructive" onSelect={() => void A.deletePlace(api(), idx, id)}>削除</DropdownMenuItem>
                    </Menu>
                  )}
                />
              ))}
              <GroupLabel label="シーン" onAdd={() => void A.addScene(api(), idx)} />
            </>
          )}
          {part.scenes.map((id, i) => {
            const testimony = part.testimony[i];
            return (
              <Item
                key={id} depth={1} sel={{ kind: 'scene', part: idx, id }} issues={issues}
                icon={testimony ? <MessageSquareQuote className="text-orange-500" /> : <MessagesSquare className="text-sky-600" />}
                label={id}
                actions={(
                  <Menu>
                    <DropdownMenuItem onSelect={() => void A.renameScene(api(), idx, id)}>ID を変更</DropdownMenuItem>
                    <DropdownMenuItem disabled={i === 0} onSelect={() => A.moveScene(api(), idx, id, -1)}>上へ</DropdownMenuItem>
                    <DropdownMenuItem disabled={i === part.scenes.length - 1} onSelect={() => A.moveScene(api(), idx, id, 1)}>下へ</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem variant="destructive" onSelect={() => void A.deleteScene(api(), idx, id)}>削除</DropdownMenuItem>
                  </Menu>
                )}
              />
            );
          })}
          {part.kind === 'trial' && (
            <button type="button" className="flex h-6 items-center gap-1 pl-9 text-xs text-muted-foreground hover:text-foreground" onClick={() => void A.addScene(api(), idx)}>
              <Plus className="size-3" /> シーンを追加
            </button>
          )}
          {part.kind === 'investigation' && part.scenes.length === 0 && (
            <p className="pl-9 text-xs text-muted-foreground">（シーンなし）</p>
          )}
        </div>
      )}
    </div>
  );
}

function GroupLabel({ label, onAdd }: { label: string; onAdd: () => void }) {
  return (
    <div className="flex h-6 items-center pl-6 pr-1 text-[11px] font-medium text-muted-foreground">
      {label}
      <button type="button" className="ml-auto rounded p-0.5 hover:bg-accent hover:text-foreground" title={`${label}を追加`} onClick={onAdd}>
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}
