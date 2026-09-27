// 真ん中: 選んでいる項目の編集画面
import { MessageSquareQuote, MessagesSquare, Play } from 'lucide-react';
import { useCallback, useEffect, useRef, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import { listParts, pathKey, placePath, scenePath } from '@/model/paths.ts';
import { isTestimony } from '@/model/steps.ts';
import { PART_LABELS } from '@/model/structure.ts';
import { getIn } from '@/model/yaml-doc.ts';
import { useData, useEditorState, useEditorStore } from '@/state/editor-store.tsx';
import { MetaEditor, PartEditor } from './MetaEditor.tsx';
import { PlaceEditor } from './place/PlaceEditor.tsx';
import { StepList } from './steps/StepList.tsx';
import { CharactersTable, EvidenceTable, FlagsTable } from './tables/RecordTables.tsx';
import { TestimonyEditor } from './TestimonyEditor.tsx';

export function MainPane({ onPlay }: { onPlay: (scene: string) => void }) {
  const selection = useEditorState(s => s.selection);
  const data = useData();
  const parseError = useEditorState(s => s.parseError);
  const focus = useEditorState(s => s.focus);
  const root = useRef<HTMLDivElement>(null);

  // 診断から開いたとき: いちばん近い入力欄の場所までスクロールして、少し光らせる
  useEffect(() => {
    if (!focus || !root.current) return;
    const find = () => {
      for (let n = focus.path.length; n > 0; n--) {
        const el = root.current?.querySelector<HTMLElement>(`[data-path="${CSS.escape(pathKey(focus.path.slice(0, n)))}"]`);
        if (el) return el;
      }
      return null;
    };
    const flash = (el: HTMLElement) =>
      el.animate([{ boxShadow: '0 0 0 3px rgb(239 68 68 / 0.8)' }, { boxShadow: '0 0 0 3px transparent' }], { duration: 1600 });
    let later: ReturnType<typeof setTimeout> | undefined;
    const id = requestAnimationFrame(() => {
      const el = find();
      if (!el) { root.current?.scrollTo({ top: 0 }); return; }
      el.scrollIntoView({ block: 'center', behavior: 'smooth' });
      flash(el);
      // 長い列ではカードがまだ作られていない（空の箱だった）ことがある。作られた後にもう一度合わせる
      later = setTimeout(() => {
        const again = find();
        if (again && again !== el) { again.scrollIntoView({ block: 'center' }); flash(again); }
      }, 500);
    });
    return () => { cancelAnimationFrame(id); clearTimeout(later); };
  }, [focus]);

  let body;
  if (selection.kind === 'yaml' || (parseError && data === null)) body = <YamlEditor />;
  else if (!data) body = <p className="text-muted-foreground">章を読み込んでいます…</p>;
  else {
    switch (selection.kind) {
      case 'meta': body = <MetaEditor />; break;
      case 'characters': body = <CharactersTable />; break;
      case 'evidence': body = <EvidenceTable />; break;
      case 'flags': body = <FlagsTable />; break;
      case 'part': body = <PartEditor index={selection.part} />; break;
      case 'scene': body = <SceneEditor part={selection.part} id={selection.id} onPlay={onPlay} />; break;
      case 'place': {
        const path = placePath(selection.part, selection.id);
        const place = getIn(data, path);
        body = (
          <div className="space-y-4">
            <Header kicker={partLabel(data, selection.part)} title={`場所: ${selection.id}`} />
            <PlaceEditor key={pathKey(path)} path={path} id={selection.id} place={(place ?? {}) as Record<string, unknown>} />
          </div>
        );
        break;
      }
    }
  }
  return (
    <main ref={root} className="min-w-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-5xl p-6 pb-40">{body}</div>
    </main>
  );
}

function partLabel(data: Record<string, unknown>, part: number | null): string {
  const p = listParts(data).find(x => x.index === part);
  return p ? `${PART_LABELS[p.kind]}「${p.title || p.id}」` : '';
}

function Header({ kicker, title, children }: { kicker: string; title: string; children?: ReactNode }) {
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

function SceneEditor({ part, id, onPlay }: { part: number | null; id: string; onPlay: (scene: string) => void }) {
  const data = useData();
  const path = scenePath(part, id);
  const scene = getIn(data, path);
  const testimony = isTestimony(scene);
  return (
    <div className="space-y-4">
      <Header kicker={partLabel(data!, part)} title={`シーン: ${id}`}>
        <span className="flex items-center gap-1 text-xs text-muted-foreground">
          {testimony ? <><MessageSquareQuote className="size-4 text-orange-500" /> 証言</> : <><MessagesSquare className="size-4 text-sky-600" /> 会話・演出</>}
        </span>
        <Button size="sm" variant="outline" className="h-8" onClick={() => onPlay(id)}><Play /> ここから再生</Button>
      </Header>
      {testimony
        ? <TestimonyEditor key={pathKey(path)} path={path} scene={scene} />
        : <StepList key={pathKey(path)} path={path} steps={scene} emptyLabel="ステップがありません。下の「ステップを追加」から足してください" />}
    </div>
  );
}

/** YAML の直接編集。大きな章でも打てるよう、入力欄は React で持たず、打ち終わってから（少し待って）読み直す */
function YamlEditor() {
  const store = useEditorStore();
  const parseError = useEditorState(s => s.parseError);
  const file = useEditorState(s => s.file);
  const version = useEditorState(s => s.version);
  const size = useEditorState(s => s.size);
  const area = useRef<HTMLTextAreaElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 入力欄に出している内容の版 */
  const shown = useRef<number | null>(null);

  const flush = useCallback(() => {
    if (timer.current === null) return;
    clearTimeout(timer.current);
    timer.current = null;
    if (area.current) store.actions.setText(area.current.value, 'yaml');
    shown.current = store.state.version;
  }, [store]);

  useEffect(() => {
    store.flushPending = flush;
    return () => { flush(); if (store.flushPending === flush) store.flushPending = null; };
  }, [store, flush]);

  // 元に戻すなど、ほかの所で内容が変わったら入れ直す
  useEffect(() => {
    if (!area.current || shown.current === version || timer.current !== null) return;
    area.current.value = store.actions.getText();
    shown.current = version;
  }, [store, version]);

  const onInput = () => {
    if (timer.current !== null) clearTimeout(timer.current);
    // 読み直しは大きな章ほど時間がかかるので、長めに待つ
    timer.current = setTimeout(flush, size > 500_000 ? 1500 : 400);
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <h2 className="text-lg font-semibold">YAML</h2>
        <span className="font-mono text-xs text-muted-foreground">{file}</span>
      </div>
      {parseError && <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive">YAML の構文エラー: {parseError}（直すまでフォームでは編集できません）</p>}
      <Textarea
        ref={area} className="h-[75vh] font-mono text-xs leading-relaxed field-sizing-fixed" spellCheck={false}
        onInput={onInput} onBlur={flush}
      />
    </div>
  );
}
