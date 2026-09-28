// 整合性チェックで試す操作（verify.ts）と、操作を 1 つ行って文章送りだけの場面をまとめて進める step。
// Rust 版（crates/aa-verify/src/actions.rs）と同じ並び・同じ選び方にすること。
import {
  type CompiledScenario,
  type Engine,
  type GameState,
  heldProfiles,
  type PlaceScene,
} from '@gyakusai/core';
import { type Flow, nodeOf } from './verify-flow.ts';
import { type Act, inspectActions, inspectStop, markInspect } from './verify-inspect.ts';
import { inspectSkippable } from './verify-inspect-sim.ts';

const SCREEN = { w: 256, h: 192 };
const pointCache = new WeakMap<PlaceScene, [number, number][]>();

/**
 * 場所で試す「調べる」の点（背景の座標）。背景を、調べる範囲の辺で区切った升目に分け、
 * 「どの範囲に入っているか」の組み合わせごとに 1 点を選ぶ（同じ組み合わせの点は、どの条件でも同じ結果になる）。
 * 重なった範囲の奥の範囲や、どの範囲にも入らない所も漏れなく試せる。
 * 背景の大きさは分からないので、画面の大きさと、範囲の右・下の端のうち大きい方までを背景とみなす
 * （横長の背景は、調べる間にスクロールすればどこでも調べられる）
 */
function examinePoints(place: PlaceScene): [number, number][] {
  const cached = pointCache.get(place);
  if (cached) return cached;
  const cut = (lo: number[], max: number) =>
    [...new Set([0, ...lo])].filter((v) => v >= 0 && v < max).sort((a, b) => a - b);
  const right = place.examine.map((e) => e.area[0] + e.area[2]);
  const bottom = place.examine.map((e) => e.area[1] + e.area[3]);
  const xs = cut(
    place.examine.flatMap((e) => [e.area[0], e.area[0] + e.area[2]]),
    Math.max(SCREEN.w, ...right),
  );
  const ys = cut(
    place.examine.flatMap((e) => [e.area[1], e.area[1] + e.area[3]]),
    Math.max(SCREEN.h, ...bottom),
  );
  const pts: [number, number][] = [];
  const seen = new Set<string>();
  for (const y of ys) {
    for (const x of xs) {
      const sig = place.examine
        .map(({ area: [ax, ay, w, h] }) => (x >= ax && x < ax + w && y >= ay && y < ay + h ? 1 : 0))
        .join('');
      if (!seen.has(sig)) {
        seen.add(sig);
        pts.push([x, y]);
      }
    }
  }
  pointCache.set(place, pts);
  return pts;
}

const ADVANCE: Act = { d: 'a', f: (x) => x.advance() };
const PRESS: Act = { d: 'p', f: (x) => x.press() };

/**
 * 今の Beat で選べる操作（順番は決まっていて、詰みの場面を再現するときにも使う）。
 * つきつける操作は、決まった反応のある証拠品・人物ファイルと、見当違いのもの 1 つだけを試す
 * （見当違いの反応はどれでも同じで、違うのは文中に差し込む名前だけのため）。見当違いは証拠品から選び、
 * 証拠品がすべて正解のときだけ人物ファイルから選ぶ。
 * 法廷記録を開ける場面では、状態を変えうる「詳しく調べる」も試す（verify-inspect.ts）
 */
export function actions(sc: CompiledScenario, e: Engine, passed?: Set<string>): Act[] {
  const b = e.beat;
  const s = e.state;
  /** answers: 証拠品の正解、profiles: 人物ファイルの正解（null なら人物ファイルはつきつけられない） */
  const present = (answers: Record<string, number>, profiles: Record<string, number> | null) => {
    const wrong = s.evidence.find((id) => !(id in answers));
    const out = s.evidence
      .filter((id) => id in answers || id === wrong)
      .map((id) => ({ d: `v${id}`, f: (x: Engine) => x.present(id, 'evidence') }));
    if (!profiles) return out;
    const held = heldProfiles(sc, s);
    const wrongProfile = wrong === undefined ? held.find((id) => !(id in profiles)) : undefined;
    return [
      ...out,
      ...held
        .filter((id) => id in profiles || id === wrongProfile)
        .map((id) => ({ d: `r${id}`, f: (x: Engine) => x.present(id, 'profile') })),
    ];
  };
  const scene = sc.scenes[s.scene];
  const inspect = 'inspect' in b && b.inspect ? inspectActions(sc, e, b.inspect, passed) : [];
  switch (b.kind) {
    case 'line':
    case 'card':
      return [ADVANCE, ...inspect];
    case 'shout':
    case 'banner':
    case 'fade':
    case 'wait':
      return [ADVANCE];
    case 'choice':
      return [
        ...b.options.map((_, i) => ({ d: `c${i}`, f: (x: Engine) => x.choose(i) })),
        ...inspect,
      ];
    case 'pick': {
      // 範囲・範囲の外・やめるの順（Engine.pick の番号）。pick の間は法廷記録を開けない
      const n = b.areas.length + (b.miss ? 1 : 0) + (b.quit ? 1 : 0);
      return Array.from({ length: n }, (_, i) => ({ d: `k${i}`, f: (x: Engine) => x.pick(i) }));
    }
    case 'demand': {
      const ins = scene?.program[s.pc];
      if (ins?.op !== 'demand') return inspect;
      const giveUp: Act[] = ins.giveUp !== undefined ? [{ d: 'g', f: (x) => x.giveUp() }] : [];
      return [...present(ins.options, ins.profiles ?? null), ...giveUp, ...inspect];
    }
    case 'statement': {
      if (!b.cross) return [ADVANCE, ...inspect];
      const st = scene?.kind === 'testimony' ? scene.statements[s.statement] : undefined;
      return [
        ADVANCE,
        ...(b.canPress ? [PRESS] : []),
        ...present(st?.present ?? {}, st?.presentProfile ?? null),
        ...inspect,
      ];
    }
    case 'investigate': {
      const place = sc.scenes[b.place] as PlaceScene;
      return [
        ...examinePoints(place).map(([px, py]) => ({
          d: `e${px},${py}`,
          f: (x: Engine) => x.examine(px, py),
        })),
        ...b.move.map((m) => ({ d: `m${m.id}`, f: (x: Engine) => x.move(m.id) })),
        ...b.talk.map((t) => ({ d: `t${t.id}`, f: (x: Engine) => x.talk(t.id) })),
        ...(b.present ? present(place.present, place.presentProfile ?? {}) : []),
        ...inspect,
      ];
    }
    case 'end':
    case 'gameover':
      return [];
  }
}

const LINEAR = new Set(['say', 'shout', 'banner', 'card', 'fade', 'wait']);

/**
 * 操作が 1 つしかない（文章送りだけの）場面か。Beat を作らずに状態から判定する
 * （Beat を作ると表示のためにフラグを読むので、操作の結果のメモが効きにくくなる）。
 * 状態を変えうる証拠品を持っていて法廷記録を開けるなら、詳しく調べることもできるので止まる
 */
function linear(sc: CompiledScenario, s: Readonly<GameState>): boolean {
  return (
    linearStatic(sc, s) ||
    (inspectStop(sc, s) && inspectSkippable(sc, s, (x) => linearStatic(sc, x)))
  );
}

/** 詳しく調べて状態が変わるかを試さずに見る linear（詳しく調べられる所では止まる） */
function linearStatic(sc: CompiledScenario, s: Readonly<GameState>): boolean {
  if (s.mode === 'investigate') return false;
  if (s.mode === 'testimony') return s.phase !== 'cross' && !inspectStop(sc, s);
  const op = sc.scenes[s.scene]?.program[s.pc]?.op;
  return op !== undefined && LINEAR.has(op) && !inspectStop(sc, s);
}

const CHAIN_LIMIT = 10_000;
const MERGE_RATIO = 2;

/**
 * 操作を 1 つ行い、続く「文章送りだけの場面」をまとめて進める。止まるのは、選ぶ場面（選択肢・つきつけ・
 * 尋問・探偵メニュー・終わり）に着いたときと、別のシーンに入って、生きている変数が大きく減った所
 * （編の変わり目など、ほかの道と合流しやすい所）。
 * 文章送りだけの場面は行き先が 1 つなので、飛ばしても詰み（抜け出せるか）の判定は変わらない
 */
export function step(flow: Flow, e: Engine, act: (e: Engine) => void, passed?: Set<string>): void {
  const sc = e.scenario;
  let scene = e.state.scene;
  const live = liveCount(flow, e.state);
  act(e);
  for (let n = 0; n < CHAIN_LIMIT && linear(sc, e.state); n++) {
    if (e.state.scene !== scene) {
      scene = e.state.scene;
      if (liveCount(flow, e.state) * MERGE_RATIO < live) break;
    }
    // 止まった場面のシーンを記録する（探索編の場所は、探偵メニューに着くまで visited に残らないため）。
    // 法廷記録を開けるなら、詳しく調べられるシーンも記録する
    if (passed) {
      passed.add(scene);
      markInspect(sc, e.state, passed);
    }
    e.advance();
  }
}

/** キーに入る変数の数（証拠品を詳しく調べている途中なら、戻り先で生きている変数も数える） */
function liveCount(flow: Flow, s: Readonly<GameState>): number {
  const f = s.inspectFrom;
  return flow.live(nodeOf(flow, s)).length + (f ? flow.live(nodeOf(flow, f)).length : 0);
}
