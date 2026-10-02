// YAML で書いたシナリオをエンジンで動かすテスト
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Engine, type Beat } from '@gyakusai/core';
import { describe, expect, it } from 'vitest';
import { loadScenario } from '../load.ts';

function load(yaml: string) {
  const { scenario, diagnostics } = loadScenario(yaml);
  const errors = diagnostics.filter((d) => d.severity === 'error');
  if (!scenario)
    throw new Error(errors.map((d) => `${d.line}:${d.column} ${d.message}`).join('\n'));
  return scenario;
}

const text = (b: Beat) =>
  b.kind === 'line' || b.kind === 'statement' ? b.text : b.kind === 'banner' ? b.text : b.kind;

/** line / shout / banner を読み飛ばして、それ以外の Beat で止まる。通過した文を返す */
function skip(e: Engine): string[] {
  const seen: string[] = [];
  for (let i = 0; i < 1000; i++) {
    const b = e.beat;
    if (b.kind !== 'line' && b.kind !== 'shout' && b.kind !== 'banner') return seen;
    seen.push(text(b));
    e.advance();
  }
  throw new Error('止まりません');
}

const BASE = `
id: t
title: テスト
player: me
characters:
  me: { name: 私 }
  w: { name: 証人 }
evidence:
  a: { name: 証拠A, description: "" }
  b: { name: 証拠B, description: "" }
`;

describe('会話', () => {
  it('省略形の台詞、心の声、フラグ、条件分岐、シーンの自動遷移', () => {
    const e = new Engine(
      load(
        BASE +
          `
flags: { met: false, n: 0 }
start: { scene: one }
scenes:
  one:
    - me: こんにちは
    - me: （心の声）
    - set: { met: true }
    - add: { n: 2 }
  two:
    - if: met and n == 2
      then:
        - w: 会ったね
      else:
        - w: 初めまして
    - end: true
`,
      ),
    );
    expect(e.beat).toEqual({
      kind: 'line',
      speaker: 'me',
      name: '私',
      text: 'こんにちは',
      color: 'white',
    });
    e.advance();
    expect(e.beat).toMatchObject({ text: '（心の声）', color: 'blue' });
    e.advance();
    expect(e.beat).toMatchObject({ text: '会ったね' });
    expect(e.state.flags).toEqual({ met: true, n: 2 });
    expect(e.state.visited).toEqual(['one', 'two']);
    e.advance();
    expect(e.beat.kind).toBe('end');
  });

  it('選択肢は when で出し分け、選んだ後は続きへ進む', () => {
    const e = new Engine(
      load(
        BASE +
          `
flags: { secret: false }
start: { scene: s }
scenes:
  s:
    - choice:
        - text: 普通
          then: [ { me: 普通を選んだ } ]
        - text: 隠し
          when: secret
        - text: 最後
    - me: 続き
    - end: true
`,
      ),
    );
    expect(e.beat).toEqual({ kind: 'choice', options: ['普通', '最後'] });
    e.choose(1);
    expect(e.beat).toMatchObject({ text: '続き' });
  });

  it('つきつけ要求: 不正解ならペナルティの後にもう一度、正解なら先へ', () => {
    const e = new Engine(
      load(
        BASE +
          `
life: 5
defaults: { penalty: 1 }
start: { scene: s, evidence: [a, b] }
scenes:
  s:
    - demand: どれ？
      present:
        b: [ { me: 正解 } ]
      wrong:
        - me: 「{evidence}」は違う
        - penalty: true
    - end: true
`,
      ),
    );
    expect(e.beat).toEqual({ kind: 'demand', prompt: 'どれ？', name: null });
    expect(e.canPresent).toBe(true);
    e.present('a');
    expect(e.beat).toMatchObject({ kind: 'shout', shout: 'takethat', by: 'me' });
    expect(skip(e)).toEqual(['shout', '「証拠A」は違う']);
    expect(e.state.life).toBe(4);
    expect(e.drainEvents()).toEqual([{ type: 'penalty', amount: 1, life: 4 }]);
    expect(e.beat.kind).toBe('demand');
    e.present('b');
    expect(skip(e)).toEqual(['shout', '正解']);
    expect(e.beat.kind).toBe('end');
  });

  it('ライフが尽きると gameover シーンへ（未定義なら組み込みのゲームオーバー）', () => {
    const e = new Engine(
      load(
        BASE +
          `
life: 2
start: { scene: s }
scenes:
  s:
    - penalty: 2
    - me: ここには来ない
`,
      ),
    );
    expect(e.beat.kind).toBe('gameover');
  });
});

describe('表示の命令', () => {
  it('card は止まる Beat になり、showEvidence は小窓の状態を変え、シーンが変わると消える', () => {
    const e = new Engine(
      load(
        BASE +
          `
start: { scene: s, evidence: [a] }
scenes:
  s:
    - card: "9月27日\\n法廷"
    - showEvidence: a
    - me: これです
  t:
    - me: 次のシーン
    - end: true
`,
      ),
    );
    expect(e.beat).toEqual({ kind: 'card', text: '9月27日\n法廷' });
    e.advance();
    expect(e.state.stage.evidence).toBe('a');
    e.advance();
    expect(e.beat).toMatchObject({ text: '次のシーン' });
    expect(e.state.stage.evidence).toBeNull();
  });
});

describe('証言と尋問', () => {
  const T =
    BASE +
    `
flags: { pressed: false }
start: { scene: t, evidence: [a, b] }
scenes:
  t:
    testimony: テスト証言
    witness: w
    statements:
      - id: s1
        text: 証言1
        press:
          - me: ゆさぶり1
          - set: { pressed: true }
      - id: hidden
        when: pressed
        text: 隠し証言
        press: [ { w: 隠しのゆさぶり } ]
        present:
          b: [ { goto: done } ]
      - id: s2
        text: 証言2
    after: [ { w: 以上です } ]
    loop: [ { me: もう一周 } ]
    wrong: [ { w: 違います } ]
  done:
    - me: 解決
    - end: true
`;

  it('証言 → after → 尋問、ゆさぶりで隠し証言が現れ、正しいつきつけで抜ける', () => {
    const e = new Engine(load(T));
    expect(e.beat).toEqual({
      kind: 'banner',
      text: '証言開始',
      sub: '〜テスト証言〜',
      testimony: 'reading',
    });
    e.advance();
    expect(e.beat).toMatchObject({
      kind: 'statement',
      cross: false,
      text: '証言1',
      index: 0,
      count: 2,
    });
    e.advance();
    expect(e.beat).toMatchObject({ text: '証言2', index: 1 });
    e.advance();
    expect(skip(e)).toEqual(['以上です', '尋問開始']);
    expect(e.beat).toMatchObject({ kind: 'statement', cross: true, text: '証言1', canPress: true });

    // 最後の証言を過ぎると loop を経て先頭へ
    e.advance();
    expect(e.beat).toMatchObject({ text: '証言2', canPress: false });
    e.advance();
    expect(skip(e)).toEqual(['もう一周']);
    expect(e.beat).toMatchObject({ text: '証言1' });

    // ゆさぶると、隠し証言が次に現れる
    e.press();
    expect(e.beat).toMatchObject({ kind: 'shout', shout: 'hold' });
    expect(skip(e)).toEqual(['shout', 'ゆさぶり1']);
    expect(e.beat).toMatchObject({ text: '隠し証言', index: 1, count: 3 });

    // 見当違いのつきつけは wrong を実行して同じ証言に戻る
    e.present('a');
    expect(skip(e)).toEqual(['shout', '違います']);
    expect(e.beat).toMatchObject({ text: '隠し証言' });

    e.back();
    expect(e.beat).toMatchObject({ text: '証言1' });
    e.advance();
    e.present('b');
    expect(skip(e)).toEqual(['shout', '解決']);
    expect(e.beat.kind).toBe('end');
  });

  it('セーブデータから同じ場面を再開できる', () => {
    const scenario = load(T);
    const e = new Engine(scenario);
    e.advance();
    e.advance();
    e.advance();
    skip(e);
    e.press();
    skip(e);
    const snap = JSON.parse(JSON.stringify(e.snapshot()));
    const r = new Engine(scenario, snap);
    expect(r.beat).toEqual(e.beat);
    expect(r.state.flags).toEqual({ pressed: true });
  });

  it('尋問中以外のゆさぶり・持っていない証拠品は例外', () => {
    const e = new Engine(load(T));
    expect(() => e.press()).toThrow(/尋問中/);
    expect(() => e.present('zzz')).toThrow(/持っていない/);
  });
});

describe('サンプル事件', () => {
  const path = fileURLToPath(
    new URL('../../../../apps/player/cases/clocktower.yaml', import.meta.url),
  );
  const yaml = readFileSync(path, 'utf8');

  it('エラーも警告もなく読み込める', () => {
    expect(loadScenario(yaml).diagnostics).toEqual([]);
  });

  /** 探偵メニューまで読み進める */
  const toMenu = (e: Engine) => {
    while (e.beat.kind !== 'investigate') e.advance();
  };
  /** 探索編で修理票と置時計を手に入れ、裁判編の最初の台詞まで進める */
  const investigate = (e: Engine) => {
    toMenu(e);
    e.examine(120, 40);
    toMenu(e); // 時計塔 → 修理票
    e.move('shop');
    toMenu(e);
    e.examine(170, 80);
    toMenu(e); // 置時計
    e.move('plaza');
    toMenu(e);
    const b = e.beat;
    expect(b.kind === 'investigate' && b.move.map((m) => m.id)).toEqual(['shop', 'court_gate']);
    e.move('court_gate');
    while (e.state.scene === 'court_gate') e.advance();
  };

  it('探索編: 証拠品がそろうまで裁判所へは行けない', () => {
    const e = new Engine(load(yaml));
    toMenu(e);
    const b = e.beat;
    expect(b).toMatchObject({ kind: 'investigate', place: 'plaza', person: 'torii' });
    expect(b.kind === 'investigate' && b.move.map((m) => m.id)).toEqual(['shop']);
    expect(b.kind === 'investigate' && b.talk.map((t) => t.topic)).toEqual(['事件の夜のこと']);
    e.talk('night');
    toMenu(e);
    const after = e.beat;
    expect(after.kind === 'investigate' && after.talk.map((t) => [t.topic, t.seen])).toEqual([
      ['事件の夜のこと', true],
      ['時計塔の鐘', false],
    ]);
    investigate(e);
    expect(e.state.scene).toBe('opening');
    expect(e.state.evidence).toEqual(['badge', 'autopsy', 'photo', 'repair', 'clock']);
  });

  it('最短手順で無罪までたどり着ける', () => {
    const e = new Engine(load(yaml));
    investigate(e);
    skip(e); // 開廷
    const toCross = () => {
      while (!(e.beat.kind === 'statement' && e.beat.cross)) e.advance();
    };
    toCross();
    // 証言2（bell）をゆさぶって、隠し証言を出す
    e.advance();
    expect(e.beat).toMatchObject({ text: 'ちょうど夜の9時、時計塔の鐘が鳴ったんです。' });
    e.press();
    skip(e);
    expect(e.state.flags.asked_bell).toBe(true);
    expect(e.beat).toMatchObject({ text: '鐘は9回。この耳で数えました。' });
    e.present('repair');
    skip(e);
    expect(e.state.evidence).toContain('keys');
    expect(e.beat).toEqual({
      kind: 'choice',
      options: ['鐘の音など聞いていない', '時計塔ではない鐘を聞いた'],
    });
    e.choose(1);
    skip(e);
    e.present('clock');
    const lines = skip(e);
    expect(lines).toContain('無罪');
    expect(lines).toContain('（一度も間違えずにたどり着けた。……今日は、冴えていたな）');
    expect(e.beat.kind).toBe('end');
    expect(e.state.life).toBe(5);
  });

  it('間違え続けると有罪になる', () => {
    const e = new Engine(load(yaml));
    investigate(e);
    while (!(e.beat.kind === 'statement' && e.beat.cross)) e.advance();
    for (let i = 0; i < 5; i++) {
      e.present('badge');
      skip(e);
    }
    expect(e.state.life).toBe(0);
    expect(e.beat.kind).toBe('gameover');
  });
});

describe('話し手の立ち絵', () => {
  it('主人公の立ち絵は法廷でだけ出し、場所の背景の間は相手のままにする', () => {
    const e = new Engine(
      load(
        BASE +
          `
start: { scene: one }
scenes:
  one:
    - location: lobby
    - w: 控え室です
    - me: そうですね
    - location: null
    - me: 法廷です
    - end: true
`,
      ),
    );
    expect(e.state.stage.character).toBe('w');
    e.advance();
    expect(e.state.stage.character).toBe('w');
    e.advance();
    expect(e.state.stage.character).toBe('me');
  });
});
