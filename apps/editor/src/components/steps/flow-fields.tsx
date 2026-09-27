// 条件分岐・選択肢・つきつけ要求（中にステップ列を持つもの）の入力欄
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import type { Path } from '@/model/yaml-doc.ts';
import { useActions } from '@/state/editor-store.tsx';
import { CondInput, TextInput } from '../fields.tsx';
import { PresentMap } from './PresentMap.tsx';
import type { BodyProps } from './say-fields.tsx';
import { IconButton } from './StepCard.tsx';
import { StepList } from './StepList.tsx';

/** 入れ子のステップ列（左に線を引いて、見出しを付ける） */
export function Nested({ label, children, actions }: { label: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mt-1 border-l-2 border-muted pl-2">
      <div className="mb-1 flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
        {label}
        <div className="ml-auto flex items-center">{actions}</div>
      </div>
      {children}
    </div>
  );
}

/** 省略できるステップ列（なければ「追加」ボタン、あれば「消す」ボタン） */
export function OptionalSteps({ path, value, label, addLabel }: { path: Path; value: unknown; label: string; addLabel: string }) {
  const { edit } = useActions();
  if (value === undefined) {
    return (
      <Button variant="ghost" size="sm" className="h-6 text-[11px] text-muted-foreground" onClick={() => edit([{ op: 'set', path, value: [] }])}>
        <Plus /> {addLabel}
      </Button>
    );
  }
  return (
    <Nested
      label={label}
      actions={<IconButton title={`${label}を消す`} className="hover:text-destructive" onClick={() => edit([{ op: 'delete', path }])}><Trash2 /></IconButton>}
    >
      <StepList path={path} steps={value} />
    </Nested>
  );
}

export function IfBody({ path, step }: BodyProps) {
  return (
    <div>
      <CondInput path={[...path, 'if']} value={step.if} aria-label="条件" />
      <Nested label="then（真のとき）"><StepList path={[...path, 'then']} steps={step.then} /></Nested>
      <OptionalSteps path={[...path, 'else']} value={step.else} label="else（偽のとき）" addLabel="else を追加" />
    </div>
  );
}

export function ChoiceBody({ path, step }: BodyProps) {
  const { edit } = useActions();
  const options = Array.isArray(step.choice) ? step.choice as Record<string, unknown>[] : [];
  const listPath = [...path, 'choice'];
  return (
    <div className="space-y-1">
      {options.map((opt, i) => {
        const p = [...listPath, i];
        return (
          <div key={i} className="rounded-md border border-dashed border-violet-300 p-2" data-path={JSON.stringify(p)}>
            <div className="flex items-center gap-1">
              <span className="text-xs text-muted-foreground">{i + 1}.</span>
              <TextInput path={[...p, 'text']} value={opt.text} placeholder="選択肢の文" aria-label="選択肢の文" />
              <IconButton title="上へ" disabled={i === 0} onClick={() => edit([{ op: 'move', path: listPath, from: i, to: i - 1 }])}><ArrowUp /></IconButton>
              <IconButton title="下へ" disabled={i === options.length - 1} onClick={() => edit([{ op: 'move', path: listPath, from: i, to: i + 1 }])}><ArrowDown /></IconButton>
              <IconButton title="選択肢を消す" className="hover:text-destructive" onClick={() => edit([{ op: 'delete', path: p }])}><Trash2 /></IconButton>
            </div>
            <CondInput path={[...p, 'when']} value={opt.when} optional className="mt-1" placeholder="表示する条件（省略可）" aria-label="表示する条件" />
            <Nested label="選んだとき"><StepList path={[...p, 'then']} steps={opt.then} emptyLabel="何もせず次のステップへ" /></Nested>
          </div>
        );
      })}
      <Button
        variant="ghost" size="sm" className="h-6 text-[11px] text-muted-foreground"
        onClick={() => edit([{ op: 'insert', path: listPath, value: { text: `選択肢 ${options.length + 1}`, then: [] } }])}
      >
        <Plus /> 選択肢を追加
      </Button>
    </div>
  );
}

export function DemandBody({ path, step }: BodyProps) {
  return (
    <div className="space-y-1">
      <TextInput multiline path={[...path, 'demand']} value={step.demand} placeholder="つきつけを求める文" aria-label="つきつけを求める文" />
      <Nested label="正解（証拠品・人物ファイルごと）"><PresentMap path={[...path, 'present']} value={step.present} label="正解" profiles /></Nested>
      <OptionalSteps path={[...path, 'wrong']} value={step.wrong} label="不正解のとき（実行後にもう一度求める）" addLabel="不正解の反応を追加" />
    </div>
  );
}
