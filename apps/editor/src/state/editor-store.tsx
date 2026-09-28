// エディタの状態（store.ts）を React から使うための入口。
// useEditor() はすべてを見るので、何か変わるたびに描き直される。1 文字ごとに描き直したくない部品
// （ステップのカードの中など）は、useActions() / useIds() / useEditorState() で必要な所だけを見る。
import {
  createContext,
  type ReactNode,
  type RefObject,
  useContext,
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import type { Data } from '@/model/doc-session.ts';
import {
  type EditorActions,
  type EditorApi,
  type EditorState,
  EditorStore,
  type FlagValue,
  type Ids,
} from './store.ts';

export type { EditorApi, FlagValue };

const Ctx = createContext<EditorStore | null>(null);

export function useEditorStore(): EditorStore {
  const store = useContext(Ctx);
  if (!store) throw new Error('EditorProvider の中で使ってください');
  return store;
}

/** 状態の一部だけを見る。selector は状態の中の値をそのまま返すこと（毎回新しいものを作らない） */
export function useEditorState<T>(selector: (s: EditorState) => T): T {
  const store = useEditorStore();
  return useSyncExternalStore(store.subscribe, () => selector(store.state));
}

/** すべての状態とアクション（何か変わるたびに描き直される） */
export function useEditor(): EditorApi {
  const store = useEditorStore();
  const state = useSyncExternalStore(store.subscribe, () => store.state);
  return { ...state, ...store.actions };
}

/** アクションだけ（変わらないので、描き直しのきっかけにならない） */
export const useActions = (): EditorActions => useEditorStore().actions;
export const useIds = (): Ids => useEditorState((s) => s.ids);
export const useData = (): Data | null => useEditorState((s) => s.data);
export const useFlagValues = (): Record<string, FlagValue> => useEditorState((s) => s.flagValues);

/**
 * まだ章に反映していない入力（下書き）を持つ欄から使う。active の間、保存・元に戻すの前に flush が呼ばれる。
 * flush は、反映できれば反映して null、できなければ理由を返す。欄がなくなるときにも（反映できれば）反映する
 */
export function useDraft(
  active: boolean,
  flush: () => string | null,
  element: RefObject<HTMLElement | null>,
): void {
  const store = useEditorStore();
  const latest = useRef(flush);
  latest.current = flush;
  useEffect(() => {
    if (!active) return;
    const off = store.registerDraft({
      flush: () => latest.current(),
      element: () => element.current,
    });
    return () => {
      off();
      latest.current();
    };
  }, [store, active, element]);
}

export function EditorProvider({ children }: { children: ReactNode }) {
  const [store] = useState(() => new EditorStore());
  const message = useSyncExternalStore(store.subscribe, () => store.state.message);

  useEffect(() => {
    void store.start();
  }, [store]);

  useEffect(() => {
    if (!message) return;
    const id = setTimeout(() => store.clearMessage(message), message.error ? 6000 : 2500);
    return () => clearTimeout(id);
  }, [store, message]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}
