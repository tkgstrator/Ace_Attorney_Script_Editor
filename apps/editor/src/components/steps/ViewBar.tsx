// ステップ一覧の上の、表示する種類の切り替え。隠した種類のステップは「演出 3」のような 1 行にまとまる（FoldRow）。
// 「テキストのみ」は、台詞と選択肢・分岐だけにチェックを入れた状態にするボタン（カードはふだんどおり編集できる）
import { Eye, FileText, ListFilter } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { STEP_GROUPS } from '@/model/step-groups.ts';
import {
  isDialogueOnly,
  setGroupShown,
  showAllGroups,
  showDialogueOnly,
  useViewSettings,
} from './view-store.ts';

export function ViewBar() {
  const { hidden } = useViewSettings();
  const textOnly = isDialogueOnly(hidden);
  const shown = STEP_GROUPS.length - hidden.size;
  return (
    <div role="toolbar" aria-label="ステップの表示" className="flex flex-wrap items-center gap-1">
      <Button
        size="sm"
        variant="ghost"
        className={cn('h-7 px-2 text-xs', textOnly && 'bg-accent text-accent-foreground')}
        aria-pressed={textOnly}
        title="台詞と選択肢・分岐だけを見せます（ほかの種類は 1 行にまとまります）。もう一度押すと、すべて表示に戻ります"
        onClick={() => (textOnly ? showAllGroups() : showDialogueOnly())}
      >
        <FileText /> テキストのみ
      </Button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            size="sm"
            variant={hidden.size > 0 ? 'secondary' : 'ghost'}
            className="h-7 px-2 text-xs"
            title="表示するステップの種類を選びます。隠した種類は「演出 3」のような 1 行にまとまり、押すと開きます"
          >
            <ListFilter />
            {hidden.size === 0 ? '表示する種類' : `表示する種類: ${shown} / ${STEP_GROUPS.length}`}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-64">
          <DropdownMenuLabel className="text-xs">表示する種類</DropdownMenuLabel>
          {STEP_GROUPS.map((g) => (
            <DropdownMenuCheckboxItem
              key={g.id}
              checked={!hidden.has(g.id)}
              // 続けて選べるように、選んでも閉じない
              onSelect={(e) => e.preventDefault()}
              onCheckedChange={(c) => setGroupShown(g.id, c === true)}
            >
              <span className="flex flex-col">
                <span>{g.label}</span>
                <span className="text-[11px] text-muted-foreground">{g.hint}</span>
              </span>
            </DropdownMenuCheckboxItem>
          ))}
          <DropdownMenuSeparator />
          <DropdownMenuItem disabled={hidden.size === 0} onSelect={showAllGroups}>
            <Eye /> すべて表示
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      {hidden.size > 0 && (
        <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={showAllGroups}>
          <Eye /> すべて表示
        </Button>
      )}
    </div>
  );
}
