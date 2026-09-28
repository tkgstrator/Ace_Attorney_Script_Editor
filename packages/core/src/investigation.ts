// 探索編（場所・探偵メニュー）の、状態を変えない計算。状態の変更は Engine が行う。
import { inspectField } from './inspect.ts';
import type { Beat, CompiledScenario, Expr, GameState, PlaceScene } from './types.ts';

type Test = (e: Expr | undefined) => boolean;

/** 今その場所にいる人物（候補のうち when が真の最初の人物） */
export function personAt(place: PlaceScene, test: Test): string | null {
  return place.person.find((p) => test(p.when))?.id ?? null;
}

export function investigateBeat(
  scenario: CompiledScenario,
  place: PlaceScene,
  state: GameState,
  test: Test,
): Beat {
  const person = personAt(place, test);
  return {
    kind: 'investigate',
    place: place.id,
    name: place.name,
    person,
    examine: true,
    examineScroll: test(place.examineScroll),
    move: place.move
      .filter((m) => test(m.when))
      .map((m) => {
        const to = scenario.scenes[m.to];
        return { id: m.to, name: to?.kind === 'place' ? to.name : m.to };
      }),
    talk:
      person === null
        ? []
        : place.talk
            .filter((t) => test(t.when))
            .map((t) => ({ id: t.id, topic: t.topic, seen: state.seen.includes(t.id) })),
    present: person !== null,
    ...inspectField(scenario, state, 'investigate'),
  };
}

/** 背景の上の点 (x, y)（画面の点 + 背景のスクロールした位置）を調べたときに実行するブロックと、調べた印の ID（何もなければ印なし） */
export function examineAt(
  place: PlaceScene,
  x: number,
  y: number,
  test: Test,
): { pc: number; seen?: string } {
  const hit = place.examine.find((e) => {
    const [ax, ay, w, h] = e.area;
    return test(e.when) && x >= ax && x < ax + w && y >= ay && y < ay + h;
  });
  return hit ? { pc: hit.pc, seen: hit.id } : { pc: place.examineDefault };
}
