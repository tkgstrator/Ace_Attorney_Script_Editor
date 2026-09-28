import { describe, expect, it } from 'vitest';
import { Blip } from '../blip.ts';

const run = (b: Blip, speeds: number[]) => speeds.map((s) => b.char(s));

describe('文字送りの音', () => {
  it('標準の速さでは 1 文字おき（最初の文字は鳴らない）', () => {
    const b = new Blip();
    b.reset('male');
    expect(run(b, [3, 3, 3, 3, 3])).toEqual([null, 'blip_male', null, 'blip_male', null]);
  });
  it('速さ 5 以上は毎文字、タイプライターは 2 文字目から毎文字', () => {
    const b = new Blip();
    b.reset('female');
    expect(run(b, [5, 5, 5])).toEqual(['blip_female', 'blip_female', 'blip_female']);
    b.reset('typewriter');
    expect(run(b, [3, 3, 3])).toEqual([null, 'blip_typewriter', 'blip_typewriter']);
  });
  it('off で止まり、none と速さ 0 では鳴らない', () => {
    const b = new Blip();
    b.reset('male');
    b.command('off');
    expect(run(b, [3, 3, 3])).toEqual([null, null, null]);
    b.reset('none');
    expect(run(b, [3, 3, 3])).toEqual([null, null, null]);
    b.reset('male');
    expect(run(b, [0, 0])).toEqual([null, null]);
  });
});
