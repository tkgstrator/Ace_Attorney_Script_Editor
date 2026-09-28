// 条件式の欄。構文エラー・章にない ID を欄の下に出し、フラグや証拠品などの候補から書き足せる
import { Lightbulb } from 'lucide-react';
import { useId, useMemo } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { checkCond } from '@/model/cond.ts';
import type { Path } from '@/model/yaml-doc.ts';
import { useIds } from '@/state/editor-store.tsx';
import { TextInput, useSetter } from './fields.tsx';
import { LazyMenu } from './lazy-menu.tsx';

interface Props {
  path: Path;
  value: unknown;
  placeholder?: string;
  optional?: boolean;
  className?: string;
  'aria-label'?: string;
}

const HELP =
  'and / or / not・== != < <= > >=・has(証拠品) visited(シーン・場所) seen(調べた・話した印)';

export function CondInput({ path, value, placeholder, optional, className, ...rest }: Props) {
  const ids = useIds();
  const { set } = useSetter();
  const msgId = useId();
  const src = typeof value === 'string' ? value : '';
  const check = useMemo(
    () =>
      checkCond(src, {
        flags: ids.flags,
        evidence: ids.evidence,
        nodes: [...ids.scenes, ...ids.places],
      }),
    [src, ids],
  );
  const message =
    check.error ?? (check.unknown.length > 0 ? `章にない: ${check.unknown.join('・')}` : null);
  const add = (snippet: string) => set(path, src.trim() ? `${src} and ${snippet}` : snippet);
  return (
    <div className={cn('min-w-0 flex-1', className)}>
      <div className="flex items-center gap-0.5">
        <TextInput
          path={path}
          value={value}
          optional={optional}
          mono
          className={cn(check.error && 'border-destructive')}
          placeholder={placeholder ?? '条件式（例: has(repair) and not asked）'}
          aria-label={rest['aria-label']}
          aria-invalid={check.error !== null}
          aria-describedby={message ? msgId : undefined}
        />
        <LazyMenu
          className="max-h-[60vh] w-72 overflow-y-auto"
          align="end"
          trigger={(open) => (
            <Button
              variant="ghost"
              size="icon"
              className="size-7 shrink-0 text-muted-foreground"
              title="候補から書き足す"
              aria-label={`${rest['aria-label'] ?? '条件'}の候補`}
              onClick={open}
            >
              <Lightbulb />
            </Button>
          )}
        >
          <DropdownMenuLabel className="text-[11px] font-normal text-muted-foreground">
            {HELP}
          </DropdownMenuLabel>
          <Group label="フラグ" items={ids.flags} onPick={add} />
          <Group label="持っている証拠品" items={ids.evidence} wrap="has" onPick={add} />
          <Group
            label="訪れたシーン・場所"
            items={[...ids.scenes, ...ids.places]}
            wrap="visited"
            onPick={add}
          />
        </LazyMenu>
      </div>
      {message && (
        <p
          id={msgId}
          className={cn('mt-0.5 text-[11px]', check.error ? 'text-destructive' : 'text-amber-700')}
        >
          {message}
        </p>
      )}
    </div>
  );
}

function Group({
  label,
  items,
  wrap,
  onPick,
}: {
  label: string;
  items: string[];
  wrap?: string;
  onPick: (s: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuLabel className="text-xs text-muted-foreground">{label}</DropdownMenuLabel>
      {items.map((id) => {
        const s = wrap ? `${wrap}(${id})` : id;
        return (
          <DropdownMenuItem key={id} className="font-mono text-xs" onSelect={() => onPick(s)}>
            {s}
          </DropdownMenuItem>
        );
      })}
    </DropdownMenuGroup>
  );
}
