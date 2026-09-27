// 1 つのステップのカード。見出し（種類・操作ボタン）と、種類ごとの入力欄。
import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2 } from 'lucide-react';
import { memo, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { pathKey } from '@/model/paths.ts';
import { COMMAND_LABELS, commandDescription, stepKind, type Step, type StepKind } from '@/model/steps.ts';
import type { Path } from '@/model/yaml-doc.ts';
import { AddStepMenu } from './AddStepMenu.tsx';
import type { StepOps } from './StepList.tsx';
import { BgmBody, FadeBody, FlashBody, SeBody, ShakeBody, WaitBody } from './effect-fields.tsx';
import { ChoiceBody, DemandBody, IfBody } from './flow-fields.tsx';
import { NarrateBody, SayBody, TextCommandBody, UnknownBody } from './say-fields.tsx';
import {
  AddBody, GiveTakeBody, GotoBody, InvestigateBody, LocationBody, PenaltyBody, SetBody, ShoutBody, ShowBody, ShowEvidenceBody,
} from './state-fields.tsx';

const TONE: Partial<Record<StepKind, string>> = {
  say: 'border-l-sky-400', shorthand: 'border-l-sky-400', narrate: 'border-l-sky-300',
  card: 'border-l-slate-400', banner: 'border-l-slate-400', shout: 'border-l-red-500',
  if: 'border-l-violet-400', choice: 'border-l-violet-400', demand: 'border-l-amber-500',
  goto: 'border-l-emerald-500', investigate: 'border-l-emerald-500',
  bgm: 'border-l-pink-400', se: 'border-l-pink-400', shake: 'border-l-orange-400', flash: 'border-l-orange-400',
  fade: 'border-l-orange-400', wait: 'border-l-orange-300',
  set: 'border-l-teal-400', add: 'border-l-teal-400', give: 'border-l-orange-400', take: 'border-l-orange-400',
  penalty: 'border-l-red-400', end: 'border-l-zinc-800', gameover: 'border-l-zinc-800', unknown: 'border-l-destructive',
};

// マウスが乗っているカード（入れ子のとき、いちばん内側の 1 枚だけ操作ボタンを出す）
let hovered: string | null = null;
const listeners = new Set<() => void>();
function setHovered(key: string | null) {
  if (hovered === key) return;
  hovered = key;
  for (const fn of listeners) fn();
}
const subscribe = (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn); }; };

interface Props {
  /** このカードが入っている列のパス */
  listPath: Path;
  step: unknown;
  index: number;
  count: number;
  ops: StepOps;
}

/** 中身（step）・位置・数が変わらなければ描き直さない（長い列で 1 枚だけ編集したとき、ほかのカードはそのまま） */
export const StepCard = memo(function StepCard({ listPath, step, index, count, ops }: Props) {
  const path = useMemo(() => [...listPath, index], [listPath, index]);
  const kind = stepKind(step);
  const [armed, setArmed] = useState(false);
  const key = pathKey(path);
  const active = useSyncExternalStore(subscribe, () => hovered === key);
  const label = kind === 'shorthand' ? COMMAND_LABELS.say : kind === 'unknown' ? '不明' : COMMAND_LABELS[kind];
  return (
    <div
      data-path={key}
      onMouseOver={e => { e.stopPropagation(); setHovered(key); }}
      onMouseLeave={() => { if (hovered === key) setHovered(null); }}
      draggable={armed}
      onDragStart={e => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'move';
        ops.dragStart(index);
      }}
      onDragEnd={() => { setArmed(false); ops.dragEnd(); }}
      className={cn('relative rounded-md border border-l-4 bg-card px-2 py-1.5 shadow-xs', TONE[kind] ?? 'border-l-zinc-300')}
    >
      <div className="flex items-start gap-1.5">
        <div className="flex shrink-0 items-center gap-1 pt-1">
          <span
            className="cursor-grab text-muted-foreground/60 hover:text-foreground" title="ドラッグで並べ替え"
            onMouseDown={() => setArmed(true)} onMouseUp={() => setArmed(false)}
          >
            <GripVertical className="size-4" />
          </span>
          <span
            className="w-20 truncate text-[11px] font-medium text-muted-foreground"
            title={kind === 'shorthand' ? '台詞（省略形）' : kind === 'unknown' ? '' : commandDescription(kind)}
          >
            {index + 1}. {label}
          </span>
        </div>
        <div className="min-w-0 flex-1"><Body kind={kind} path={path} step={step as Step} /></div>
        <div className={cn('absolute -top-2.5 right-1 z-10 flex items-center rounded-md border bg-card shadow-sm', !active && 'hidden')}>
          <IconButton title="上へ" disabled={index === 0} onClick={() => ops.move(index, -1)}><ArrowUp /></IconButton>
          <IconButton title="下へ" disabled={index === count - 1} onClick={() => ops.move(index, 1)}><ArrowDown /></IconButton>
          <IconButton title="複製" onClick={() => ops.duplicate(index)}><Copy /></IconButton>
          <AddStepMenu onPick={name => ops.insertAfter(index, name)} trigger={<Button variant="ghost" size="icon" className="size-6" title="この後に追加"><Plus /></Button>} />
          <IconButton title="削除" onClick={() => ops.remove(index)} className="hover:text-destructive"><Trash2 /></IconButton>
        </div>
      </div>
    </div>
  );
});

export function IconButton({ children, className, ...props }: { children: ReactNode; title: string; onClick: () => void; disabled?: boolean; className?: string }) {
  return <Button variant="ghost" size="icon" className={cn('size-6 [&_svg]:size-3.5', className)} {...props}>{children}</Button>;
}

function Body({ kind, path, step }: { kind: StepKind; path: Path; step: Step }) {
  switch (kind) {
    case 'say': case 'shorthand': return <SayBody path={path} step={step} />;
    case 'narrate': return <NarrateBody path={path} step={step} />;
    case 'banner': case 'card': return <TextCommandBody path={path} step={step} name={kind} />;
    case 'set': return <SetBody path={path} step={step} />;
    case 'add': return <AddBody path={path} step={step} />;
    case 'give': case 'take': return <GiveTakeBody path={path} step={step} name={kind} />;
    case 'if': return <IfBody path={path} step={step} />;
    case 'choice': return <ChoiceBody path={path} step={step} />;
    case 'demand': return <DemandBody path={path} step={step} />;
    case 'goto': return <GotoBody path={path} step={step} />;
    case 'investigate': return <InvestigateBody path={path} step={step} />;
    case 'penalty': return <PenaltyBody path={path} step={step} />;
    case 'shout': return <ShoutBody path={path} step={step} />;
    case 'showEvidence': return <ShowEvidenceBody path={path} step={step} />;
    case 'show': return <ShowBody path={path} step={step} />;
    case 'location': return <LocationBody path={path} step={step} />;
    case 'bgm': return <BgmBody path={path} step={step} />;
    case 'se': return <SeBody path={path} step={step} />;
    case 'shake': return <ShakeBody path={path} step={step} />;
    case 'flash': return <FlashBody path={path} step={step} />;
    case 'fade': return <FadeBody path={path} step={step} />;
    case 'wait': return <WaitBody path={path} step={step} />;
    case 'end': return <p className="pt-1 text-xs text-muted-foreground">ゲームクリア（エンディング）</p>;
    case 'gameover': return <p className="pt-1 text-xs text-muted-foreground">ゲームオーバー</p>;
    case 'unknown': return <UnknownBody path={path} step={step} />;
  }
}
