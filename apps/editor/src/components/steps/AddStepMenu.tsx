import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  COMMAND_GROUPS,
  COMMAND_LABELS,
  commandDescription,
  type CommandName,
} from '@/model/steps.ts';

/** ステップの種類を選んで足すメニュー */
export function AddStepMenu({
  onPick,
  trigger,
}: {
  onPick: (name: CommandName) => void;
  trigger?: ReactNode;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        {trigger ?? (
          <Button variant="ghost" size="sm" className="h-7 text-xs text-muted-foreground">
            <Plus /> ステップを追加
          </Button>
        )}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-h-[70vh] w-60 overflow-y-auto">
        {COMMAND_GROUPS.map((g, gi) => (
          <DropdownMenuGroup key={g.label}>
            {gi > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-xs text-muted-foreground">
              {g.label}
            </DropdownMenuLabel>
            {g.items.map((name) => (
              <DropdownMenuItem
                key={name}
                onSelect={() => onPick(name)}
                title={commandDescription(name)}
              >
                <span>{COMMAND_LABELS[name]}</span>
                <span className="ml-auto font-mono text-[10px] text-muted-foreground">{name}</span>
              </DropdownMenuItem>
            ))}
          </DropdownMenuGroup>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
