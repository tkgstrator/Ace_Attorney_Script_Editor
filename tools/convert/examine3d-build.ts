// 章の証拠品の examine（詳しく調べる）を、examine3d.json と各項目の取り込んだ区画から組み立てる（examine3d.ts の続き）。
import { Context } from './context.ts';
import { bgSize, SCREEN } from './examine-area.ts';
import { type Examine3d, modeHome, objectChain, setsFlag, type X3dPath } from './examine3d.ts';
import { convertOps } from './section.ts';
import type { Entry, Step, Tables } from './types.ts';

export interface ExamineEntry {
  spot: string;
  when?: string;
  then: Step[];
}
/** 場所の調べる所（YAML の places.<ID>.examine の 1 つ） */
export interface PlaceExamine {
  id: string;
  name: string;
  area: [number, number, number, number];
  when: string;
  then: Step[];
}

/** ルミノール試薬（法廷記録の番号 144、第 5 話の 2 日目から） */
const LUMINOL_ITEM = 144;

interface Build {
  x: Examine3d;
  ctxs: Context[];
  /** パートの番号 → 章の中の編の番号（フラグ part の値） */
  partIndex: Map<number, number>;
  c070: Context | null;
  done070: Map<number, Step[]>;
  partFlag: string | null;
}

/** 物を開く（続けて見せる）ときに立てるフラグ */
const openFlag = (b: Build, obj: number) => b.ctxs[0]!.flag(`x3d_open${obj}`);

/** 項目 070 の区画（3D で調べるときの台詞）。42 のフラグの分かれ道は、その場で入れ子にする */
function steps070(b: Build, s: number, depth = 0): Step[] {
  const c = b.c070;
  if (!c?.entry.body[s] || depth > 4) return [{ native: 'item070', args: [s] }];
  const hit = b.done070.get(s);
  if (hit) return hit;
  const out = convertOps(c, s, c.entry.body[s]!.ops, {
    menuReturn: [],
    gotoSteps: (t) => steps070(b, t, depth + 1),
  });
  b.done070.set(s, out);
  return out;
}

/** 結果の区画の最初の文（選択肢に出す場所の名前にする。14 字まで）。42 の分かれ道なら、立っていないほうの先 */
function firstText(entry: Entry | undefined, s: number, depth = 0): string | null {
  const ops = entry?.body[s]?.ops ?? [];
  let text = '';
  for (const o of ops) {
    if (o.op === 'text') text += o.text.replace(/\s+/g, '');
    else if (text && [2, 7, 10, 13, 21, 45].includes(o.op)) break;
    if (text.length >= 14) break;
  }
  if (text) return text.slice(0, 14);
  const j = ops.find((o) => o.op === 42);
  const t = j && j.op !== 'text' ? (j.targets?.[1]?.section ?? j.args[2]! - 128) : null;
  return t !== null && depth < 3 ? firstText(entry, t, depth + 1) : null;
}

/** 条件（パート・フラグ）を条件式にする。条件がなければ null */
function condOf(b: Build, p: X3dPath): string | null {
  const cs: string[] = [];
  const ks = [...b.partIndex].filter(([part]) => p.parts.includes(part)).map(([, k]) => k);
  if (b.partFlag && ks.length < b.partIndex.size)
    cs.push(`(${ks.map((k) => `${b.partFlag} == ${k}`).join(' or ')})`);
  for (const [f, v] of Object.entries(p.when)) {
    const [g, i] = f.split(':').map(Number);
    const name = b.ctxs[0]!.fname(g!, i!);
    cs.push(v ? name : `not ${name}`);
  }
  return cs.length ? cs.join(' and ') : null;
}

/** 話の台本の区画を取り込んだ項目（結果のパートに合うもの） */
const storyCtx = (b: Build, p: X3dPath, s: number) =>
  b.ctxs.find((c) => p.parts.includes(c.part) && c.examineSteps.has(s));

/** 1 つの結果（のパートごとの道）のステップ。モードの決まった区画（開いたとき・閉じたとき）も前後に足す */
function resultSteps(
  b: Build,
  r: number,
  object: number,
  label: { text: string | null },
): Step[] | null {
  const branches: { cond: string | null; body: Step[] }[] = [];
  for (const p of b.x.results[r]?.paths ?? []) {
    if (![...b.partIndex.keys()].some((k) => p.parts.includes(k))) continue;
    const body: Step[] = [];
    const flags: Record<string, boolean> = {};
    for (const [f, v] of Object.entries(p.set_flags)) {
      const [g, i] = f.split(':').map(Number);
      flags[b.ctxs[0]!.fname(g!, i!)] = v === 1;
    }
    const next = p.next_object === '+1' ? object + 1 : p.next_object;
    if (next !== null && b.x.objects[next]?.spots.length) flags[openFlag(b, next)] = true;
    if (Object.keys(flags).length) body.push({ set: flags });
    const sec = p.section;
    let story: Context | undefined;
    if (sec?.script === '070') {
      body.push(...steps070(b, sec.section));
      label.text ??= firstText(b.c070?.entry, sec.section);
    } else if (sec) {
      story = storyCtx(b, p, sec.section);
      if (!story) continue; // この章に無いパートの区画
      body.push(...story.examineSteps.get(sec.section)!);
      label.text ??= firstText(story.entry, sec.section);
    }
    for (const c of b.ctxs) body.unshift(...modeExtra(b, c, 'pre', object, p, story));
    for (const c of b.ctxs) body.push(...modeExtra(b, c, 'post', object, p, story));
    if (body.length) branches.push({ cond: condOf(b, p), body });
  }
  if (!branches.length) return null;
  // 条件のない道を最後（else）に
  branches.sort((a, c) => Number(a.cond === null) - Number(c.cond === null));
  let out: Step[] = branches.at(-1)!.cond === null ? branches.pop()!.body : [];
  for (const br of branches.reverse()) {
    // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
    out = [{ if: br.cond!, then: br.body, ...(out.length ? { else: out } : {}) }];
  }
  return out;
}

/**
 * モード（話の台本から 3D の画面を開いたとき）の決まった区画:
 * pre = 開いたとき・カーソルを乗せたとき（財布の説明）、post = 閉じたとき（結果の後に閉じたことにする）
 */
function modeExtra(
  b: Build,
  c: Context,
  at: 'pre' | 'post',
  object: number,
  p: X3dPath,
  story: Context | undefined,
): Step[] {
  const out: Step[] = [];
  for (const m of b.x.story_modes) {
    const home = modeHome(b.x, m, c);
    if (!home) continue;
    const objs = home.evidence.flatMap((n) =>
      objectChain(b.x, b.x.evidence[String(n)] ?? -1).map((o) => o.object),
    );
    if (!objs.includes(object)) continue;
    for (const ev of m.events) {
      const s = ev.section?.section;
      if (s === undefined || !c.examineSteps.has(s)) continue;
      const steps = c.examineSteps.get(s)!;
      const sec = p.section;
      const isStory = !!story && sec?.script === 'story';
      if (at === 'pre') {
        if ((ev.on === 'open' || ev.on === 'hover') && isStory) out.push(...steps);
        continue;
      }
      if (ev.on === 'back') {
        c.stats.gap('3D で見つける前にやめたときの区画（携帯電話の「もどる」）は使わない', s);
        continue;
      }
      if (ev.on !== 'close' && ev.on !== 'close_with_flag') continue;
      // 116 11: その物を調べ終えたら閉じる
      if (m.mode === 'e9e') {
        if (object === m.object) out.push(...steps);
        continue;
      }
      // 説明（財布）: 結果を見た後（モード 2）に閉じる
      if (ev.mode === 2) {
        if (isStory) out.push(...steps);
        continue;
      }
      // 携帯電話: フラグが立っていれば閉じたときの区画 / ナイフ: フラグが立つと自動で閉じる
      const flag = ev.flag ?? m.events.find((e) => e.on === 'auto_close')?.flag;
      if (
        flag &&
        (p.set_flags[flag] === 1 || (isStory && setsFlag(story!.entry, sec!.section, flag)))
      )
        out.push(...steps);
    }
  }
  if (out.length)
    c.stats.gap(
      at === 'pre'
        ? '3D の画面を開いたときの説明を、調べた結果の前に出した'
        : '3D の画面を閉じたときの区画を、調べた結果の後に続けた',
      -1,
    );
  return out;
}

/**
 * 章の証拠品ごとの examine。物の調べられる面の結果ごとに 1 つ（同じ結果の面はまとめる）、続けて見せる物の面は
 * その物を開いた後（フラグ x3d_open物）だけ選べる
 */
export function buildExamine(
  t: Tables,
  ctxs: Context[],
  evidence: number[],
  item070: Entry | null,
  partFlag: string | null,
): { examine: Map<number, ExamineEntry[]>; luminol: Map<string, PlaceExamine[]> } {
  const out = new Map<number, ExamineEntry[]>();
  const x = t.examine3d;
  if (!x) return { examine: out, luminol: new Map() };
  const partIndex = new Map(ctxs.map((c, k) => [c.part, k] as const));
  const c070 = item070 ? new Context(t, item070, { shared: ctxs[0]!.shared, pfx: 'x070_' }) : null;
  const b: Build = { x, ctxs, partIndex, c070, done070: new Map(), partFlag };
  for (const n of evidence) {
    const obj = x.evidence[String(n)];
    if (obj === undefined) continue;
    const list: ExamineEntry[] = [];
    const bodies = new Set<string>();
    for (const { object, gate } of objectChain(x, obj)) {
      const seen = new Set<number>();
      for (const s of x.objects[object]?.spots ?? []) {
        if (seen.has(s.result)) continue;
        seen.add(s.result);
        const label = { text: null as string | null };
        const then = resultSteps(b, s.result, object, label);
        // 同じ台詞になる結果（向きだけ違う）はまとめる
        if (!then || bodies.has(JSON.stringify(then))) continue;
        bodies.add(JSON.stringify(then));
        const spot = `（${label.text ?? `調べる所 ${list.length + 1}`}）`;
        list.push({ spot, ...(gate !== null ? { when: openFlag(b, object) } : {}), then });
      }
    }
    if (list.length) out.set(n, list);
  }
  const luminol = buildLuminol(b);
  if (c070) {
    for (const [k, v] of c070.flags) if (!ctxs[0]!.flags.has(k)) ctxs[0]!.flags.set(k, v);
    ctxs[0]!.stats.merge(c070.stats);
    if (c070.pieces.size || c070.referenced.size)
      ctxs[0]!.stats.gap('項目 070 の区画の途中・別の区画への移動（取り込めない）', -1);
  }
  return { examine: out, luminol };
}

/**
 * ルミノール（背景ごとの血の反応の場所）を、探偵パートの場所の調べる所にする（近似）。元のゲームでは試薬を吹きかける別の画面で、
 * 見つけるとフラグを立てて項目 070 の台詞。ここでは、試薬を持っていて、まだ見つけていないときだけ選べる、先に調べる所にする。
 * 範囲は背景の座標（横長の背景をずらした見え方の座標は、右端の見え方の位置を足す）
 */
function buildLuminol(b: Build): Map<string, PlaceExamine[]> {
  const out = new Map<string, PlaceExamine[]>();
  const has = `has(e${LUMINOL_ITEM})`;
  for (const ctx of b.ctxs) {
    if (!ctx.inv || ctx.pfx !== ctx.gpfx) continue; // 探偵パートの組の最初の項目（場所を作る所）だけ
    for (const pl of ctx.inv.places as { id: number; bg: number; bg_file?: string }[]) {
      const views = (b.x.luminol ?? []).filter((v) => v.bg === pl.bg);
      const shift = Math.max(0, bgSize(pl.bg_file).w - SCREEN.w);
      const list: PlaceExamine[] = [];
      for (const v of views) {
        for (const sp of v.spots) {
          const area: [number, number, number, number] = [
            sp.x + (v.scrolled ? shift : 0),
            sp.y,
            sp.w,
            sp.h,
          ];
          const flag = ctx.fname(0, sp.flag);
          list.push({
            id: `${ctx.placeId(pl.id)}_luminol${sp.flag}`,
            name: 'ルミノールの反応',
            area,
            when: `${has} and not ${flag}`,
            // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
            then: [
              { set: { [flag]: true } },
              ...(sp.section ? steps070(b, sp.section.section) : []),
            ],
          });
        }
      }
      if (list.length) {
        out.set(ctx.placeId(pl.id), list);
        ctx.stats.gap(
          'ルミノールの反応の場所を、試薬を持っているときだけ先に調べられる所にした（元は吹きかける別の画面）',
          -1,
        );
      }
    }
  }
  return out;
}
