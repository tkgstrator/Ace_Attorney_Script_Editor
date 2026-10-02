// 逆転裁判6 の章を組み立てるときの、到達性の整理・進行フラグ・話題名。
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Step } from './convert.ts';
import { readGmdText } from './gmd.ts';

/** ステップが、そこから先の同じシーンの続きには進まない（移動・終わりで抜ける）か。選択肢・if は、すべての枝が抜けるとき */
function terminates(step: any): boolean {
  if (!step || typeof step !== 'object') return false;
  if (['goto', 'end', 'gameover', 'investigate'].some((k) => k in step)) return true;
  const all = (list: any): boolean =>
    Array.isArray(list) && list.length > 0 && terminates(list.at(-1));
  if (Array.isArray(step.choice)) return step.choice.every((o: any) => all(o.then));
  if ('if' in step) return all(step.then) && all(step.else);
  return false;
}

export function dropRedundant(
  scenes: Record<string, any>,
  where: Record<string, any>[],
  roots: (string | null)[],
  origRef: Set<string>,
  called: Set<string>,
): void {
  // 出力からは goto されないシーンを落とす: 中身が空のもの、霊媒ビジョンの内部の輪、そして元の台本からは飛び先にされていた
  // （= 呼び出し・尋問・選択肢の中に展開されて、単独では要らなくなった）ものの写し。飛び先にされていないもの
  // （ゲーム本体の仕組みで入るもの）は落とさない
  const DISPLAY = new Set([
    'E118',
    'E119',
    'E120',
    'E121',
    'E140',
    'E141',
    'E142',
    'E144',
    'E145',
    'E147',
    'E149',
    'E152',
    'E153',
    'E157',
    'E158',
    'E088',
    'E525',
    'E526',
    'E527',
  ]);
  const body = (id: string): unknown[] | null => {
    const s = scenes[id];
    if (!Array.isArray(s)) return null;
    // 終わりの goto（次へ進むだけ）は内容に数えない
    return s.length > 0 && 'goto' in s[s.length - 1] ? s.slice(0, -1) : s;
  };
  const displayOnly = (id: string) => {
    const b = body(id);
    // 終わりの E039 が持つ法廷記録の増減は、ファイルの本筋の終わりにもある写しなので数えない
    const glue = (x: any) => ['give', 'giveProfile', 'take', 'takeProfile'].some((k) => k in x);
    return (
      b !== null &&
      b.some((x: any) => DISPLAY.has(x.native)) &&
      b.every((x: any) => DISPLAY.has(x.native) || glue(x))
    );
  };
  // 反復ごとに、goto されているシーンの集まりと、それらの中身（JSON）の索引を作る（組ごとに全体を検索しない）
  let referenced = new Set<string>();
  let referencedBodies = new Map<string, Set<string>>();
  const copyOf = (id: string) => {
    const b = body(id);
    if (b === null || b.length === 0) return false;
    const same = referencedBodies.get(JSON.stringify(b));
    return !!same && [...same].some((o) => o !== id);
  };
  const candidate = (id: string) =>
    (Array.isArray(scenes[id]) && (scenes[id].length === 0 || body(id)!.length === 0)) ||
    displayOnly(id) ||
    copyOf(id) ||
    /_spirit_(check|hint|no_hint|retry)(_\d+)?$/.test(id) ||
    origRef.has(id) ||
    (/_end$/.test(id) && !scenes[id.replace(/_end$/, '')]) ||
    called.has(id);
  for (;;) {
    const text = JSON.stringify(where);
    referenced = new Set([...text.matchAll(/"goto":"([^"]+)"/g)].map((m) => m[1]!));
    // 会話シーンの最後に移動が無ければ YAML で次に書かれたシーンへ進む
    for (const map of where) {
      const ids = Object.keys(map);
      ids.forEach((id, i) => {
        const steps = map[id];
        if (!Array.isArray(steps) || i + 1 >= ids.length) return;
        if (!terminates(steps.at(-1))) referenced.add(ids[i + 1]!);
      });
    }
    referencedBodies = new Map();
    for (const o of referenced) {
      const b = body(o);
      if (b === null || b.length === 0) continue;
      const key = JSON.stringify(b);
      if (!referencedBodies.has(key)) referencedBodies.set(key, new Set());
      referencedBodies.get(key)!.add(o);
    }
    const gone = Object.keys(scenes).filter(
      (id) => !roots.includes(id) && !referenced.has(id) && candidate(id),
    );
    if (gone.length === 0) return;
    for (const id of gone) delete scenes[id];
  }
}

/** 進み具合のフラグが、物語のファイル file の探偵パートで立ちうるか */
export function flagPossible(
  dir: string,
  story: string[],
): (flag: string, file: string) => boolean {
  const first = new Map<string, number>();
  const other = new Set<string>();
  for (const f of readdirSync(dir)) {
    const idx = story.findIndex((s) => f.endsWith(`_${s}_jpn.txt`));
    for (const m of readFileSync(join(dir, f), 'utf8').matchAll(/<E028 (\d+) (\d+)>/g)) {
      const flag = `f${m[1]}_${m[2]}`;
      if (idx < 0) other.add(flag);
      else first.set(flag, Math.min(first.get(flag) ?? idx, idx));
    }
  }
  return (flag, file) => {
    const at = first.get(flag);
    return at === undefined || other.has(flag) || at <= story.indexOf(file);
  };
}

/** 話題の番号 → 名前（topic_sceNN の並び）。 */
export function topicNames(
  dir: string,
  sce: string,
  scriptDir: string,
): (id: number) => string | null {
  const ids: number[] = [];
  for (const f of readdirSync(dir).filter((f) => f.startsWith(`_${sce}_bg`))) {
    const text = readFileSync(join(dir, f), 'utf8');
    for (const m of text.matchAll(/<E377 \d+ (\d+) /g)) ids.push(Number(m[1]));
    for (const m of text.matchAll(/<E378 \d+ (\d+) (\d+) /g)) ids.push(Number(m[1]), Number(m[2]));
  }
  const path = join(scriptDir, `romfs/msg/topic_${sce}_jpn.txt`);
  const base = Math.min(...ids);
  if (ids.length === 0 || !existsSync(path)) return () => null;
  const entries = readGmdText(path);
  return (id) => {
    const t = entries[id - base]?.text;
    return t && t !== 'Invalid Message' ? t : null;
  };
}

/** つながないファイルの法廷記録の増減を、その前の（無ければ後の）つなぐファイルに移す */
export function moveSkippedGains(gains: Map<string, Step[]>, all: string[], kept: Set<string>) {
  all.forEach((f, i) => {
    const g = gains.get(f);
    if (kept.has(f) || !g) return;
    const to =
      all.slice(0, i).findLast((x) => kept.has(x)) ?? all.slice(i).find((x) => kept.has(x));
    if (to) gains.set(to, [...(gains.get(to) ?? []), ...g]);
  });
  return gains;
}
