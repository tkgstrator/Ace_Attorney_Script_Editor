// 左の一覧: 章の選択・章の中の検索と、基本情報・人物・証拠品・フラグ・各編（シーン・場所）のツリー
import { BookOpen, Code2, Flag, Package, Plus, Search as SearchIcon, Users } from 'lucide-react';
import { memo, useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useEditorState, useEditorStore, useIds } from '@/state/editor-store.tsx';
import * as A from './actions.ts';
import { ChapterPicker } from './ChapterPicker.tsx';
import { PartNode } from './PartNode.tsx';
import { SearchResults } from './SearchResults.tsx';
import { type IssueCounts, Item } from './TreeItem.tsx';

export { type IssueCounts, selectionKey } from './TreeItem.tsx';

/** 1 文字打つたびには描き直さない（一覧に出すもの tree・件数・診断の数が変わったときだけ） */
export const Sidebar = memo(function Sidebar({
  issues,
  width,
}: {
  issues: IssueCounts;
  width: number;
}) {
  const store = useEditorStore();
  const parts = useEditorState((s) => s.tree);
  const hasData = useEditorState((s) => s.data !== null);
  const ids = useIds();
  const api = () => store.api();
  const hasLegacy = parts.some((p) => p.index === null);
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  // 打ち終わるまで少し待つ
  useEffect(() => {
    const t = setTimeout(() => setQuery(input), 150);
    return () => clearTimeout(t);
  }, [input]);
  const searching = query.trim() !== '';
  return (
    <aside
      className="flex h-full shrink-0 flex-col border-r bg-muted/30"
      style={{ width }}
      aria-label="章の構成"
    >
      <ChapterPicker />
      {hasData && (
        <div className="relative border-b px-2 pb-2">
          <SearchIcon className="pointer-events-none absolute top-2 left-4 size-4 text-muted-foreground" />
          <Input
            type="search"
            className="h-8 pl-8 text-xs"
            placeholder="章の中を検索（ID・台詞・話し手）"
            aria-label="章の中を検索"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') setInput('');
              if (e.key === 'ArrowDown') {
                e.preventDefault();
                document.querySelector<HTMLElement>('[aria-label="検索結果"] button')?.focus();
              }
            }}
          />
        </div>
      )}
      <nav className="flex-1 space-y-0.5 overflow-y-auto p-2 text-sm" aria-label="項目">
        {hasData && searching && <SearchResults query={query} />}
        {hasData && !searching && (
          <>
            <Item
              sel={{ kind: 'meta' }}
              icon={<BookOpen />}
              label="基本情報"
              name="基本情報"
              issues={issues}
            />
            <Item
              sel={{ kind: 'characters' }}
              name="人物"
              icon={<Users />}
              label="人物"
              count={ids.characters.length}
              issues={issues}
            />
            <Item
              sel={{ kind: 'evidence' }}
              name="証拠品"
              icon={<Package />}
              label="証拠品"
              count={ids.evidence.length}
              issues={issues}
            />
            <Item
              sel={{ kind: 'flags' }}
              name="フラグ"
              icon={<Flag />}
              label="フラグ"
              count={ids.flags.length}
              issues={issues}
            />
            <div className="h-2" />
            {parts.map((p) => (
              <PartNode
                key={p.index ?? 'legacy'}
                part={p}
                total={parts.filter((x) => x.index !== null).length}
                issues={issues}
              />
            ))}
            <div className="flex gap-1 pt-2">
              <Button
                variant="outline"
                size="sm"
                className="h-7 flex-1 text-xs"
                onClick={() => A.addPart(api(), 'investigation')}
              >
                <Plus /> 探索編
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="h-7 flex-1 text-xs"
                onClick={() => A.addPart(api(), 'trial')}
              >
                <Plus /> 裁判編
              </Button>
            </div>
            {hasLegacy && (
              <p className="px-1 pt-1 text-[11px] text-muted-foreground">
                この章は編に分かれていません（scenes
                だけの形式）。編を追加すると、今のシーンは最初の裁判編に移ります。
              </p>
            )}
          </>
        )}
        <div className="h-2" />
        <Item
          sel={{ kind: 'yaml' }}
          icon={<Code2 />}
          label="YAML（直接編集）"
          name="YAML（直接編集）"
          issues={issues}
        />
      </nav>
    </aside>
  );
});
