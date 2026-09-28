// 命令と、その元になったステップの位置（YAML のパス）の対応。エディタの「ここから再生」で、
// 編集画面のステップ・証言・シーンから、コンパイル後のどの命令（pc）から遊び始めるかを決める。
import type { PlayTarget, Scene } from '@gyakusai/core';
import { type SourcePath, sourcesOf } from './builder.ts';
import type { Path } from './compile.ts';
import { inspectScene } from './compile-inspect.ts';

/** シーンの ID → シーンの位置と、各命令の元になったステップの位置 */
export type SourceMap = Record<string, { path: Path; pcs: SourcePath[] }>;

/** コンパイルしたシーンから、各命令の元の位置を集める */
export function collectSources(
  scenes: Record<string, Scene>,
  pathOf: (id: string) => Path,
): SourceMap {
  const out: SourceMap = {};
  for (const [id, sc] of Object.entries(scenes)) {
    const pcs = sourcesOf(sc.program);
    if (!pcs) continue;
    const ev = id.startsWith(inspectScene('')) ? id.slice(inspectScene('').length) : null;
    out[id] = { path: ev !== null ? ['evidence', ev] : pathOf(id), pcs };
  }
  return out;
}

const startsWith = (p: readonly (string | number)[], prefix: readonly (string | number)[]) =>
  prefix.length <= p.length && prefix.every((k, i) => p[i] === k);

/**
 * 編集画面の位置（ステップ・証言・シーン・場所のパス）から、遊び始める位置を決める。
 * そのステップに命令が無ければ（中身が空の分岐など）、それを含むいちばん近いステップから。
 * exact: 頼まれたステップそのものか（false なら、含むステップやシーンの始めにした）
 */
export function targetForPath(
  kinds: Record<string, Pick<Scene, 'kind'>>,
  sources: SourceMap,
  path: Path,
): { target: PlayTarget; exact: boolean } | null {
  for (let n = path.length; n > 0; n--) {
    const p = path.slice(0, n);
    const t = findTarget(kinds, sources, p);
    if (t) return { target: t, exact: n === path.length };
  }
  return null;
}

function findTarget(
  kinds: Record<string, Pick<Scene, 'kind'>>,
  sources: SourceMap,
  p: Path,
): PlayTarget | null {
  // シーン・場所そのもの、証言そのもの
  for (const [scene, src] of Object.entries(sources)) {
    if (!startsWith(p, src.path)) continue;
    const rel = p.slice(src.path.length);
    if (rel.length === 0) return { kind: 'scene', scene };
    const st = statementOf(kinds[scene]?.kind, rel);
    if (st !== null && (rel.length <= 2 || !BLOCKS.has(String(rel[2]))))
      return { kind: 'statement', scene, statement: st };
  }
  // そのステップ（とその中）から作った最初の命令。持ち主のシーンを先に探す
  const order = Object.entries(sources).sort(
    ([, a], [, b]) => Number(startsWith(p, b.path)) - Number(startsWith(p, a.path)),
  );
  for (const [scene, src] of order) {
    const pc = src.pcs.findIndex((s) => s !== null && startsWith(s, p));
    if (pc < 0) continue;
    const at = src.pcs[pc]!;
    const rel = startsWith(at, src.path) ? at.slice(src.path.length) : [];
    const st = statementOf(kinds[scene]?.kind, rel);
    // 証言の前のブロックは止まらない（尋問でその証言を出すときに実行する）ので、その証言から
    if (st !== null && rel[2] === 'before') return { kind: 'statement', scene, statement: st };
    return st !== null ? { kind: 'pc', scene, pc, statement: st } : { kind: 'pc', scene, pc };
  }
  return null;
}

/** 証言の中の、ゆさぶり・つきつけなどのブロック */
const BLOCKS = new Set(['before', 'press', 'present']);

/** 証言のシーンの中の位置なら、どの証言の中か */
function statementOf(kind: Scene['kind'] | undefined, rel: Path): number | null {
  return kind === 'testimony' && rel[0] === 'statements' && typeof rel[1] === 'number'
    ? rel[1]
    : null;
}
