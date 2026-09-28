// 画面全体の配置: 左に一覧、真ん中に編集、右にプレビュー（たためる）。上にツールバー

import { PanelRightClose, PanelRightOpen, Redo2, Save, Undo2 } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { DialogHost } from '@/components/dialogs.tsx';
import { MainPane } from '@/components/MainPane.tsx';
import { type PlayRequest, Preview } from '@/components/preview/Preview.tsx';
import { MIN_MAIN, Resizer, usePanelWidth, useWindowWidth } from '@/components/Resizer.tsx';
import { type IssueCounts, Sidebar, selectionKey } from '@/components/sidebar/Sidebar.tsx';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { casePath } from '@/model/case-roots.ts';
import { selectionFromPath } from '@/model/paths.ts';
import { AUTO_COMPILE_LIMIT, useCompile } from '@/preview/use-compile.ts';
import { useEditorState, useEditorStore } from '@/state/editor-store.tsx';
import { useShortcuts } from '@/state/use-shortcuts.ts';

const isMac = navigator.platform.toLowerCase().includes('mac');
const MOD = isMac ? '⌘' : 'Ctrl+';

const SIDEBAR = { initial: 288, min: 200, max: 480 };
const PREVIEW = { initial: 440, min: 300, max: 900 };

export function App() {
  const store = useEditorStore();
  const file = useEditorState((s) => s.file);
  const dirty = useEditorState((s) => s.dirty);
  const message = useEditorState((s) => s.message);
  const version = useEditorState((s) => s.version);
  const size = useEditorState((s) => s.size);
  const canUndo = useEditorState((s) => s.canUndo);
  const canRedo = useEditorState((s) => s.canRedo);
  const api = store.actions;
  const [showPreview, setShowPreview] = useState(true);
  const [play, setPlay] = useState<PlayRequest>({ scene: null, serial: 0 });
  const { compiled, compiling, compileLatest } = useCompile(store, { file, version, size, dirty });
  useShortcuts(store);

  // パネルの幅。真ん中の編集の欄に MIN_MAIN は残す（狭いときは右、次に左を縮める）
  const [sideW, setSideW] = usePanelWidth(
    'gyakusai:editor:sidebar',
    SIDEBAR.initial,
    SIDEBAR.min,
    SIDEBAR.max,
  );
  const [prevW, setPrevW] = usePanelWidth(
    'gyakusai:editor:preview',
    PREVIEW.initial,
    PREVIEW.min,
    PREVIEW.max,
  );
  const win = useWindowWidth();
  const room = win - MIN_MAIN;
  const shownPrev = showPreview ? Math.max(PREVIEW.min, Math.min(prevW, room - sideW)) : 0;
  const shownSide = Math.max(SIDEBAR.min, Math.min(sideW, room - shownPrev));

  const result = compiled?.result ?? null;
  const issues = useMemo<IssueCounts>(() => {
    const m: IssueCounts = new Map();
    for (const d of result?.diagnostics ?? []) {
      const t = selectionFromPath(d.path);
      if (!t) continue;
      const k = selectionKey(t.selection);
      const c = m.get(k) ?? { errors: 0, warnings: 0 };
      if (d.severity === 'error') c.errors++;
      else c.warnings++;
      m.set(k, c);
    }
    return m;
  }, [result]);

  const onPlay = useCallback(
    (scene: string) => {
      setShowPreview(true);
      void compileLatest().then(() => setPlay((p) => ({ scene, serial: p.serial + 1 })));
    },
    [compileLatest],
  );

  // 保存していない変更があるときは、閉じる前に確認する
  useEffect(() => {
    const onUnload = (e: BeforeUnloadEvent) => {
      if (dirty) e.preventDefault();
    };
    window.addEventListener('beforeunload', onUnload);
    return () => window.removeEventListener('beforeunload', onUnload);
  }, [dirty]);

  useEffect(() => {
    document.title = `${dirty ? '● ' : ''}${file ?? ''} | 逆裁エディタ`;
  }, [file, dirty]);

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-11 shrink-0 items-center gap-2 border-b px-3">
        <span className="font-semibold">逆裁エディタ</span>
        <span className="font-mono text-xs text-muted-foreground">
          {file ? casePath(file) : ''}
        </span>
        {dirty && <span className="text-xs text-amber-600">● 未保存</span>}
        <div className="ml-auto flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            disabled={!canUndo}
            onClick={api.undo}
            title={`元に戻す（${MOD}Z）`}
            aria-label="元に戻す"
          >
            <Undo2 />
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            disabled={!canRedo}
            onClick={api.redo}
            title={`やり直す（${MOD}Shift+Z）`}
            aria-label="やり直す"
          >
            <Redo2 />
          </Button>
          <Button
            size="sm"
            className="h-8"
            disabled={!dirty}
            onClick={() => void api.save()}
            title={`保存（${MOD}S）`}
          >
            <Save /> 保存
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-8"
            onClick={() => setShowPreview(!showPreview)}
            title="プレビューの表示・非表示"
            aria-label="プレビューの表示・非表示"
            aria-pressed={showPreview}
          >
            {showPreview ? <PanelRightClose /> : <PanelRightOpen />}
          </Button>
        </div>
      </header>
      <div className="flex min-h-0 flex-1">
        <Sidebar issues={issues} width={shownSide} />
        <Resizer
          side="left"
          label="左の一覧の幅"
          width={shownSide}
          min={SIDEBAR.min}
          max={SIDEBAR.max}
          onChange={setSideW}
        />
        <MainPane onPlay={onPlay} />
        {showPreview && (
          <Resizer
            side="right"
            label="プレビューの幅"
            width={shownPrev}
            min={PREVIEW.min}
            max={PREVIEW.max}
            onChange={setPrevW}
          />
        )}
        <aside
          className={cn('shrink-0 border-l bg-muted/20', !showPreview && 'hidden')}
          style={{ width: shownPrev }}
          aria-label="プレビューと診断"
        >
          <Preview
            key={file ?? ''}
            compiled={compiled}
            version={version}
            play={play}
            compiling={compiling}
            onCompile={compileLatest}
            large={size > AUTO_COMPILE_LIMIT}
          />
        </aside>
      </div>
      <div
        role={message?.error ? 'alert' : 'status'}
        aria-live={message?.error ? 'assertive' : 'polite'}
      >
        {message && (
          <div
            className={cn(
              'fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-md px-4 py-2 text-sm text-white shadow-lg',
              message.error ? 'bg-destructive' : 'bg-zinc-800',
            )}
          >
            {message.text}
          </div>
        )}
      </div>
      <DialogHost />
    </div>
  );
}
