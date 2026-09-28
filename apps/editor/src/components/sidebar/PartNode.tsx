// 左の一覧の、編（探索編・裁判編）の枝。見出し（開閉・操作）と、中の場所・シーン
import { Gavel, MapPin, MessageSquareQuote, MessagesSquare, Plus, Search } from 'lucide-react';
import { useState } from 'react';
import { DropdownMenuItem, DropdownMenuSeparator } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import type { Selection } from '@/model/paths.ts';
import { PART_LABELS } from '@/model/structure.ts';
import { useEditorStore } from '@/state/editor-store.tsx';
import type { TreePart } from '@/state/store.ts';
import * as A from './actions.ts';
import { type IssueCounts, Item, Menu } from './TreeItem.tsx';

export function PartNode({
  part,
  total,
  issues,
}: {
  part: TreePart;
  total: number;
  issues: IssueCounts;
}) {
  const store = useEditorStore();
  const api = () => store.api();
  const [open, setOpen] = useState(true);
  const idx = part.index;
  const Icon = part.kind === 'investigation' ? Search : Gavel;
  const headerSel: Selection = idx === null ? { kind: 'meta' } : { kind: 'part', part: idx };
  const name = `${PART_LABELS[part.kind]}「${part.title || part.id}」`;
  return (
    <div className="pt-1">
      <Item
        sel={headerSel}
        issues={issues}
        name={name}
        expanded={open}
        onToggle={() => setOpen(!open)}
        icon={null}
        className="font-medium"
        label={
          <span className="flex items-center gap-1.5">
            <Icon
              className={cn(
                'size-4',
                part.kind === 'investigation' ? 'text-emerald-600' : 'text-amber-600',
              )}
            />
            <span className="text-[11px] opacity-70">{PART_LABELS[part.kind]}</span>
            <span className="truncate">{part.title || part.id}</span>
          </span>
        }
        actions={
          <Menu name={name}>
            <DropdownMenuItem onSelect={() => void A.addScene(api(), idx)}>
              シーンを追加
            </DropdownMenuItem>
            {idx !== null && part.kind === 'investigation' && (
              <DropdownMenuItem onSelect={() => void A.addPlace(api(), idx)}>
                場所を追加
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            {idx === null ? (
              <DropdownMenuItem onSelect={() => A.convertToParts(api())}>
                編（parts）の形式に変える
              </DropdownMenuItem>
            ) : (
              <>
                <DropdownMenuItem
                  onSelect={() => store.actions.select({ kind: 'part', part: idx })}
                >
                  名前・種類を変更
                </DropdownMenuItem>
                <DropdownMenuItem disabled={idx === 0} onSelect={() => A.movePart(api(), idx, -1)}>
                  上へ
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={idx === total - 1}
                  onSelect={() => A.movePart(api(), idx, 1)}
                >
                  下へ
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  variant="destructive"
                  onSelect={() => void A.deletePart(api(), idx, part.title || part.id)}
                >
                  削除
                </DropdownMenuItem>
              </>
            )}
          </Menu>
        }
      />
      {open && (
        <div className="space-y-0.5">
          {part.kind === 'investigation' && idx !== null && (
            <>
              <GroupLabel label="場所" onAdd={() => void A.addPlace(api(), idx)} />
              {part.places.map((id, i) => (
                <Item
                  key={id}
                  depth={1}
                  sel={{ kind: 'place', part: idx, id }}
                  name={`場所 ${id}`}
                  issues={issues}
                  icon={<MapPin className="text-emerald-600" />}
                  label={
                    <>
                      {id} <span className="text-xs opacity-60">{part.placeNames[i]}</span>
                    </>
                  }
                  actions={
                    <Menu name={`場所 ${id}`}>
                      <DropdownMenuItem onSelect={() => void A.renamePlace(api(), idx, id)}>
                        ID を変更
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={i === 0}
                        onSelect={() => A.movePlace(api(), idx, id, -1)}
                      >
                        上へ
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={i === part.places.length - 1}
                        onSelect={() => A.movePlace(api(), idx, id, 1)}
                      >
                        下へ
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => void A.deletePlace(api(), idx, id)}
                      >
                        削除
                      </DropdownMenuItem>
                    </Menu>
                  }
                />
              ))}
              <GroupLabel label="シーン" onAdd={() => void A.addScene(api(), idx)} />
            </>
          )}
          {part.scenes.map((id, i) => {
            const testimony = part.testimony[i];
            return (
              <Item
                key={id}
                depth={1}
                sel={{ kind: 'scene', part: idx, id }}
                name={`シーン ${id}`}
                issues={issues}
                icon={
                  testimony ? (
                    <MessageSquareQuote className="text-orange-500" />
                  ) : (
                    <MessagesSquare className="text-sky-600" />
                  )
                }
                label={id}
                actions={
                  <Menu name={`シーン ${id}`}>
                    <DropdownMenuItem onSelect={() => void A.renameScene(api(), idx, id)}>
                      ID を変更
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={i === 0}
                      onSelect={() => A.moveScene(api(), idx, id, -1)}
                    >
                      上へ
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      disabled={i === part.scenes.length - 1}
                      onSelect={() => A.moveScene(api(), idx, id, 1)}
                    >
                      下へ
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      variant="destructive"
                      onSelect={() => void A.deleteScene(api(), idx, id)}
                    >
                      削除
                    </DropdownMenuItem>
                  </Menu>
                }
              />
            );
          })}
          {part.kind === 'trial' && (
            <button
              type="button"
              className="flex h-6 items-center gap-1 rounded pl-9 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => void A.addScene(api(), idx)}
            >
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
      <button
        type="button"
        className="ml-auto rounded p-0.5 outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
        title={`${label}を追加`}
        aria-label={`${label}を追加`}
        onClick={onAdd}
      >
        <Plus className="size-3.5" />
      </button>
    </div>
  );
}
