// 章の中の検索の結果。押すと、その項目を開いて、当たった所の入力欄にフォーカスする
import { MapPin, MessagesSquare, Quote } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import type { Data } from '@/model/doc-session.ts';
import { buildIndex, search, snippet } from '@/model/search.ts';
import { useActions, useEditorState } from '@/state/editor-store.tsx';

/** 編集のたびに索引を作り直さないよう、データの変化は少し待ってから見る */
function useSettled(data: Data | null, ms: number): Data | null {
  const [v, setV] = useState(data);
  useEffect(() => {
    const t = setTimeout(() => setV(data), ms);
    return () => clearTimeout(t);
  }, [data, ms]);
  return v;
}

const LIMIT = 200;

export function SearchResults({ query }: { query: string }) {
  const data = useSettled(
    useEditorState((s) => s.data),
    600,
  );
  const { select } = useActions();
  const results = useMemo(() => search(buildIndex(data), query, LIMIT), [data, query]);
  const move = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    e.preventDefault();
    const items = [...(e.currentTarget.closest('ul')?.querySelectorAll('button') ?? [])];
    const i = items.indexOf(e.target as HTMLButtonElement);
    items[i + (e.key === 'ArrowDown' ? 1 : -1)]?.focus();
  };
  const q = query.trim().replace(/^[A-Za-z_][A-Za-z0-9_]*:\s*/, '');
  return (
    <div className="space-y-1">
      <p className="px-1 text-[11px] text-muted-foreground" role="status">
        {results.length === 0
          ? '見つかりません'
          : `${results.length >= LIMIT ? `${LIMIT} 件以上` : `${results.length} 件`}（「人物ID: 語」でその人物の台詞だけ）`}
      </p>
      <ul className="space-y-0.5" aria-label="検索結果">
        {results.map((r) => {
          const where =
            r.selection.kind === 'place'
              ? r.selection.id
              : r.selection.kind === 'scene'
                ? r.selection.id
                : '';
          const Icon =
            r.kind === 'id' ? (r.selection.kind === 'place' ? MapPin : MessagesSquare) : Quote;
          return (
            <li key={JSON.stringify(r.path)}>
              <button
                type="button"
                className="flex w-full items-start gap-1.5 rounded-md px-1.5 py-1 text-left text-xs outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring"
                onKeyDown={move}
                onClick={() => select(r.selection, r.kind === 'id' ? undefined : r.path)}
              >
                <Icon className="mt-0.5 size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0">
                  <span className="block font-mono text-[10px] text-muted-foreground">
                    {where}
                    {r.speaker ? ` · ${r.speaker}` : ''}
                  </span>
                  <span className="block truncate">
                    {r.kind === 'id' ? r.text : snippet(r, q.length)}
                  </span>
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
