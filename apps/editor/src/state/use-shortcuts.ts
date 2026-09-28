// キー操作: 保存・元に戻す・やり直す・参照元へ戻る。
// ダイアログの中と、下書きを持つ欄（data-local-undo: YAML・ID の欄など）では、Ctrl/Cmd+Z は欄の中の取り消しにする
// 入力欄の外で押したキーはプレビューに渡さない
import { useEffect } from 'react';
import type { EditorStore } from './store.ts';

/** 欄の中の取り消しを優先する場所か */
export function isLocalUndoTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false;
  return target.closest('[role="dialog"], [role="alertdialog"], [data-local-undo]') !== null;
}

export function useShortcuts(store: EditorStore): void {
  useEffect(() => {
    const api = store.actions;
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const k = e.key.toLowerCase();
      if (mod && k === 's') {
        e.preventDefault();
        if (document.querySelector('[role="dialog"]')) {
          api.notify('ダイアログを閉じてから保存してください', true);
          return;
        }
        void api.save();
        return;
      }
      const isUndo = mod && k === 'z' && !e.shiftKey;
      const isRedo = mod && ((k === 'z' && e.shiftKey) || k === 'y');
      if ((isUndo || isRedo) && isLocalUndoTarget(e.target)) return;
      if (isUndo) {
        e.preventDefault();
        api.undo();
        return;
      }
      if (isRedo) {
        e.preventDefault();
        api.redo();
        return;
      }
      const typing =
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        e.target instanceof HTMLSelectElement;
      if (!typing && e.altKey && e.key === 'ArrowLeft' && store.state.backStack.length > 0) {
        e.preventDefault();
        api.back();
        return;
      }
      if (e.target === document.body) e.stopPropagation();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [store]);
}
