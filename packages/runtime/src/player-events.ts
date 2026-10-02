// キャンバスの入力を画面の座標に直し、終了時にまとめて解除する。
import type { PlayerHost } from './player-host.ts';
import { click, key } from './player-input.ts';

export function bindPlayerInput(
  canvas: HTMLCanvasElement,
  host: PlayerHost,
  syncBeat: () => void,
): () => void {
  const presses = host.p.buttons;
  let pointer: number | null = null;
  let startedOnButton = false;
  let serial = 0;
  const point = (e: PointerEvent): [number, number] => {
    const b = canvas.getBoundingClientRect();
    return [
      Math.floor(((e.clientX - b.left) / b.width) * host.p.layout.w),
      Math.floor(((e.clientY - b.top) / b.height) * host.p.layout.h),
    ];
  };
  const onKey = (e: KeyboardEvent) => {
    const t = e.target;
    if (
      t instanceof Element &&
      t !== canvas &&
      t.matches('input, select, textarea, button, [contenteditable]')
    )
      return;
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.repeat && ['Enter', ' ', 'b', 'B'].includes(e.key)) {
      e.preventDefault();
      return;
    } // 押しっぱなしで決定し続けない
    syncBeat();
    pulseKey(host, e.key);
    if (key(host, e.key)) e.preventDefault();
  };
  window.addEventListener('keydown', onKey);

  const down = (e: PointerEvent) => {
    if (pointer !== null || !e.isPrimary || e.button !== 0) return;
    canvas.focus({ preventScroll: true });
    syncBeat();
    pointer = e.pointerId;
    serial = host.engine.serial;
    const [x, y] = point(e);
    startedOnButton = presses.down(x, y) !== undefined;
    if (host.backlog.open && !startedOnButton) host.backlog.pointerDown(x, y);
    canvas.setPointerCapture(e.pointerId);
    e.preventDefault();
  };
  const move = (e: PointerEvent) => {
    if (pointer !== e.pointerId) return;
    const [x, y] = point(e);
    presses.move(x, y);
    if (host.backlog.open && !startedOnButton) host.backlog.pointerMove(y);
  };
  const up = (e: PointerEvent) => {
    if (pointer !== e.pointerId) return;
    const [x, y] = point(e);
    const activate = presses.up(x, y);
    pointer = null;
    host.backlog.pointerUp();
    syncBeat();
    if (
      serial === host.engine.serial &&
      (startedOnButton
        ? activate
        : x >= 0 &&
          y >= 0 &&
          x < host.p.layout.w &&
          y < host.p.layout.h &&
          presses.at(x, y) === undefined)
    )
      click(host, x, y);
    if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
  };
  const cancel = () => {
    pointer = null;
    presses.cancel();
    host.backlog.pointerUp();
  };
  const wheel = (e: WheelEvent) => {
    if (!host.backlog.open) return;
    e.preventDefault();
    host.backlog.scroll((e.deltaY * host.p.layout.h) / canvas.getBoundingClientRect().height);
  };
  const oldTouchAction = canvas.style.touchAction;
  canvas.style.touchAction = 'none';
  canvas.addEventListener('pointerdown', down);
  canvas.addEventListener('pointermove', move);
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', cancel);
  canvas.addEventListener('lostpointercapture', cancel);
  window.addEventListener('blur', cancel);
  canvas.addEventListener('wheel', wheel, { passive: false });
  return () => {
    cancel();
    canvas.removeEventListener('lostpointercapture', cancel);
    window.removeEventListener('blur', cancel);
    window.removeEventListener('keydown', onKey);
    canvas.removeEventListener('pointerdown', down);
    canvas.removeEventListener('pointermove', move);
    canvas.removeEventListener('pointerup', up);
    canvas.removeEventListener('pointercancel', cancel);
    canvas.removeEventListener('wheel', wheel);
    canvas.style.touchAction = oldTouchAction;
  };
}

/** キーは動作を待たせず、対応するボタンだけ短く沈める */
function pulseKey(h: PlayerHost, input: string) {
  const k = input.toLowerCase();
  const faces = h.p.buttons.faces;
  const labels = h.labels;
  let label: string | undefined;
  if (h.backlog.open) {
    if (['escape', 'b', 'x'].includes(k)) label = labels.back;
    else if (['arrowup', 'arrowleft'].includes(k)) label = 'up';
    else if (['arrowdown', 'arrowright'].includes(k)) label = 'down';
  } else if (h.record.open) {
    if (['escape', 'x'].includes(k)) label = labels.back;
    else if (['tab', 'r'].includes(k))
      label = h.record.tab === 'evidence' ? labels.profileTab : labels.evidenceTab;
    else if (k === 'e') label = labels.examine;
    else if (['enter', ' '].includes(k) && h.record.detail) label = labels.present;
    else if (k === 'arrowleft') label = 'left';
    else if (k === 'arrowright') label = 'right';
  } else if (k === 'x') label = labels.record;
  else if (k === 'z') label = labels.press;
  else if (k === 'b') label = labels.backlog;
  else if (k === 'arrowleft' && h.beat.kind === 'statement') label = 'left';
  else if (k === 'arrowright' && h.beat.kind === 'statement') label = 'right';
  else if (['escape', 'backspace'].includes(k)) label = labels.back;
  const selected = faces.find((b) => b.selected && b.enabled);
  const target =
    label === undefined
      ? ['enter', ' '].includes(k)
        ? selected === undefined
          ? faces.find((b) => (b.label === '' || b.label === 'right') && b.enabled)
          : selected
        : undefined
      : faces.find((b) => b.label === label && b.enabled);
  h.p.buttons.pulse(target);
}
