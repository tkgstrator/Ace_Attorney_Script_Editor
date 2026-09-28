// 人物を選ぶ（nominate。DS 版の第 5 話の指紋の照合・人物の指名）の顔の並びの表示と入力。pick.ts から使う。
// 範囲（Beat の areas）は DS 版の下画面の枠の位置（4 人ずつ 2 段）。顔の絵があれば顔、なければ名前のボタン。
// 案内は上に、カーソルの当たっている人物の名前は下に出す（テキストの枠は顔の 2 段目と重なるので出さない）
// 範囲は 4:3 の枠の座標なので、広い画面では中央に置く（当たりを調べる点は pick.ts が 4:3 の枠の座標に直して渡す）
import type { Beat, Engine } from '@gyakusai/core';
import type { Painter } from './painter.ts';

type PickBeat = Extract<Beat, { kind: 'pick' }>;
type Scenario = Engine['scenario'];

/** 人物を選ぶ Beat か（範囲に人物がある） */
export const isPeople = (b: PickBeat): boolean => b.areas.some((a) => a.person !== undefined);

/** 名前（人物ファイルの名前、なければ名前欄の名前） */
export function personName(sc: Scenario, id: string): string {
  const c = sc.characters[id];
  return c?.profile?.name ?? c?.name ?? id;
}

/** 選んでいる人物を矢印で動かす（左右は段の中で回る、上下は段を替える）。4 人ずつの段 */
export function movePeople(sel: number, n: number, key: string): number {
  const cols = 4;
  const row = Math.floor(sel / cols),
    col = sel % cols;
  const rowLen = (r: number) => Math.min(cols, n - r * cols);
  const rows = Math.ceil(n / cols);
  if (key === 'ArrowLeft') return row * cols + ((col + rowLen(row) - 1) % rowLen(row));
  if (key === 'ArrowRight') return row * cols + ((col + 1) % rowLen(row));
  if (key === 'ArrowUp' || key === 'ArrowDown') {
    const r = (row + (key === 'ArrowUp' ? rows - 1 : 1)) % rows;
    return r * cols + Math.min(col, rowLen(r) - 1);
  }
  return sel;
}

/** 点 (x, y) にある人物の番号（なければ null） */
export function personAt(b: PickBeat, x: number, y: number): number | null {
  const i = b.areas.findIndex(
    ({ area: [ax, ay, w, h] }) => x >= ax && x < ax + w && y >= ay && y < ay + h,
  );
  return i >= 0 ? i : null;
}

export function drawPeople(
  p: Painter,
  b: PickBeat,
  sc: Scenario,
  sel: number,
  prompt: string,
  blinkOn: boolean,
): void {
  const { w: W, h: H, ox } = p.layout;
  p.rect(0, 0, W, H, '#1c2a44');
  const t = p.fonts.text;
  p.dim({ x: 0, y: 14, w: W, h: 22 }, '#000008', 0.6);
  t.draw(t.wrap(prompt, W - 16)[0] ?? '', W / 2, t.centerY(14, 22), {
    color: '#ffffff',
    align: 'center',
  });
  b.areas.forEach((a, i) => {
    const [ax, y, w, h] = a.area;
    const x = ax + ox;
    const id = a.person ?? '';
    const name = personName(sc, id);
    const on = i === sel;
    p.rect(x, y, w, h, on ? (blinkOn ? '#f0a020' : '#ffd060') : '#e8e0c8');
    p.rect(x + 2, y + 2, w - 4, h - 4, '#d8d0b8');
    const icon = sc.characters[id]?.profile?.icon;
    if (p.assets.face?.(icon ?? id)) {
      p.face(id, name, x + 2, y + 2, 40, icon);
      return;
    }
    // 顔の絵がなければ名前のボタン（姓と名を 2 行に）
    const lines = name.split(/[ 　]+/).slice(0, 2);
    const s = p.fonts.small;
    const lh = s.font.size + 4;
    s.draw(lines, x + w / 2, s.centerY(y, h, 1, lines.length, lh), {
      color: '#303030',
      align: 'center',
      lineHeight: lh,
    });
  });
  const cur = b.areas[sel];
  if (cur?.person) {
    const name = personName(sc, cur.person);
    p.dim({ x: 0, y: 162, w: W, h: 22 }, '#000008', 0.6);
    t.draw(name, W / 2, t.centerY(162, 22), { color: '#ffffff', align: 'center' });
  }
}
