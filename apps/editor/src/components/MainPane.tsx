// 真ん中: 選んでいる項目の編集画面
import {
  ArrowLeft,
  ChevronsDownUp,
  ChevronsUpDown,
  MessageSquareQuote,
  MessagesSquare,
  Play,
} from 'lucide-react';
import { type ReactNode, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { listParts, pathKey, placePath, scenePath, selectionLabel } from '@/model/paths.ts';
import { isTestimony } from '@/model/steps.ts';
import { PART_LABELS } from '@/model/structure.ts';
import { getIn } from '@/model/yaml-doc.ts';
import { useActions, useData, useEditorState } from '@/state/editor-store.tsx';
import { MetaEditor, PartEditor } from './MetaEditor.tsx';
import { PlaceEditor } from './place/PlaceEditor.tsx';
import { focusTarget, revealPath } from './reveal.ts';
import { foldAll, resetFold } from './steps/Nested.tsx';
import { StepList } from './steps/StepList.tsx';
import { ViewBar } from './steps/ViewBar.tsx';
import { TestimonyEditor } from './TestimonyEditor.tsx';
import { CharactersTable, EvidenceTable, FlagsTable } from './tables/RecordTables.tsx';
import { YamlEditor } from './YamlEditor.tsx';

export function MainPane({ onPlay }: { onPlay: (scene: string) => void }) {
  const selection = useEditorState((s) => s.selection);
  const data = useData();
  const parseError = useEditorState((s) => s.parseError);
  const focus = useEditorState((s) => s.focus);
  const root = useRef<HTMLDivElement>(null);

  // 診断・検索から開いたとき: その場所を（隠れていれば開いて）見せ、入力欄にフォーカスして、少し光らせる
  useEffect(() => {
    const r = root.current;
    if (!focus || !r || focus.path.length === 0) return;
    let alive = true;
    const id = setTimeout(() => {
      void revealPath(r, focus.path, () => alive).then((el) => {
        if (!alive) return;
        if (!el) {
          r.scrollTo({ top: 0 });
          return;
        }
        el.scrollIntoView({ block: 'center' });
        const target = focusTarget(el);
        target?.focus({ preventScroll: true });
        (target ?? el).animate(
          [{ boxShadow: '0 0 0 3px rgb(239 68 68 / 0.8)' }, { boxShadow: '0 0 0 3px transparent' }],
          { duration: 1600 },
        );
      });
    });
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [focus]);

  let body: ReactNode;
  if (selection.kind === 'yaml' || (parseError && data === null)) body = <YamlEditor />;
  else if (!data) body = <p className="text-muted-foreground">章を読み込んでいます…</p>;
  else {
    switch (selection.kind) {
      case 'meta':
        body = <MetaEditor />;
        break;
      case 'characters':
        body = <CharactersTable />;
        break;
      case 'evidence':
        body = <EvidenceTable />;
        break;
      case 'flags':
        body = <FlagsTable />;
        break;
      case 'part':
        body = <PartEditor index={selection.part} />;
        break;
      case 'scene':
        body = <SceneEditor part={selection.part} id={selection.id} onPlay={onPlay} />;
        break;
      case 'place': {
        const path = placePath(selection.part, selection.id);
        const place = getIn(data, path);
        body = (
          <div className="space-y-4">
            <Header kicker={partLabel(data, selection.part)} title={`場所: ${selection.id}`} />
            <ViewBar />
            <PlaceEditor
              key={pathKey(path)}
              path={path}
              id={selection.id}
              place={(place ?? {}) as Record<string, unknown>}
            />
          </div>
        );
        break;
      }
    }
  }
  return (
    <main ref={root} className="min-w-0 flex-1 overflow-y-auto" aria-label="編集">
      <div className="mx-auto max-w-5xl p-6 pb-40">
        <BackBar />
        {body}
      </div>
    </main>
  );
}

function partLabel(data: Record<string, unknown>, part: number | null): string {
  const p = listParts(data).find((x) => x.index === part);
  return p ? `${PART_LABELS[p.kind]}「${p.title || p.id}」` : '';
}

function Header({
  kicker,
  title,
  children,
}: {
  kicker: string;
  title: string;
  children?: ReactNode;
}) {
  return (
    <div className="flex items-end gap-3 border-b pb-3">
      <div>
        <div className="text-xs text-muted-foreground">{kicker}</div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">{title}</h2>
      </div>
      <div className="ml-auto flex items-center gap-2">{children}</div>
    </div>
  );
}

/** 参照先を開いたときの「元の場所へ戻る」 */
function BackBar() {
  const stack = useEditorState((s) => s.backStack);
  const { back } = useActions();
  const last = stack.at(-1);
  if (!last) return null;
  return (
    <Button variant="ghost" size="sm" className="-mt-3 mb-2 h-7 text-xs" onClick={back}>
      <ArrowLeft /> 元の場所へ戻る（{selectionLabel(last.selection)}）
    </Button>
  );
}

/** 入れ子（分岐・選択肢など）をすべて折りたたむ・開く */
function FoldButtons({ scene }: { scene: string }) {
  // 別のシーンを開いたら、折りたたみを戻す（中のカードを作る前に。見出しはカードより先に描かれる）
  const shown = useRef(scene);
  if (shown.current !== scene) {
    shown.current = scene;
    resetFold();
  }
  useEffect(() => resetFold, []);
  return (
    <span className="flex items-center">
      <Button
        size="sm"
        variant="ghost"
        className="h-8 px-2 text-xs"
        title="分岐・選択肢などの中をすべて折りたたみ、要約だけにします"
        onClick={() => foldAll(false)}
      >
        <ChevronsDownUp /> すべて折りたたむ
      </Button>
      <Button
        size="sm"
        variant="ghost"
        className="h-8 px-2 text-xs"
        title="すべて開く"
        aria-label="すべて開く"
        onClick={() => foldAll(true)}
      >
        <ChevronsUpDown />
      </Button>
    </span>
  );
}

function SceneEditor({
  part,
  id,
  onPlay,
}: {
  part: number | null;
  id: string;
  onPlay: (scene: string) => void;
}) {
  const data = useData();
  const path = scenePath(part, id);
  const scene = getIn(data, path);
  const testimony = isTestimony(scene);
  return (
    <div className="space-y-4">
      <Header kicker={partLabel(data!, part)} title={`シーン: ${id}`}>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {testimony ? (
            <>
              <MessageSquareQuote className="size-4 text-orange-500" /> 証言
            </>
          ) : (
            <>
              <MessagesSquare className="size-4 text-sky-600" /> 会話・演出
            </>
          )}
        </span>
        {!testimony && <FoldButtons scene={id} />}
        <Button size="sm" variant="outline" className="h-8" onClick={() => onPlay(id)}>
          <Play /> ここから再生
        </Button>
      </Header>
      <ViewBar />
      {testimony ? (
        <TestimonyEditor key={pathKey(path)} path={path} scene={scene} />
      ) : (
        <StepList
          key={pathKey(path)}
          path={path}
          steps={scene}
          emptyLabel="ステップがありません。下の「ステップを追加」から足してください"
        />
      )}
    </div>
  );
}
