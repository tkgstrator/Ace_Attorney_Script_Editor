import { describe, expect, it } from 'vitest';
import { resolveCaseFile, resolveEntry } from '../cases-api.ts';

describe('resolveCaseFile', () => {
  it('ディレクトリ直下の .yaml だけを許す', () => {
    expect(resolveCaseFile('/cases', 'clocktower.yaml')).toBe('/cases/clocktower.yaml');
    for (const bad of [
      '../x.yaml',
      '..yaml',
      'a/b.yaml',
      '/etc/passwd',
      'x.yml',
      'x.yaml/..',
      '.hidden.yaml',
      'a\\b.yaml',
      '',
    ]) {
      expect(resolveCaseFile('/cases', bad)).toBeNull();
    }
  });

  it('「置き場所/ファイル名」を置き場所の中のパスにする', () => {
    const roots = { sample: '/cases', official: '/conv' };
    expect(resolveEntry(roots, 'official/ep1.yaml')).toBe('/conv/ep1.yaml');
    for (const bad of [
      'ep1.yaml',
      'other/ep1.yaml',
      'official/../x.yaml',
      'official/a/b.yaml',
      'toString/x.yaml',
    ]) {
      expect(resolveEntry(roots, bad)).toBeNull();
    }
  });
});
