// ボタンの当たりは沈める前の位置に保ち、離した場所で決定する。
import { hit, type Rect } from './layout.ts';

export interface ButtonFace {
  rect: Rect;
  label: string;
  enabled: boolean;
  selected: boolean;
}

const same = (a: Rect, b: Rect) => a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;

export class ButtonPress {
  faces: ButtonFace[] = [];
  #held: ButtonFace | null = null;
  #inside = false;
  #pulse: Rect | null = null;
  #until = 0;

  beginFrame() {
    this.faces = [];
  }

  register(rect: Rect, label: string, enabled: boolean, selected: boolean) {
    this.faces.push({ rect, label, enabled, selected });
  }

  at(x: number, y: number) {
    return this.faces.findLast((b) => hit(b.rect, x, y));
  }

  down(x: number, y: number) {
    const b = this.at(x, y);
    this.#held = b?.enabled ? b : null;
    this.#inside = this.#held !== null;
    return b;
  }

  move(x: number, y: number) {
    this.#inside = this.#held !== null && hit(this.#held.rect, x, y);
  }

  up(x: number, y: number) {
    const b = this.#held;
    const current = this.at(x, y);
    this.cancel();
    return (
      b !== null &&
      current?.enabled === true &&
      same(b.rect, current.rect) &&
      b.label === current.label &&
      hit(b.rect, x, y)
    );
  }

  cancel() {
    this.#held = null;
    this.#inside = false;
  }

  pulse(face: ButtonFace | undefined) {
    if (!face?.enabled) return;
    this.#pulse = face.rect;
    this.#until = performance.now() + (7 * 1000) / 60;
  }

  pressed(rect: Rect, enabled = true) {
    return (
      enabled &&
      ((this.#held !== null && this.#inside && same(this.#held.rect, rect)) ||
        (this.#pulse !== null && performance.now() < this.#until && same(this.#pulse, rect)))
    );
  }
}
