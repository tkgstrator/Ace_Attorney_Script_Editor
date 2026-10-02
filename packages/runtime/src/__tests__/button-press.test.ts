import { describe, expect, it, vi } from 'vitest';
import { ButtonPress } from '../button-press.ts';

const rect = { x: 10, y: 20, w: 80, h: 32 };
function buttons(enabled = true) {
  const p = new ButtonPress();
  p.register(rect, '決定', enabled, false);
  return p;
}

describe('ボタンの押下', () => {
  it('押し下げた瞬間に沈み、外で離すと動作せず戻る', () => {
    const p = buttons();
    p.down(20, 30);
    expect(p.pressed(rect)).toBe(true);
    const action = vi.fn();
    if (p.up(100, 30)) action();
    expect(action).not.toHaveBeenCalled();
    expect(p.pressed(rect)).toBe(false);
  });

  it('外に動かすと戻り、同じボタンに戻って離すと決定する', () => {
    const p = buttons();
    p.down(20, 30);
    p.move(100, 30);
    expect(p.pressed(rect)).toBe(false);
    p.move(20, 30);
    expect(p.pressed(rect)).toBe(true);
    expect(p.up(20, 30)).toBe(true);
    expect(p.pressed(rect)).toBe(false);
  });

  it('無効なボタンとキャンセルは決定しない', () => {
    const p = buttons(false);
    p.down(20, 30);
    expect(p.pressed(rect)).toBe(false);
    expect(p.up(20, 30)).toBe(false);
    p.register(rect, '決定', true, false);
    p.down(20, 30);
    p.cancel();
    expect(p.up(20, 30)).toBe(false);
  });

  it('キーは7フレームだけ沈み、無効なら沈まない', () => {
    const now = vi.spyOn(performance, 'now').mockReturnValue(0);
    const p = buttons();
    p.pulse(p.faces[0]);
    expect(p.pressed(rect)).toBe(true);
    now.mockReturnValue((8 * 1000) / 60);
    expect(p.pressed(rect)).toBe(false);
    const disabled = buttons(false);
    disabled.pulse(disabled.faces[0]);
    expect(disabled.pressed(rect)).toBe(false);
    now.mockRestore();
  });

  it('押した後に別のボタンに変わっていたら決定しない', () => {
    const p = buttons();
    p.down(20, 30);
    p.beginFrame();
    p.register(rect, '別の操作', true, false);
    expect(p.up(20, 30)).toBe(false);
  });
});
