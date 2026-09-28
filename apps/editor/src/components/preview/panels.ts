// 右のパネルのうち、どの欄を出すか（ゲーム・整合性チェック・診断）。このブラウザに覚えておく
import { useState } from 'react';

export interface Panels {
  game: boolean;
  verify: boolean;
  diagnostics: boolean;
}

const KEY = 'gyakusai:editor:panels';
const ALL: Panels = { game: true, verify: true, diagnostics: true };

function load(): Panels {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null') as Partial<Panels> | null;
    return { ...ALL, ...(v ?? {}) };
  } catch {
    return ALL;
  }
}

export function usePanels(): [Panels, (k: keyof Panels) => void, (k: keyof Panels) => void] {
  const [panels, setPanels] = useState(load);
  const set = (k: keyof Panels, on: (was: boolean) => boolean) =>
    setPanels((p) => {
      if (p[k] === on(p[k])) return p;
      const next = { ...p, [k]: on(p[k]) };
      try {
        localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* 覚えられなくてもよい */
      }
      return next;
    });
  /** 出す・隠すを切り替える / 出す（隠れていれば） */
  return [panels, (k) => set(k, (was) => !was), (k) => set(k, () => true)];
}
