// プレビューの画面の幅（4:3 / 16:9）。このブラウザに覚えておく
import type { Aspect } from '@gyakusai/runtime';
import { useSyncExternalStore } from 'react';

const KEY = 'gyakusai:editor:aspect';
const listeners = new Set<() => void>();

function load(): Aspect {
  try {
    return localStorage.getItem(KEY) === '16:9' ? '16:9' : '4:3';
  } catch {
    return '4:3';
  }
}

let current: Aspect = load();

export function setAspect(a: Aspect): void {
  current = a;
  try {
    localStorage.setItem(KEY, a);
  } catch {
    /* 覚えられなくてもよい */
  }
  for (const fn of listeners) fn();
}

const subscribe = (fn: () => void) => {
  listeners.add(fn);
  return () => listeners.delete(fn);
};

/** 今の画面の幅の設定（既定 4:3） */
export function useAspect(): Aspect {
  return useSyncExternalStore(subscribe, () => current);
}
