import { HEIGHT, WIDTH } from './layout.ts';

/**
 * canvas を親要素に収まるように拡大する。
 * 1 倍以上に拡大できるときは整数倍にして、ドットの大きさをそろえる。
 * 戻り値は監視を止める関数。
 */
export function fitCanvas(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  maxHeightRatio = 0.8,
): () => void {
  canvas.style.imageRendering = 'pixelated';
  const fit = () => {
    const dpr = window.devicePixelRatio || 1;
    const aw = container.clientWidth;
    const ah = window.innerHeight * maxHeightRatio;
    // 1 ドットがデバイスピクセルの整数倍になるように倍率を決める
    const raw = Math.min(aw / WIDTH, ah / HEIGHT) * dpr;
    const scale = (raw >= 1 ? Math.floor(raw) : raw) / dpr;
    canvas.style.width = `${Math.floor(WIDTH * scale)}px`;
    canvas.style.height = `${Math.floor(HEIGHT * scale)}px`;
  };
  const ro = new ResizeObserver(fit);
  ro.observe(container);
  window.addEventListener('resize', fit);
  fit();
  return () => {
    ro.disconnect();
    window.removeEventListener('resize', fit);
  };
}
