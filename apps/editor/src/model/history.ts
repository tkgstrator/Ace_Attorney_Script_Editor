// 元に戻す・やり直すための履歴。1 件の中身（何を戻すか）は使う側が決める（doc-session.ts の Entry）。
// 同じ入力欄への続けての入力（coalesceKey が同じで、間が短いもの）は merge で 1 件にまとめる。

export interface History<T> {
  past: T[];
  future: T[];
  lastKey: string | null;
  lastTime: number;
}

export const COALESCE_MS = 1000;
const LIMIT = 300;

export function createHistory<T>(): History<T> {
  return { past: [], future: [], lastKey: null, lastTime: 0 };
}

/** 新しい 1 件を積む。merge が null を返したときはまとめずに積む */
export function push<T>(
  h: History<T>,
  entry: T,
  coalesceKey: string | null = null,
  now = Date.now(),
  merge: (prev: T, next: T) => T | null = () => null,
): History<T> {
  const prev = h.past.at(-1);
  if (
    prev !== undefined &&
    coalesceKey !== null &&
    coalesceKey === h.lastKey &&
    now - h.lastTime < COALESCE_MS
  ) {
    const merged = merge(prev, entry);
    if (merged !== null)
      return {
        past: [...h.past.slice(0, -1), merged],
        future: [],
        lastKey: coalesceKey,
        lastTime: now,
      };
  }
  return {
    past: [...h.past, entry].slice(-LIMIT),
    future: [],
    lastKey: coalesceKey,
    lastTime: now,
  };
}

/** 戻す 1 件と、戻した後の履歴 */
export function undo<T>(h: History<T>): { history: History<T>; entry: T } | null {
  const entry = h.past.at(-1);
  if (entry === undefined) return null;
  return {
    history: {
      past: h.past.slice(0, -1),
      future: [entry, ...h.future],
      lastKey: null,
      lastTime: 0,
    },
    entry,
  };
}

/** やり直す 1 件と、やり直した後の履歴 */
export function redo<T>(h: History<T>): { history: History<T>; entry: T } | null {
  const entry = h.future[0];
  if (entry === undefined) return null;
  return {
    history: { past: [...h.past, entry], future: h.future.slice(1), lastKey: null, lastTime: 0 },
    entry,
  };
}

export const canUndo = <T>(h: History<T>) => h.past.length > 0;
export const canRedo = <T>(h: History<T>) => h.future.length > 0;
