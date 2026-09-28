// 1 つのステップのカード。見出し（種類・操作ボタン）と、種類ごとの入力欄。
import { ArrowDown, ArrowUp, Copy, GripVertical, Plus, Trash2 } from 'lucide-react';
import { type ComponentProps, memo, useMemo, useState, useSyncExternalStore } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { extraKeys } from '@/model/form-keys.ts';
import { pathKey } from '@/model/paths.ts';
import {
  COMMAND_LABELS,
  commandDescription,
  type Step,
  type StepKind,
  stepKind,
} from '@/model/steps.ts';
import type { Path } from '@/model/yaml-doc.ts';
import { ExtraFields } from '../ExtraFields.tsx';
import { AddStepMenu } from './AddStepMenu.tsx';
import { LocationBody, ShowBody, ShowEvidenceBody } from './display-fields.tsx';
import { BgmBody, FadeBody, FlashBody, SeBody, ShakeBody, WaitBody } from './effect-fields.tsx';
import { ChoiceBody, DemandBody, IfBody } from './flow-fields.tsx';
import { BgmPauseBody, PaletteBody, ProfileBody, ResumeBody, TextboxBody } from './misc-fields.tsx';
import { PlayHere } from './PlayHere.tsx';
import type { StepOps } from './StepList.tsx';
import { NarrateBody, SayBody, TextCommandBody, UnknownBody } from './say-fields.tsx';
import {
  AddBody,
  GiveTakeBody,
  GotoBody,
  InvestigateBody,
  PenaltyBody,
  SetBody,
  ShoutBody,
} from './state-fields.tsx';

const TONE: Partial<Record<StepKind, string>> = {
  say: 'border-l-sky-400',
  shorthand: 'border-l-sky-400',
  narrate: 'border-l-sky-300',
  card: 'border-l-slate-400',
  banner: 'border-l-slate-400',
  shout: 'border-l-red-500',
  if: 'border-l-violet-400',
  choice: 'border-l-violet-400',
  demand: 'border-l-amber-500',
  goto: 'border-l-emerald-500',
  investigate: 'border-l-emerald-500',
  bgm: 'border-l-pink-400',
  se: 'border-l-pink-400',
  shake: 'border-l-orange-400',
  flash: 'border-l-orange-400',
  fade: 'border-l-orange-400',
  wait: 'border-l-orange-300',
  set: 'border-l-teal-400',
  add: 'border-l-teal-400',
  give: 'border-l-orange-400',
  take: 'border-l-orange-400',
  penalty: 'border-l-red-400',
  end: 'border-l-zinc-800',
  gameover: 'border-l-zinc-800',
  unknown: 'border-l-destructive',
  giveProfile: 'border-l-orange-400',
  takeProfile: 'border-l-orange-400',
};

// 操作ボタンを出すカード: マウスが乗っているか、フォーカスが中にあるもの（入れ子のときは、いちばん内側の 1 枚）
let hovered: string | null = null;
let focused: string | null = null;
const listeners = new Set<() => void>();
function notify() {
  for (const fn of listeners) fn();
}
function setHovered(key: string | null) {
  if (hovered === key) return;
  hovered = key;
  notify();
}
function setFocused(key: string | null) {
  if (focused === key) return;
  focused = key;
  notify();
}
const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
};

interface Props {
  /** このカードが入っている列のパス */
  listPath: Path;
  step: unknown;
  index: number;
  count: number;
  ops: StepOps;
  /** 並べ替えても変わらない、この行のキー（操作の後にフォーカスを戻すのに使う） */
  rowKey: string;
}

/** 中身（step）・位置・数が変わらなければ描き直さない（長い列で 1 枚だけ編集したとき、ほかのカードはそのまま） */
export const StepCard = memo(function StepCard({
  listPath,
  step,
  index,
  count,
  ops,
  rowKey,
}: Props) {
  const path = useMemo(() => [...listPath, index], [listPath, index]);
  const kind = stepKind(step);
  const [armed, setArmed] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const key = pathKey(path);
  // 並べ替えても変わらない行のキーで見る（動かした後もフォーカスしたままのカードに操作ボタンを出す）
  const active = useSyncExternalStore(subscribe, () => hovered === rowKey || focused === rowKey);
  const label =
    kind === 'shorthand' ? COMMAND_LABELS.say : kind === 'unknown' ? '不明' : COMMAND_LABELS[kind];
  const name = `${index + 1}. ${label}`;
  const extras = extraKeys(kind, step);
  const act = (action: string) => ({ 'data-action': action, 'data-owner': rowKey });
  return (
    // biome-ignore lint/a11y/useSemanticElements: カードは見た目を変えずに、まとまりの名前を付ける
    <div
      data-path={key}
      data-row-key={rowKey}
      role="group"
      aria-label={name}
      onMouseOver={(e) => {
        e.stopPropagation();
        setHovered(rowKey);
      }}
      onMouseLeave={() => {
        if (hovered === rowKey) setHovered(null);
      }}
      onFocus={(e) => {
        e.stopPropagation();
        setFocused(rowKey);
      }}
      onBlur={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null) && focused === rowKey)
          setFocused(null);
      }}
      draggable={armed}
      onDragStart={(e) => {
        e.stopPropagation();
        e.dataTransfer.effectAllowed = 'move';
        ops.dragStart(index);
      }}
      onDragEnd={() => {
        setArmed(false);
        ops.dragEnd();
      }}
      className={cn(
        'relative rounded-md border border-l-4 bg-card px-2 py-1.5 shadow-xs',
        TONE[kind] ?? 'border-l-zinc-300',
      )}
    >
      <div className="flex items-start gap-1.5">
        <div className="flex shrink-0 items-center gap-1 pt-1">
          <button
            type="button"
            className="cursor-grab rounded text-muted-foreground/60 outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            title="ドラッグで並べ替え（Alt+↑↓ でも動かせます）"
            aria-label={`${name}（Alt+↑↓ で並べ替え）`}
            {...act('grip')}
            onMouseDown={() => setArmed(true)}
            onMouseUp={() => setArmed(false)}
            onKeyDown={(e) => {
              if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
              e.preventDefault();
              const d = e.key === 'ArrowUp' ? -1 : 1;
              if (index + d >= 0 && index + d < count) ops.move(index, d, 'grip');
            }}
          >
            <GripVertical className="size-4" />
          </button>
          <span
            className="w-20 truncate text-[11px] font-medium text-muted-foreground"
            title={
              kind === 'shorthand'
                ? '台詞（省略形）'
                : kind === 'unknown'
                  ? ''
                  : commandDescription(kind)
            }
          >
            {name}
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <Body kind={kind} path={path} step={step as Step} />
          {extras.length > 0 && <ExtraFields path={path} value={step as Step} keys={extras} />}
        </div>
        <div
          className={cn(
            'absolute -top-2.5 right-1 z-10 flex items-center rounded-md border bg-card shadow-sm',
            !active && !menuOpen && 'hidden',
          )}
        >
          <PlayHere
            path={path}
            label={name}
            what="このステップ"
            onOpenChange={setMenuOpen}
            {...act('play')}
          />
          <IconButton
            title="上へ"
            disabled={index === 0}
            onClick={() => ops.move(index, -1, 'up')}
            {...act('up')}
          >
            <ArrowUp />
          </IconButton>
          <IconButton
            title="下へ"
            disabled={index === count - 1}
            onClick={() => ops.move(index, 1, 'down')}
            {...act('down')}
          >
            <ArrowDown />
          </IconButton>
          <IconButton title="複製" onClick={() => ops.duplicate(index)} {...act('copy')}>
            <Copy />
          </IconButton>
          <AddStepMenu
            onPick={(n) => ops.insertAfter(index, n)}
            onOpenChange={setMenuOpen}
            trigger={(open) => (
              <IconButton title="この後に追加" onClick={open} {...act('add')}>
                <Plus />
              </IconButton>
            )}
          />
          <IconButton
            title="削除"
            onClick={() => ops.remove(index)}
            className="hover:text-destructive"
            {...act('remove')}
          >
            <Trash2 />
          </IconButton>
        </div>
      </div>
    </div>
  );
});

/** アイコンだけのボタン（title を読み上げの名前にもする） */
export function IconButton({
  children,
  className,
  title,
  ...props
}: Omit<ComponentProps<typeof Button>, 'title'> & { title: string }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      className={cn('size-6 [&_svg]:size-3.5', className)}
      title={title}
      aria-label={title}
      {...props}
    >
      {children}
    </Button>
  );
}

function Body({ kind, path, step }: { kind: StepKind; path: Path; step: Step }) {
  switch (kind) {
    case 'say':
    case 'shorthand':
      return <SayBody path={path} step={step} />;
    case 'narrate':
      return <NarrateBody path={path} step={step} />;
    case 'banner':
    case 'card':
      return <TextCommandBody path={path} step={step} name={kind} />;
    case 'set':
      return <SetBody path={path} step={step} />;
    case 'add':
      return <AddBody path={path} step={step} />;
    case 'give':
    case 'take':
      return <GiveTakeBody path={path} step={step} name={kind} />;
    case 'if':
      return <IfBody path={path} step={step} />;
    case 'choice':
      return <ChoiceBody path={path} step={step} />;
    case 'demand':
      return <DemandBody path={path} step={step} />;
    case 'goto':
      return <GotoBody path={path} step={step} />;
    case 'investigate':
      return <InvestigateBody path={path} step={step} />;
    case 'penalty':
      return <PenaltyBody path={path} step={step} />;
    case 'shout':
      return <ShoutBody path={path} step={step} />;
    case 'showEvidence':
      return <ShowEvidenceBody path={path} step={step} />;
    case 'show':
      return <ShowBody path={path} step={step} />;
    case 'location':
      return <LocationBody path={path} step={step} />;
    case 'bgm':
      return <BgmBody path={path} step={step} />;
    case 'se':
      return <SeBody path={path} step={step} />;
    case 'shake':
      return <ShakeBody path={path} step={step} />;
    case 'flash':
      return <FlashBody path={path} step={step} />;
    case 'fade':
      return <FadeBody path={path} step={step} />;
    case 'wait':
      return <WaitBody path={path} step={step} />;
    case 'end':
      return <p className="pt-1 text-xs text-muted-foreground">ゲームクリア（エンディング）</p>;
    case 'gameover':
      return <p className="pt-1 text-xs text-muted-foreground">ゲームオーバー</p>;
    case 'giveProfile':
    case 'takeProfile':
      return <ProfileBody path={path} step={step} name={kind} />;
    case 'resume':
      return <ResumeBody path={path} step={step} />;
    case 'palette':
      return <PaletteBody path={path} step={step} />;
    case 'textbox':
      return <TextboxBody path={path} step={step} />;
    case 'bgmPause':
      return <BgmPauseBody path={path} step={step} />;
    case 'unknown':
      return <UnknownBody path={path} step={step} />;
    default:
      // 専用の入力欄がないコマンド（native・ui・scroll・pan・overlay・random）は YAML で
      return <UnknownBody path={path} step={step} known={kind} />;
  }
}
