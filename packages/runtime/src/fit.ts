import { DOT, HEIGHT, WIDTH } from './layout.ts';

/**
 * canvas を親要素に収まるように拡大する。
 * 1 倍以上に拡大できるときは整数倍にして、ドットの大きさをそろえる。
 * 画面の大きさ（ドット）は canvas の大きさから読む（Player が画面の幅に合わせて決める。決める前は 4:3）。
 * 戻り値は監視を止める関数。
 */
export function fitCanvas(
  canvas: HTMLCanvasElement,
  container: HTMLElement,
  maxHeightRatio = 0.8,
): () => void {
  canvas.style.imageRendering = 'pixelated';
  const fit = () => {
    const sized = canvas.hasAttribute('width') && canvas.hasAttribute('height');
    const W = sized ? canvas.width / DOT : WIDTH,
      H = sized ? canvas.height / DOT : HEIGHT;
    const dpr = window.devicePixelRatio || 1;
    const aw = container.clientWidth;
    const ah = window.innerHeight * maxHeightRatio;
    // 1 ドットがデバイスピクセルの整数倍になるように倍率を決める
    const raw = Math.min(aw / W, ah / H) * dpr;
    const scale = (raw >= 1 ? Math.floor(raw) : raw) / dpr;
    canvas.style.width = `${Math.floor(W * scale)}px`;
    canvas.style.height = `${Math.floor(H * scale)}px`;
  };
  const ro = new ResizeObserver(fit);
  ro.observe(container);
  // Player が canvas の大きさ（画面の幅）を決めたら合わせ直す
  const mo = new MutationObserver(fit);
  mo.observe(canvas, { attributes: true, attributeFilter: ['width', 'height'] });
  window.addEventListener('resize', fit);
  fit();
  return () => {
    ro.disconnect();
    mo.disconnect();
    window.removeEventListener('resize', fit);
  };
}
