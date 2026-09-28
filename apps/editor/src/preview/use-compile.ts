// 編集中の章をコンパイルする（Web Worker）。小さな章は編集のたびに（少し待って）自動で、大きな章は頼まれたときだけ。
// 結果には、どの章（file）のどの版（version）をコンパイルしたかを付ける
import type { CompileResult } from '@gyakusai/script';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { EditorStore } from '@/state/store.ts';
import { Compiler } from './compiler.ts';

/** これより小さい章は、編集のたびに（少し待って）自動でコンパイルし直す。大きな章は頼まれたときだけ */
export const AUTO_COMPILE_LIMIT = 400_000;
const AUTO_COMPILE_DELAY = 300;

export interface Compiled {
  file: string;
  version: number;
  text: string;
  result: CompileResult;
}

export function useCompile(
  store: EditorStore,
  {
    file,
    version,
    size,
    dirty,
  }: { file: string | null; version: number; size: number; dirty: boolean },
) {
  const [compiled, setCompiled] = useState<Compiled | null>(null);
  const [compiling, setCompiling] = useState(0);
  const compiler = useRef<Compiler | null>(null);
  const latest = useRef(compiled);
  latest.current = compiled;
  /** コンパイル中のもの（同じ版を二重に頼まない） */
  const inflight = useRef<{
    file: string;
    version: number;
    promise: Promise<Compiled | null>;
  } | null>(null);
  useEffect(() => () => compiler.current?.dispose(), []);

  /** 今の内容をコンパイルする（前にコンパイルした内容と同じなら、それを使う） */
  const recompile = useCallback((): Promise<Compiled | null> => {
    const { version: v, file: f } = store.state;
    if (!f) return Promise.resolve(null);
    if (latest.current?.file === f && latest.current.version === v)
      return Promise.resolve(latest.current);
    if (inflight.current?.file === f && inflight.current.version === v)
      return inflight.current.promise;
    const promise = (async () => {
      setCompiling((n) => n + 1);
      try {
        const started = performance.now();
        const text = store.actions.getText();
        performance.measure('editor:stringify', { start: started });
        compiler.current ??= new Compiler();
        const result = await compiler.current.compile(text);
        const c = { file: f, version: v, text, result };
        // 待っている間に別の章を開いていたら捨てる。Worker は頼んだ順に返すので、同じ章なら最後に届いたものがいちばん新しい
        if (store.state.file !== f) return null;
        latest.current = c;
        setCompiled(c);
        return c;
      } catch (e) {
        store.actions.notify(`コンパイルできませんでした: ${(e as Error).message}`, true);
        return null;
      } finally {
        setCompiling((n) => n - 1);
        if (inflight.current?.file === f && inflight.current.version === v) inflight.current = null;
      }
    })();
    inflight.current = { file: f, version: v, promise };
    return promise;
  }, [store]);

  // 小さな章は編集のたびに自動で。大きな章でも、テキストを作り直さずに済むとき（開いた直後・保存の後・元に戻して
  // 前と同じ内容になったとき）は自動で。compiled も見るのは、コンパイル中に内容が変わった場合にやり直すため
  // biome-ignore lint/correctness/useExhaustiveDependencies: version・dirty・compiled が変わったときにも見直す
  useEffect(() => {
    if (!file) return;
    const small = size <= AUTO_COMPILE_LIMIT;
    if (!small && !store.textReady()) return;
    const t = setTimeout(() => void recompile(), small ? AUTO_COMPILE_DELAY : 0);
    return () => clearTimeout(t);
  }, [file, version, size, dirty, compiled, store, recompile]);

  // 別の章の結果は使わない
  const current = compiled?.file === file ? compiled : null;
  return { compiled: current, compiling: compiling > 0, recompile };
}
