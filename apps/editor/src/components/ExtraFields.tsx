// 入力欄（フォーム）に出していない属性の入口。「フォームにない項目: a, b」を押すと、その属性だけを YAML で編集できる
import { ChevronDown, ChevronRight } from 'lucide-react';
import { useState } from 'react';
import { pathKey } from '@/model/paths.ts';
import type { Op, Path } from '@/model/yaml-doc.ts';
import { useActions } from '@/state/editor-store.tsx';
import { useRevealListener } from './reveal.ts';
import { YamlDraft } from './yaml-draft.tsx';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

export function ExtraFields({ path, value, keys }: { path: Path; value: Rec; keys: string[] }) {
  const [open, setOpen] = useState(false);
  const { edit } = useActions();
  const box = useRevealListener<HTMLDivElement>(!open, () => setOpen(true));
  if (keys.length === 0) return null;
  const picked = Object.fromEntries(keys.map((k) => [k, value[k]]));
  const Icon = open ? ChevronDown : ChevronRight;
  return (
    <div ref={box} className="mt-1" data-reveal={open ? undefined : ''} data-focus-root>
      {keys.map((k) => (
        <span key={k} hidden data-path={pathKey([...path, k])} />
      ))}
      <button
        type="button"
        className="flex items-center gap-0.5 text-[11px] text-muted-foreground hover:text-foreground"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        title="入力欄に出していない属性を YAML で編集します"
      >
        <Icon className="size-3.5" /> フォームにない項目:{' '}
        <span className="font-mono">{keys.join(', ')}</span>
      </button>
      {open && (
        <YamlDraft
          autoFocus
          value={picked}
          aria-label={`フォームにない項目（${keys.join(', ')}）`}
          hint="ここに書いた属性だけを書き換えます。消した属性は取り除きます"
          validate={(v) => (isRec(v) ? null : 'key: value の形で書いてください')}
          onCommit={(v) => {
            const next = v as Rec;
            const ops: Op[] = [
              ...keys
                .filter((k) => !(k in next))
                .map((k): Op => ({ op: 'delete', path: [...path, k] })),
              ...Object.entries(next)
                .filter(([k, x]) => JSON.stringify(x) !== JSON.stringify(value[k]))
                .map(([k, x]): Op => ({ op: 'set', path: [...path, k], value: x })),
            ];
            edit(ops);
            return null;
          }}
        />
      )}
    </div>
  );
}
