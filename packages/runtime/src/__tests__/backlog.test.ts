import type { Beat } from '@gyakusai/core';
import { describe, expect, it } from 'vitest';
import { Backlog } from '../backlog.ts';
import { TEXT_COLORS } from '../layout.ts';
import { Typewriter } from '../typewriter.ts';

function writer(text: string) {
  return new Typewriter(text, {
    wrap: (plain) => plain.split('\n'),
    linesPerPage: 1,
    colors: TEXT_COLORS,
    autoPause: false,
    onCommand: () => {},
  });
}
const beat: Beat = { kind: 'card', text: '日時' };

describe('バックログ', () => {
  it('シーンが変わったら記録を空にする。同じシーンなら残す', () => {
    const log = new Backlog();
    const tw = writer('日時');
    tw.finish();
    log.capture('scene-a', beat, tw);
    log.syncScene('scene-a');
    expect(log.entries).toHaveLength(1);
    log.show();
    log.syncScene('scene-b');
    expect(log.entries).toHaveLength(0);
    expect(log.open).toBe(false);
  });

  it('表示したページだけを記録し、文中の命令は記録しない', () => {
    const log = new Backlog();
    const tw = writer('あ[wait 10]い\nうえ');
    tw.finish();
    log.capture('s', beat, tw);
    log.capture('s', beat, tw);
    expect(log.entries).toHaveLength(1);
    expect(
      log.entries[0]?.lines
        .flat()
        .map((g) => g.ch)
        .join(''),
    ).toBe('あい');
    tw.nextPage();
    log.capture('s', beat, tw);
    expect(log.entries).toHaveLength(1);
    tw.finish();
    log.capture('s', beat, tw);
    expect(log.entries).toHaveLength(2);
  });

  it('B・Esc・Xで閉じる', () => {
    const log = new Backlog();
    for (const key of ['b', 'B', 'Escape', 'x', 'X']) {
      log.show();
      log.key(key);
      expect(log.open).toBe(false);
    }
  });
});
