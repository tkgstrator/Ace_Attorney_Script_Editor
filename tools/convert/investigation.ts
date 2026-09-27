// 探偵パート（investigation.json の parts）を、YAML の探索編の場所（places）にする。
//
// 元のゲームの探偵パートは「今いる場所」「今出ている人物（30 char の最後）」「フラグ」で決まる:
//   - 着いたとき（移動）: 背景 = 場所の bg、人物を消し、on_enter の道（フラグの組）のうち合うものを行う
//     （調べる表の切り替え・人物を出す・音楽・一度きりの会話 event）
//   - 話す: (場所, 人物) の項目のうち有効（55 で切り替え）なものの話題 / つきつける: (場所, 証拠品, 人物) の区画、無ければ既定
//   - 調べる: 着いたときに選んだ表の四角形 / 移動する: 場所の行き先（51 で書き換え）
//   - 区画の終わりの 28 3 → 21 で探偵メニューに戻る
// YAML では、人物・場所・行き先の版・話題の有効をフラグ（person / place / mv_場所 / talk_項目）で持ち、条件（when）にする。
// 区画の中から探偵メニューに戻るときは menu_return を立てて menu シーンへ行き、今の場所へ investigate する
// （場所の enter は menu_return が立っていれば着いたときの処理を飛ばす）。
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Context } from './context.ts';
import { bgKey } from './mapping.ts';
import { convertOps } from './section.ts';
import { ROOT } from './tables.ts';
import type { Entry, Step } from './types.ts';

const SCREEN = { w: 256, h: 192 };
/** パート < 17 では、このフラグ（0x41）が立つまで「調べる」は区画 0x8d（§13）になる */
const EXAMINE_READY = 0x41;
const EXAMINE_NOT_YET = 13;
/** 共通の台本の「手がかりになるものはない。」 */
const COMMON_NOTHING = 43;

type Sec = { raw: number; script: string; section: number };

/** investigation.json の when（{"0:0x53": 0, ...}）→ 条件式 */
export function whenOf(ctx: Context, when: Record<string, number | string>): string {
  // 'lang' は言語（日本語の項目なら ja の道だけ）
  if (when.lang !== undefined && when.lang !== ctx.entry.lang) return 'false';
  const parts = Object.entries(when).filter(([k]) => k !== 'lang').map(([k, v]) => {
    const [g, n] = k.split(':');
    const f = ctx.fname(Number(g), Number(n));
    return v ? f : `not ${f}`;
  });
  return parts.length ? parts.join(' and ') : 'true';
}

/** 「flag 0x49 == 1」→ 条件式 */
export function condOf(ctx: Context, cond: string): string {
  const m = cond.match(/flag\s+(0x[0-9a-f]+|\d+)\s*==\s*(\d)/i);
  if (!m) return 'true';
  const f = ctx.fname(0, Number(m[1]));
  return m[2] === '1' ? f : `not ${f}`;
}

/** 背景の PNG の幅（横長の背景は 512。画面には 256 に縮めて出るので、調べる場所も縮める） */
export function bgWidth(file: string | undefined): number {
  const p = file ? join(ROOT, file) : '';
  if (!p || !existsSync(p)) return SCREEN.w;
  return readFileSync(p).readUInt32BE(16);
}

const or = (xs: string[]) => (xs.length === 1 ? xs[0]! : xs.map(x => `(${x})`).join(' or '));
const and = (xs: string[]) => xs.filter(x => x !== 'true').map(x => (/ or /.test(x) ? `(${x})` : x)).join(' and ') || 'true';

/**
 * 四角形 4 点 → 画面の中の [x, y, 幅, 高さ]（はみ出しは切る。画面の外なら null）。
 * 斜めの四角形は外接する長方形だと隣と大きく重なるので、x・y それぞれ 2 番目と 3 番目の値で作る内側の長方形にする
 * （軸に沿った四角形ならそのまま）。潰れるなら外接する長方形
 */
export function areaOf(quad: number[][], scaleX = 1): [number, number, number, number] | null {
  const xs = quad.map(p => Math.round(p[0]! * scaleX)).sort((a, b) => a - b), ys = quad.map(p => p[1]!).sort((a, b) => a - b);
  let [ax, bx] = [xs[1]!, xs[2]!], [ay, by] = [ys[1]!, ys[2]!];
  if (bx - ax < 4) [ax, bx] = [xs[0]!, xs[3]!];
  if (by - ay < 4) [ay, by] = [ys[0]!, ys[3]!];
  const x0 = Math.max(0, ax), y0 = Math.max(0, ay);
  const x1 = Math.min(SCREEN.w, bx), y1 = Math.min(SCREEN.h, by);
  return x1 - x0 > 0 && y1 - y0 > 0 ? [x0, y0, x1 - x0, y1 - y0] : null;
}

/** ブロックの最後の「探偵メニューへ戻る」は要らない（ブロックが終われば戻る）ので外す */
export function stripMenuReturn(ctx: Context, steps: Step[]): Step[] {
  const out = [...steps];
  const last = out.at(-1);
  if (last && 'goto' in last && last.goto === ctx.menuScene()) {
    out.pop();
    const prev = out.at(-1);
    if (prev && 'set' in prev && ctx.returnFlag() in (prev.set as object)) out.pop();
  } else if (last && 'if' in last) {
    out[out.length - 1] = {
      ...last,
      then: stripMenuReturn(ctx, last.then as Step[]),
      ...(last.else ? { else: stripMenuReturn(ctx, last.else as Step[]) } : {}),
    };
  }
  return out;
}

/** その場所の区画がある項目（第 5 話の script_items）。無ければ今の項目 */
export const scriptEntryOf = (ctx: Context, pl: { script_items?: string[] }): number =>
  (pl.script_items?.length ? Number(pl.script_items[0]) : ctx.entry.entry);

/** その場所の区画を変換する Context（組の中の、その項目の Context） */
export const ctxOf = (ctx: Context, pl: { script_items?: string[] }): Context => ctx.group.get(scriptEntryOf(ctx, pl)) ?? ctx;

/** 探偵パートの準備: 行き先の版（51。組のすべての項目から）と、この項目にある会話 event の区画 */
export function prepareInvestigation(ctx: Context) {
  const inv = ctx.inv!;
  const moves = new Map<number, number[][]>();
  for (const pl of inv.places) moves.set(pl.id, [pl.dest]);
  const bodies = ctx.group.size ? [...ctx.group.values()].flatMap(c => c.entry.body) : ctx.entry.body;
  for (const sec of bodies) {
    for (const o of sec.ops) {
      if (o.op !== 51) continue;
      const [p, ...d] = o.args;
      const list = moves.get(p!) ?? [];
      const dest = d.filter(x => x !== 255);
      if (!list.some(v => v.join() === dest.join())) list.push(dest);
      moves.set(p!, list);
    }
  }
  ctx.moveVersions = moves;
  for (const pl of inv.places) {
    if (scriptEntryOf(ctx, pl) !== ctx.entry.entry) continue;
    for (const path of pl.on_enter) for (const d of path.do) if (d.event) ctx.eventSections.set(d.event.section, pl.id);
  }
}

/**
 * 一日の終わり（52 wait_ui15 = セーブの画面 → 21）の後に行く場所。元のゲームで場所を決める仕組みは未解明なので、
 * 「その区画より後の、日時の表示（93 align 1）がある会話 event のうち、それまでに立つフラグで道の条件を満たす最初のもの」の場所にする
 */
export function nextDayPlace(ctx: Context, section: number): number | null {
  const inv = ctx.inv!;
  const set = new Set<string>();
  for (const sec of ctx.entry.body) {
    if (sec.section > section) break;
    for (const o of sec.ops) if (o.op === 16 && o.args[0]! >> 15) set.add(`0:${o.args[0]! & 0xff}`);
  }
  for (const pl of inv.places) {
    for (const path of pl.on_enter) {
      for (const d of path.do) {
        if (d.event && d.event.section <= section && d.set_flag) set.add(`0:${Number(String(d.set_flag).split(':')[1])}`);
      }
    }
  }
  const ok = (when: Record<string, number | string>) => Object.entries(when).every(([k, v]) => {
    if (k === 'lang') return v === ctx.entry.lang;
    const [g, n] = k.split(':');
    return set.has(`${g}:${Number(n)}`) === (v === 1);
  });
  let best: { e: number; place: number } | null = null;
  for (const pl of inv.places) {
    if (scriptEntryOf(ctx, pl) !== ctx.entry.entry) continue;
    for (const path of pl.on_enter) {
      for (const d of path.do) {
        const e = d.event?.section as number | undefined;
        if (e === undefined || e <= section || !ok(path.when)) continue;
        const card = ctx.entry.body[e]?.ops.some(o => o.op === 93 && o.args[0] === 1);
        if (card && (!best || e < best.e)) best = { e, place: pl.id };
      }
    }
  }
  return best?.place ?? null;
}

/** 最初に行く場所: ARM9 の始めの関数が決める場所（invest_start.json）、無ければ §0 から落ちていく最初の event の場所 */
function startPlace(ctx: Context): number {
  const known = ctx.t.investStart?.[String(ctx.part)];
  if (known !== undefined) return known;
  for (let s = 0; s < ctx.entry.body.length; s++) {
    if (ctx.eventSections.has(s)) return ctx.eventSections.get(s)!;
    const ops = ctx.entry.body[s]!.ops;
    if (ops.some(o => o.op === 21 || o.op === 10 || o.op === 54 || o.op === 8 || o.op === 9)) break;
  }
  return ctx.inv!.places[0]?.id ?? 0;
}

/** 始めのフラグ（組 0 は 0、パート > 1 ならフラグ 0x41 = 1）で、最初の場所の着いたときの道に会話 event があるか */
function startsWithEvent(ctx: Context, place: number): boolean {
  const pl = ctx.inv!.places.find((p: { id: number }) => p.id === place);
  const init = (k: string) => (k === `0:0x${EXAMINE_READY.toString(16)}` && ctx.inv!.part > 1 ? 1 : 0);
  const path = pl?.on_enter.find((p: { when: Record<string, number | string> }) =>
    Object.entries(p.when).every(([k, v]) => (k === 'lang' ? v === ctx.entry.lang : init(k) === v)));
  return !!path?.do.some((d: { event?: unknown }) => d.event);
}

/** パート > 1 ではフラグ 0x41 が最初から立っている */
export function initInvestigationFlags(ctx: Context) {
  ctx.fname(0, EXAMINE_READY);
}

/** 探偵パートの始めのフラグ: パート < 17 なら組 0 を 0 に戻し、パート > 1 ならフラグ 0x41 = 1 */
/**
 * 第 5 話の日の始め（探偵パート 0x16 / 0x1c、法廷 0x13 / 0x19 / 0x1f）のフラグ。台本のフラグ（組 0）を戻す:
 * 第 5 話の台本は日ごとに同じ番号を別の意味で使い（例: 034 §8 の話題の既読 0x2a を 038 の尋問で 138 の道の印に使う）、
 * どの日も前の日にだけ立つフラグは読まない（台本と探偵パートの表で確かめた）。元のゲームで消す所は見つかっていない（推測）。
 * 法廷の日は、ARM9 のパートの始め（0x0202f7dc〜）が決めるもの（0x1f = 茜が一緒か、ほかは尋問の進み具合）もそのとおりに。
 * 0x1f はコードが決めるので戻さない
 */
export function dayStartFlags(part: number, flags: string[]): Record<string, boolean> | null {
  const rom: Record<number, Record<number, boolean>> = {
    0x13: { 0x02: false, 0x21: false, 0x22: false, 0x1f: true },
    0x16: {},
    0x19: { 0x0f: false, 0x10: false, 0x23: false, 0x24: false, 0x1f: true },
    0x1c: {},
    0x1f: { 0x25: false, 0x26: false, 0x27: false, 0x1f: false },
  };
  if (!rom[part]) return null;
  const out: Record<string, boolean> = {};
  for (const f of flags) if (f.startsWith('f_0_') && f !== 'f_0_31') out[f] = false;
  for (const [n, v] of Object.entries(rom[part]!)) out[`f_0_${n}`] = v;
  return out;
}

export function investigationStartFlags(part: number, flags: string[]): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  if (part < 17) for (const f of flags) if (f.startsWith('f_0_')) out[f] = false;
  if (part > 1) out[`f_0_${EXAMINE_READY}`] = true;
  return out;
}

/** 共通の台本（項目 072/073）の区画を、探偵メニューへ戻る所を外したステップ列にする（無ければ「……」） */
export function commonBlock(ctx: Context, common: Entry | null, section: number): Step[] {
  const sec = common?.body[section];
  return sec ? stripMenuReturn(ctx, convertOps(ctx, section, sec.ops, { menuReturn: [] })) : [{ narrate: '……' }];
}

export function buildPlaces(ctx: Context, common: Entry | null): { places: Record<string, unknown>; menu: Step[]; startAtMenu: boolean } {
  const inv = ctx.inv!;
  const st = ctx.stats;
  const pf = ctx.personFlag();
  /** 区画をブロックにする（その場所の台本の項目で） */
  let pc = ctx;
  const block = (s: number, from = -1) => stripMenuReturn(pc, pc.jump(s, from, 'choice'));
  /** 表の区画（script が common なら共通の台本の区画。例: 調べる表の「手がかりになるものはない。」= 共通の §43） */
  const sectionBlock = (sec: Sec) => (sec.script === 'common' ? commonBlock(ctx, common, sec.section) : block(sec.section));
  const places: Record<string, unknown> = {};
  const lateExamine = inv.part < 17;
  if (inv.places.some((p: { every_frame: unknown[] }) => p.every_frame.length)) st.gap('探偵パートの毎フレームの処理（every_frame）', -1);

  for (const pl of inv.places) {
    const P: number = pl.id;
    pc = ctxOf(ctx, pl);
    const pid = ctx.placeId(P);
    // 着いたとき
    const chain = (k: number): Step[] => {
      const path = pl.on_enter[k];
      if (!path) return [];
      const doSteps: Step[] = [];
      for (const d of path.do) {
        if (d.event) {
          const [g, n] = String(d.set_flag).split(':');
          doSteps.push({ set: { [ctx.fname(Number(g), Number(n))]: true } }, ...block((d.event as Sec).section));
        }
        if (d.set_flag && !d.event) {
          const [g, n] = String(d.set_flag).split(':');
          doSteps.push({ set: { [ctx.fname(Number(g), Number(n))]: d.value === undefined ? true : !!d.value } });
        }
        if (d.char !== undefined) {
          const k = d.char & 0x1fff;
          doSteps.push({ show: ctx.character(k), talk: d.talk, ...(d.idle !== d.talk ? { idle: d.idle } : {}) }, { set: { [pf]: k } });
          if (d.char & 0xe000) st.gap('人物の位置・反転（30 char の 0x8000/0x4000/0x2000）', -1);
        }
        if (d.bgm !== undefined) doSteps.push({ bgm: ctx.sound(d.bgm) });
        if (d.call !== undefined || d.op_2232c !== undefined) st.gap('着いたときの処理の中の、下画面などの関数呼び出し', -1);
      }
      const rest = chain(k + 1);
      const cond = whenOf(ctx, path.when);
      if (cond === 'false') return rest;
      if (cond === 'true') return doSteps;
      return [{ if: cond, then: doSteps.length ? doSteps : [{ set: { [pf]: 0 } }], ...(rest.length ? { else: rest } : {}) }];
    };
    // 毎フレームの処理（every_frame）: 条件を満たすとフラグを立てる。各行動の終わりと着いたときに調べる（ずれ）
    const frame: Step[] = pl.every_frame.flatMap((r: { when: Record<string, number>; do: Record<string, any>[] }) => {
      const sets = r.do.filter(d => d.set_flag).map(d => {
        const [g, n] = String(d.set_flag).split(':');
        return { set: { [ctx.fname(Number(g), Number(n))]: d.value === undefined ? true : !!d.value } };
      });
      if (r.do.some(d => d.examine)) st.gap('毎フレームの処理で調べる表を替える（every_frame）', -1);
      return sets.length ? [{ if: whenOf(ctx, r.when), then: sets }] : [];
    });
    const withFrame = (steps: Step[]) => (frame.length ? [...steps, ...frame] : steps);
    const enter: Step[] = [
      { set: { [ctx.placeFlag()]: P } },
      { if: ctx.returnFlag(), then: [{ set: { [ctx.returnFlag()]: false } }], else: [{ set: { [pf]: 0 } }, ...chain(0)] },
      ...frame,
    ];
    // 人物（その場所の話す・つきつけるの表に出る人と、着いたときに出す人）
    const persons = new Set<number>();
    for (const t of inv.talk) if (t.place === P) persons.add(t.person & 0x1fff);
    for (const e of inv.present.entries) if (e.place === P) persons.add(e.person & 0x1fff);
    for (const path of pl.on_enter) for (const d of path.do) if (d.char !== undefined) persons.add(d.char & 0x1fff);
    const person = [...persons].map(k => ({ id: ctx.character(k), when: `${pf} == ${k}` }));
    // 調べる
    const tableConds = new Map<string, string[]>();
    for (const path of pl.on_enter) {
      const t = [...path.do].reverse().find((d: { examine?: string | null }) => d.examine)?.examine as string | undefined;
      const c = whenOf(ctx, path.when);
      if (t && c !== 'false') tableConds.set(t, [...(tableConds.get(t) ?? []), c]);
    }
    const examine: Record<string, unknown>[] = [];
    const nothing = commonBlock(ctx, common, COMMON_NOTHING);
    const scaleX = SCREEN.w / bgWidth(pl.bg_file);
    if (scaleX !== 1) st.gap('横長の背景（512 ドット）のスクロール: 調べる場所を画面の幅に縮めた', -1);
    for (const [table, conds] of tableConds) {
      const entries = inv.examine_tables[table] ?? [];
      // 条件つきを先に。重なったときに小さいものが選べるよう、同じ種類の中では小さい順
      const size = (e: { quad: number[][] }) => { const a = areaOf(e.quad, scaleX); return a ? a[2] * a[3] : 0; };
      const bySize = (xs: Record<string, any>[]) => [...xs].sort((a, b) => size(a as { quad: number[][] }) - size(b as { quad: number[][] }));
      const sorted = [...bySize(entries.filter((e: { kind: string }) => e.kind === 'cond')), ...bySize(entries.filter((e: { kind: string }) => e.kind !== 'cond'))];
      for (const e of sorted) {
        const area = areaOf(e.quad, scaleX);
        if (!area) { st.gap('画面の外（横長の背景をずらした先）の調べる場所', e.section.section); continue; }
        st.gap('調べる場所の四角形を長方形にし、小さい順に並べた（元は 4 点の四角形と 16×16 のカーソルの重なり）', e.section.section);
        const when = and([or(conds), ...(lateExamine ? [ctx.fname(0, EXAMINE_READY)] : []), ...(e.cond ? [condOf(ctx, e.cond)] : [])]);
        examine.push({ area, ...(when !== 'true' ? { when } : {}), then: withFrame(sectionBlock(e.section)) });
      }
    }
    const examineDefault = withFrame(lateExamine
      ? [{ if: ctx.fname(0, EXAMINE_READY), then: nothing, else: block(EXAMINE_NOT_YET) }]
      : nothing);
    // 話す
    const talk: Record<string, unknown>[] = [];
    const topicWhen = new Map<string, { t: Record<string, any>; k: number; flags: string[] }>();
    // 使うのは、同じ場所・人物の項目のうち有効な最初のもの（前の項目が有効なら、この項目は使わない）
    const earlier = new Map<number, string[]>();
    inv.talk.forEach((entry: Record<string, any>) => {
      if (entry.place !== P) return;
      const k = (entry.person as number) & 0x1fff;
      const own = ctx.flag(`${ctx.gpfx}talk_${entry.id}`, !!entry.active);
      const before = earlier.get(k) ?? [];
      const flag = and([own, ...before.map(f => `not ${f}`)]);
      earlier.set(k, [...before, own]);
      for (const t of entry.topics) {
        const key = `${entry.person}:${t.topic}:${t.section.section}`;
        const v = topicWhen.get(key) ?? { t, k: (entry.person as number) & 0x1fff, flags: [] as string[] };
        v.flags.push(flag);
        topicWhen.set(key, v);
      }
    });
    for (const [key, v] of topicWhen) {
      const [, topic, sec] = key.split(':');
      talk.push({
        id: `${pid}_k${v.k}_t${topic}_${sec}`,
        topic: v.t.name_ocr || `話題 ${topic}`,
        when: and([`${pf} == ${v.k}`, or(v.flags)]),
        // 話題の既読（組 2 のフラグ）を立ててから
        then: withFrame([{ set: { [ctx.fname(2, v.t.read_flag)]: true } }, ...block(v.t.section.section)]),
      });
    }
    // つきつける（人物ごとの表。合わなければその人の既定。人物ファイルも同じ表を引き、表に無ければ既定の反応）
    const rows = inv.present.entries.filter((e: { place: number }) => e.place === P);
    const byPerson = new Map<number, Record<string, any>[]>();
    for (const r of rows) byPerson.set(r.person & 0x1fff, [...(byPerson.get(r.person & 0x1fff) ?? []), r]);
    const personChain = (f: (k: number, rs: Record<string, any>[]) => Step[]): Step[] => {
      let out: Step[] = rows[0] ? block(rows[0].default.section) : [];
      for (const [k, rs] of [...byPerson].reverse()) out = [{ if: `${pf} == ${k}`, then: f(k, rs), ...(out.length ? { else: out } : {}) }];
      return out;
    };
    const present: Record<string, Step[]> = {};
    const items = new Set<number>(rows.filter((r: { item: number | null }) => r.item !== null).map((r: { item: number }) => r.item));
    for (const item of items) {
      // 法廷記録の番号は証拠品と人物ファイルで通し番号。人物ファイルなら、YAML では人物 ID をキーにする
      const key = ctx.shared.profileRecords.has(item) ? ctx.profile(item) : ctx.evidenceId(item);
      present[key] = withFrame(personChain((_k, rs) => {
        const hit = rs.find(r => r.item === item);
        return block((hit ?? rs.at(-1)!)[hit ? 'section' : 'default'].section);
      }));
    }
    const presentWrong = withFrame(personChain((_k, rs) => block(rs.at(-1)!.default.section)));
    // 移動する（51 で版が変わる）
    const versions = ctx.moveVersions.get(P) ?? [pl.dest];
    const mv = versions.length > 1 ? ctx.flag(`${ctx.gpfx}mv_${P}`, 0) : null;
    const dests = [...new Set(versions.flat())];
    const move = dests.filter(d => d !== P && inv.places.some((x: { id: number }) => x.id === d)).map(d => {
      const ks = versions.flatMap((v, k) => (v.includes(d) ? [k] : []));
      return ks.length === versions.length || !mv ? ctx.placeId(d) : { to: ctx.placeId(d), when: or(ks.map(k => `${mv} == ${k}`)) };
    });
    places[pid] = {
      name: pl.name?.ocr || `場所 ${P}`,
      background: bgKey(pl.bg).key,
      ...(person.length ? { person } : {}),
      enter,
      ...(examine.length ? { examine } : {}),
      examineDefault,
      ...(talk.length ? { talk } : {}),
      ...(Object.keys(present).length ? { present } : {}),
      ...(rows.length ? { presentWrong } : {}),
      ...(move.length ? { move } : {}),
    };
  }
  const start = startPlace(ctx);
  const menu: Step[] = [
    ...inv.places.map((pl: { id: number }) => ({ if: `${ctx.placeFlag()} == ${pl.id}`, then: [{ investigate: ctx.placeId(pl.id) }] })),
    { set: { [ctx.returnFlag()]: false } },
    { investigate: ctx.placeId(start) },
  ];
  return { places, menu, startAtMenu: startsWithEvent(ctx, start) };
}
