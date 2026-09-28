// エディタの状態（store.ts）を React から使うための入口。
// useEditor() はすべてを見るので、何か変わるたびに描き直される。1 文字ごとに描き直したくない部品
// （ステップのカードの中など）は、useActions() / useIds() / useEditorState() で必要な所だけを見る。
import {
  createContext,
  useContext,
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import type { Data } from '@/model/doc-session.ts';
import {
  EditorStore,
  type EditorActions,
  type EditorApi,
  type EditorState,
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
