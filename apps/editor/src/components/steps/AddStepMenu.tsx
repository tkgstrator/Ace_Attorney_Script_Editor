import { Plus } from 'lucide-react';
import type { ReactElement } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { YAML_ONLY } from '@/model/form-keys.ts';
import {
  COMMAND_GROUPS,
  COMMAND_LABELS,
  type CommandName,
  commandDescription,
  OTHER_COMMANDS,
} from '@/model/steps.ts';
import { LazyMenu } from '../lazy-menu.tsx';

const GROUPS = [...COMMAND_GROUPS, { label: 'その他のコマンド', items: OTHER_COMMANDS }];

/** ステップの種類を選んで足すメニュー。「YAML」の付いたものは、専用の入力欄がなく YAML で編集する */
export function AddStepMenu({
  onPick,
  trigger,
  onOpenChange,
}: {
  onPick: (name: CommandName) => void;
  /** 開くボタン（onClick を受け取る） */
  trigger?: (open: () => void) => ReactElement;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <LazyMenu
      className="max-h-[70vh] w-64 overflow-y-auto"
      onOpenChange={onOpenChange}
      trigger={
        trigger ??
        ((open) => (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground"
            onClick={open}
          >
            <Plus /> ステップを追加
          </Button>
        ))
      }
    >
      {GROUPS.map((g, gi) => (
        <DropdownMenuGroup key={g.label}>
          {gi > 0 && <DropdownMenuSeparator />}
          <DropdownMenuLabel className="text-xs text-muted-foreground">{g.label}</DropdownMenuLabel>
          {g.items.map((name) => (
            <DropdownMenuItem
              key={name}
              onSelect={() => onPick(name)}
              title={commandDescription(name)}
            >
              <span>{COMMAND_LABELS[name]}</span>
              {YAML_ONLY.has(name) && (
                <span className="rounded border px-1 text-[9px] text-muted-foreground">YAML</span>
              )}
              <span className="ml-auto font-mono text-[10px] text-muted-foreground">{name}</span>
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
      ))}
    </LazyMenu>
  );
}
