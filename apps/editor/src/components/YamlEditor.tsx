// YAML の直接編集。大きな章でも打てるよう、入力欄は React で持たず、打ち終わってから（少し待って）読み直す。
// 入力中の Ctrl/Cmd+Z は、この欄の中の取り消しになる（data-local-undo）。保存・元に戻すの前には反映する
import { useCallback, useEffect, useRef } from 'react';
import { Textarea } from '@/components/ui/textarea';
import { useEditorState, useEditorStore } from '@/state/editor-store.tsx';

/** text の line 行目（1 始まり）の始まりと終わりの位置 */
export function lineRange(text: string, line: number): [number, number] {
  let start = 0;
  for (let n = 1; n < line; n++) {
    const i = text.indexOf('\n', start);
    if (i < 0) return [text.length, text.length];
    start = i + 1;
  }
  const end = text.indexOf('\n', start);
  return [start, end < 0 ? text.length : end];
}

export function YamlEditor() {
  const store = useEditorStore();
  const parseError = useEditorState((s) => s.parseError);
  const file = useEditorState((s) => s.file);
  const version = useEditorState((s) => s.version);
  const size = useEditorState((s) => s.size);
  const focus = useEditorState((s) => s.focus);
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

  useEffect(
    () =>
      store.registerDraft({
        flush: () => {
          flush();
          return null;
        },
        element: () => area.current,
      }),
    [store, flush],
  );
  // 閉じるときにも反映する
  useEffect(() => flush, [flush]);

  // 元に戻すなど、ほかの所で内容が変わったら入れ直す
  useEffect(() => {
    if (!area.current || shown.current === version || timer.current !== null) return;
    area.current.value = store.actions.getText();
    shown.current = version;
  }, [store, version]);

  // 診断から開いたとき: その行を選ぶ
  useEffect(() => {
    const el = area.current;
    const line = focus?.line;
    if (!el || !line) return;
    const [a, b] = lineRange(el.value, line);
    el.focus();
    el.setSelectionRange(a, b);
    // 行の高さから、だいたいの位置までスクロールする
    const lh = Number.parseFloat(getComputedStyle(el).lineHeight) || 16;
    el.scrollTop = Math.max(0, (line - 5) * lh);
  }, [focus]);

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
      {parseError && (
        <p className="rounded-md bg-destructive/10 p-2 text-sm text-destructive" role="alert">
          YAML の構文エラー: {parseError}（直すまでフォームでは編集できません）
        </p>
      )}
      <Textarea
        ref={area}
        data-local-undo
        aria-label="章の YAML"
        className="h-[75vh] font-mono text-xs leading-relaxed field-sizing-fixed"
        spellCheck={false}
        onInput={onInput}
        onBlur={flush}
      />
    </div>
  );
}
