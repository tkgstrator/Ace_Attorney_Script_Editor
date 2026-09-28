// 「ここから再生」のボタン。押すと今の状態（フラグ・証拠品など）を保ってそこから遊ぶ。
// 横の ▼ から、最初の状態で遊ぶこともできる
import { ChevronDown, Play } from 'lucide-react';
import { DropdownMenuItem } from '@/components/ui/dropdown-menu';
import type { Path } from '@/model/yaml-doc.ts';
import { LazyMenu } from '../lazy-menu.tsx';
import { usePlayFrom } from '../preview/play-from.ts';
import { IconButton } from './StepCard.tsx';

export function PlayHere({
  path,
  label,
  what = 'ここ',
  onOpenChange,
  ...rest
}: {
  path: Path;
  /** プレビューに出す名前（例: 「prologue の 3. 台詞」） */
  label: string;
  /** ボタンの説明に使う、どこから遊ぶか（例: この証言） */
  what?: string;
  onOpenChange?: (open: boolean) => void;
  'data-action'?: string;
  'data-owner'?: string;
}) {
  const play = usePlayFrom();
  const go = (fresh: boolean) => play({ kind: 'path', path, label, fresh });
  return (
    <>
      <IconButton
        title={`${what}から再生（フラグ・証拠品などは今プレビューで遊んでいる状態のまま）`}
        onClick={() => go(false)}
        {...rest}
      >
        <Play />
      </IconButton>
      <LazyMenu
        align="end"
        onOpenChange={onOpenChange}
        trigger={(open) => (
          <IconButton title={`${what}から再生する方法を選ぶ`} className="w-4" onClick={open}>
            <ChevronDown />
          </IconButton>
        )}
      >
        <DropdownMenuItem onSelect={() => go(false)}>
          {what}から再生（今の状態のまま）
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => go(true)}>
          {what}から再生（最初の状態で）
        </DropdownMenuItem>
      </LazyMenu>
    </>
  );
}
