// 診断・検索から開いたときに、指定のパスの入力欄までたどり着く。
// 入力欄などには data-path（pathKey）を付けておく。まだ描いていない所（遅延描画の空の箱・折りたたんだ入れ子・
// 「フォームにない項目」）には data-reveal を付けておき、editor:reveal イベントで開いてもらう
import { useEffect, useRef } from 'react';
import { pathKey } from '@/model/paths.ts';
import type { Path } from '@/model/yaml-doc.ts';

export const REVEAL_EVENT = 'editor:reveal';
const INPUTS = 'input:not([type=hidden]), textarea, select, button[role=checkbox]';
const FOCUSABLE = `${INPUTS}, button, [tabindex]`;

/** 描き直しを待つ（画面が隠れていて requestAnimationFrame が来ないときも、少し待てば進む） */
const nextFrame = () =>
  new Promise((r) => {
    const t = setTimeout(r, 50);
    requestAnimationFrame(() => {
      clearTimeout(t);
      r(null);
    });
  });

/** path に一番近い（いちばん長く一致する）data-path の要素 */
function deepest(root: HTMLElement, path: Path): HTMLElement | null {
  for (let n = path.length; n > 0; n--) {
    const el = root.querySelector<HTMLElement>(
      `[data-path="${CSS.escape(pathKey(path.slice(0, n)))}"]`,
    );
    if (el) return el;
  }
  return null;
}

/**
 * path の要素を探し、隠れていれば開いてから返す（見つからなければ null）。
 * alive が false になったら（別の所を開いたなど）やめる
 */
export async function revealPath(
  root: HTMLElement,
  path: Path,
  alive: () => boolean,
): Promise<HTMLElement | null> {
  for (let i = 0; i < 12 && alive(); i++) {
    const el = deepest(root, path);
    if (!el) return null;
    const hidden = el.closest<HTMLElement>('[data-reveal]');
    if (!hidden) return el;
    hidden.dispatchEvent(new CustomEvent(REVEAL_EVENT));
    await nextFrame();
    await nextFrame();
  }
  return alive() ? deepest(root, path) : null;
}

/** 要素そのものか、その中（なければ data-focus-root の中）の入力欄 */
export function focusTarget(el: HTMLElement): HTMLElement | null {
  if (el.matches(FOCUSABLE)) return el;
  return (
    el.querySelector<HTMLElement>(INPUTS) ??
    el.closest('[data-focus-root]')?.querySelector<HTMLElement>(INPUTS) ??
    el.querySelector<HTMLElement>(FOCUSABLE)
  );
}

/** data-reveal を付けた要素で、editor:reveal を受けたら onReveal を呼ぶ */
export function useRevealListener<T extends HTMLElement>(active: boolean, onReveal: () => void) {
  const ref = useRef<T>(null);
  const latest = useRef(onReveal);
  latest.current = onReveal;
  useEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const fn = () => latest.current();
    el.addEventListener(REVEAL_EVENT, fn);
    return () => el.removeEventListener(REVEAL_EVENT, fn);
  }, [active]);
  return ref;
}
