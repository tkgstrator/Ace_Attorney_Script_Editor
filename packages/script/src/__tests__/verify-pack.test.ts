// 展開を待つ状態を詰める処理（verify-pack.ts）のテスト
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine, type GameState } from '@gyakusai/core';
import { describe, expect, it } from 'vitest';
import { loadScenario } from '../load.ts';
import { packer } from '../verify-pack.ts';

const sample = readFileSync(
  fileURLToPath(new URL('../../../../apps/player/cases/clocktower.yaml', import.meta.url)),
  'utf8',
);

describe('展開を待つ状態を詰める', () => {
  it('詰めて戻すと、元の状態と同じになる', () => {
    const { scenario } = loadScenario(sample);
    const e = new Engine(scenario!);
    for (let i = 0; i < 5 && e.beat.kind !== 'investigate'; i++) e.advance();
    const s = structuredClone(e.state) as GameState;
    s.flags.mistakes = 3;
    s.seen.push('night', 'tower');
    s.visited.push('unknown_scene');
    const { pack, unpack } = packer(scenario!);
    const text = pack(s);
    expect(unpack(text)).toEqual(s);
    expect(text.length).toBeLessThan(JSON.stringify(s).length);
  });
});
