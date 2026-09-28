// 押されるまで Radix のメニューを作らないドロップダウン。一覧の各行・各欄に置いても重くならない
// （何百も DropdownMenu を置くと、描き直しに 1 秒以上かかる）
import { type ReactElement, type ReactNode, useEffect, useRef, useState } from 'react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function LazyMenu({
  trigger,
  children,
  className,
  align = 'start',
  onOpenChange,
}: {
  /** onClick を受け取れるボタン */
  trigger: (open: () => void) => ReactElement;
  children: ReactNode;
  className?: string;
  align?: 'start' | 'end';
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLSpanElement>(null);
  const refocus = useRef(false);
  const change = (o: boolean) => {
    setOpen(o);
    onOpenChange?.(o);
    if (!o) refocus.current = true;
  };
  // 閉じたら、開いたボタンにフォーカスを戻す（閉じると、ボタンを作り直すため）
  useEffect(() => {
    if (open || !refocus.current) return;
    refocus.current = false;
    const active = document.activeElement;
    if (!active || active === document.body) box.current?.querySelector('button')?.focus();
  }, [open]);
  return (
    <span ref={box} className="contents">
      {open ? (
        <DropdownMenu open onOpenChange={change}>
          <DropdownMenuTrigger asChild>{trigger(() => {})}</DropdownMenuTrigger>
          <DropdownMenuContent align={align} className={className}>
            {children}
          </DropdownMenuContent>
        </DropdownMenu>
      ) : (
        trigger(() => change(true))
      )}
    </span>
  );
}
