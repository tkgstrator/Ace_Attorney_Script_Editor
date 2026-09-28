// 画面の幅の確かめ（aspect-check.ts）で、シーンの始めを撮るだけでは出てこない場面を撮る手順。
// 視点の流し・証拠品の入手・サイコ・ロック・ゲージ・範囲を選ぶ・横長の背景の「調べる」・法廷記録など。
import type { Engine } from '@gyakusai/core';

type Beat = Engine['beat'];
type Op =
  | ['pump', number]
  | ['key', string]
  | ['snap', string]
  /** その種類の Beat まで進める */
  | ['until', Beat['kind']];

export interface Flow {
  /** 章（cases.ts の id） */
  case: string;
  /** 飛ぶシーン */
  scene: string;
  /** ここまで進める */
  stop: (b: Beat, e: Engine) => boolean;
  ops: Op[];
}

export const FLOWS: Flow[] = [
  {
    case: 'ep1',
    scene: 's002',
    stop: (_, e) => !!e.state.stage.pan,
    ops: [
      ['pump', 8],
      ['snap', '視点の流し 8'],
      ['pump', 10],
      ['snap', '視点の流し 18'],
      ['pump', 30],
      ['snap', '視点の流しの後'],
    ],
  },
  {
    case: 'clocktower',
    scene: 'contradiction',
    stop: (_, e) => e.state.evidence.includes('keys'),
    ops: [
      ['pump', 60],
      ['snap', '証拠品の入手'],
    ],
  },
  {
    case: 'aa2-ep2',
    scene: 'p2_s198',
    stop: (_, e) => !!e.state.stage.locks,
    ops: [
      ['pump', 60],
      ['snap', 'サイコ・ロック'],
    ],
  },
  {
    case: 'aa2-ep1',
    scene: 'p0_t016',
    stop: (b) => b.kind === 'statement' && b.cross,
    ops: [
      ['pump', 60],
      ['snap', 'ゲージ'],
      ['key', 'z'],
      ['pump', 30],
      ['snap', 'ゆさぶる'],
    ],
  },
  {
    case: 'ep5',
    scene: 'p24_fp1',
    stop: (b) => b.kind === 'pick',
    ops: [
      ['pump', 30],
      ['snap', '範囲を選ぶ'],
      ['key', 'ArrowRight'],
      ['key', 'Enter'],
      ['pump', 30],
      ['snap', '範囲を選んだ後'],
    ],
  },
  {
    case: 'ep3',
    scene: 'p5_place8',
    stop: (b) => b.kind === 'line',
    ops: [
      ['pump', 90],
      ['snap', '横長の背景の会話'],
      ['until', 'investigate'],
      ['pump', 30],
      ['snap', '横長の背景の探偵メニュー'],
      ['key', 'Enter'],
      ['snap', '横長の背景を調べる'],
      ['key', 'l'],
      ['pump', 10],
      ['snap', '背景を動かしている'],
      ['pump', 40],
      ['snap', '背景を動かした後'],
      ['key', 'ArrowLeft'],
      ['key', 'Enter'],
      ['pump', 40],
      ['snap', '調べた後'],
    ],
  },
  {
    case: 'ep3',
    scene: 'p5_place8',
    stop: (b) => b.kind === 'investigate',
    ops: [
      ['pump', 30],
      ['key', 'ArrowRight'],
      ['key', 'Enter'],
      ['snap', '移動先の一覧'],
      ['key', 'Escape'],
      ['key', 'x'],
      ['snap', '探偵パートの法廷記録'],
    ],
  },
];

/** 手順どおりに進める。snap のたびに shot(名前) を呼ぶ */
export function runFlow(
  engine: Engine,
  flow: Flow,
  io: { pump(n: number): void; key(k: string): void; shot(label: string): void },
): void {
  const step = () => {
    const b = engine.beat;
    if (b.kind === 'choice') engine.choose(0);
    else engine.advance();
    io.pump(2);
  };
  engine.jumpTo(flow.scene);
  io.pump(5);
  for (let i = 0; i < 400 && !flow.stop(engine.beat, engine); i++) {
    try {
      step();
    } catch {
      break;
    }
  }
  for (const op of flow.ops) {
    if (op[0] === 'pump') io.pump(op[1]);
    else if (op[0] === 'key') io.key(op[1]);
    else if (op[0] === 'snap') io.shot(op[1]);
    else {
      for (let i = 0; i < 400 && engine.beat.kind !== op[1]; i++) {
        try {
          step();
        } catch {
          break;
        }
      }
    }
  }
}
