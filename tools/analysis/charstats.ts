// 人物ごとの話し方の集計（characters.ts が docs/characters/*.md に書き出す）。
// 一人称・呼び方・語尾・ページの頭の言葉・記号・演出・色・立ち絵の動き・場面を数える。

import { FIRST_PERSON, HONORIFIC, PLAIN_NAMES, SECOND_PERSON, TITLES } from './address.ts';
import {
  type Episode,
  type Line,
  lineOf,
  type StepRec,
  uniqueLines,
  walkEpisode,
} from './corpus.ts';
import { Counter } from './stats.ts';
import { countMatches, parseText } from './text.ts';

/** 同じ人物の別の名札・絵（大写し・霊媒・過去の姿など）を 1 人にまとめる */
export const ALIAS: Record<string, string> = {
  judge_alt: 'judge',
  von_karma_alt: 'von_karma',
  von_karma_closeup: 'von_karma',
  byrde_alt: 'byrde',
  mia_channeled: 'mia',
  mia_channeled_pearl: 'mia',
  mia_channeled_waitress: 'mia',
  mia_rookie: 'mia',
  mia_closeup: 'mia',
  maya_waitress: 'maya',
  butz_artist: 'butz',
  godot_falsetto: 'godot',
  godot_closeup: 'godot',
  phoenix_closeup: 'phoenix',
  phoenix_silhouette: 'phoenix',
  phoenix_college: 'phoenix',
  edgeworth_closeup: 'edgeworth',
  edgeworth_young: 'edgeworth',
  de_killer_radio: 'de_killer',
  old_man: 'kudo',
};

/** 人ではない話し手・名前の分からない話し手（対象から外す） */
export const NOT_PERSON =
  /^(unknown|unknown_female|phone|tv|public|interphone|alarm_clock|voice.*|buzzer|announcer|pa_notice|credits|detective|chief|bellboy|bailiff|officer|jailer|patrolman|nurse)$/;

export const who = (id: string): string => ALIAS[id] ?? id.replace(/_v\d+$/, '');

export interface CharStats {
  id: string;
  lines: number;
  /** 重複を除かない台詞の数（show の回数と比べるため） */
  rawLines: number;
  chars: number;
  pages2: number;
  perEp: Counter<string>;
  kind: Counter<string>;
  where: Counter<string>;
  first: Counter<string>;
  second: Counter<string>;
  names: Counter<string>;
  end1: Counter<string>;
  end3: Counter<string>;
  heads: Counter<string>;
  kata: Counter<string>;
  marks: Counter<string>;
  lens: number[];
  fx: Counter<string>;
  colorLines: Counter<string>;
  colorChars: Counter<string>;
  showSame: number;
  showSwitchIn: number;
  poses: Set<string>;
  partners: Counter<string>;
  names2: Set<string>;
  stand: Set<string>;
}

const newStats = (id: string): CharStats => ({
  id,
  lines: 0,
  rawLines: 0,
  chars: 0,
  pages2: 0,
  perEp: new Counter(),
  kind: new Counter(),
  where: new Counter(),
  first: new Counter(),
  second: new Counter(),
  names: new Counter(),
  end1: new Counter(),
  end3: new Counter(),
  heads: new Counter(),
  kata: new Counter(),
  marks: new Counter(),
  lens: [],
  fx: new Counter(),
  colorLines: new Counter(),
  colorChars: new Counter(),
  showSame: 0,
  showSwitchIn: 0,
  poses: new Set(),
  partners: new Counter(),
  names2: new Set(),
  stand: new Set(),
});

/** 台詞の場面の分類 */
export function sceneKind(rec: StepRec): string {
  const w = rec.ctx.where;
  const has = (k: string) => w.some((x) => x === k || x.endsWith(`.${k}`));
  if (rec.ctx.kind === 'trial') {
    if (w[0] === 'reading') return '証言';
    if (w[0] === 'statements' && w[1] === 'press') return 'ゆさぶり';
    if (w[0] === 'statements' && w[1] === 'present') return 'つきつけ（法廷）';
    if (w[0] === 'after' || w[0] === 'loop') return '証言の後・尋問の一巡';
    if (w[0] === 'wrong' || has('wrong')) return '見当違い';
    if (has('choice')) return '選択肢';
    return '法廷の会話';
  }
  if (w[0] === 'talk') return '話す';
  if (w[0] === 'examine' || w[0] === 'examineDefault') return '調べる';
  if (w[0] === 'present' || w[0] === 'presentWrong') return 'つきつけ（探偵）';
  if (w[0] === 'enter') return '場所に来たとき';
  return '探偵の会話';
}

const flatText = (l: Line) => parseText(l.raw, l.color);

/** 話し手ごとに集計する（重複を除いた台詞で） */
export function collect(eps: Episode[]): { stats: Map<string, CharStats>; all: CharStats } {
  const stats = new Map<string, CharStats>();
  const all = newStats('*');
  const get = (id: string) => stats.get(id) ?? (stats.set(id, newStats(id)).get(id) as CharStats);
  for (const ep of eps) {
    const ls: Line[] = [];
    const cur = new Map<number, string | null>();
    const prevSpeaker = new Map<number, string>();
    for (const r of walkEpisode(ep)) {
      if (r.type === 'show') {
        const id = r.step.show ? who(r.step.show) : null;
        const same = cur.get(r.arrayId) === id;
        cur.set(r.arrayId, id);
        if (id && typeof r.step.talk === 'number') {
          const s = get(id);
          if (same) s.showSame++;
          else s.showSwitchIn++;
          s.poses.add(`${ep.game}:${r.step.talk}`);
        }
      }
      const l = lineOf(r);
      if (!l) continue;
      ls.push(l);
      if (l.speaker) {
        const sp = who(l.speaker);
        get(sp).rawLines++;
        const prev = prevSpeaker.get(r.arrayId);
        if (prev && prev !== sp) {
          get(sp).partners.add(prev);
          get(prev).partners.add(sp);
        }
        prevSpeaker.set(r.arrayId, sp);
        for (const c of parseText(l.raw).commands)
          if (c.name === 'show' && c.args[0] && c.args[0] !== 'null' && who(c.args[0]) === sp)
            get(sp).showSame++;
      }
    }
    for (const l of uniqueLines(ls)) {
      if (!l.speaker) continue;
      const s = get(who(l.speaker));
      const ch = ep.data.characters?.[l.speaker];
      if (ch?.profile?.name) s.names2.add(ch.profile.name);
      else if (ch?.name) s.names2.add(ch.name);
      if (ch?.stand) s.stand.add(ch.stand);
      for (const target of [s, all]) addLine(target, l, ep);
    }
  }
  return { stats, all };
}

function addLine(s: CharStats, l: Line, ep: Episode) {
  const p = flatText(l);
  const flat = p.plain.replace(/\n/g, '');
  s.lines++;
  s.chars += p.chars;
  s.lens.push(p.chars);
  if (p.lines.length >= 2) s.pages2++;
  s.perEp.add(ep.key);
  s.kind.add(l.rec.ctx.kind);
  s.where.add(sceneKind(l.rec));
  const inner = l.color === 'blue';
  s.colorLines.add(inner ? 'blue' : l.color);
  for (const c of p.colors) s.colorChars.add(c);
  if (!inner) {
    for (const [k, re] of FIRST_PERSON) s.first.add(k, countMatches(flat, re));
    for (const [k, re] of SECOND_PERSON) s.second.add(k, countMatches(flat, re));
    for (const m of flat.matchAll(HONORIFIC)) s.names.add(m[0]);
    for (const m of flat.matchAll(TITLES)) s.names.add(m[0]);
    for (const m of flat.matchAll(PLAIN_NAMES)) s.names.add(`${m[0]}（敬称なし）`);
  }
  // 文末（「。！？‥」の前か、ページの終わり）
  const body = flat.replace(/[（）“”「」]/g, '').replace(/[　 ]/g, '');
  for (const m of body.matchAll(/([^。!！?？‥、]+?)([。!！?？‥]+|$)/g)) {
    const sent = m[1] ?? '';
    const tail = sent.match(/[ぁ-ゟァ-ヺーッっ〜]+$/)?.[0];
    // 「〜くん」「〜さん」で終わる文は呼びかけなので、語尾に数えない（呼び方で数える）
    if (!tail || /(くん|クン|さん|サン|ちゃん|チャン|さま|サマ|どの)$/.test(tail)) continue;
    s.end1.add(tail.slice(-1));
    s.end3.add(tail.length >= 2 ? tail.slice(-3) : tail);
  }
  const head = body.match(/^([^。!！?？‥、]{1,5})[。!！?？‥、]/)?.[1];
  if (head && /^[ぁ-ゟァ-ヺーッっ〜]+$/.test(head)) s.heads.add(head);
  for (const m of flat.matchAll(/[ァ-ヺー]{3,}/g)) s.kata.add(m[0]);
  s.marks.add('！', countMatches(flat, /[!！]/g));
  s.marks.add('？', countMatches(flat, /[?？]/g));
  s.marks.add('‥‥', countMatches(flat, /‥+/g));
  s.marks.add('ッ', countMatches(flat, /[ッっ]/g));
  s.marks.add('ー', countMatches(flat, /ー/g));
  s.marks.add('、', countMatches(flat, /、/g));
  s.marks.add('“”', countMatches(flat, /“/g));
  s.marks.add('〜', countMatches(flat, /[〜～]/g));
  s.marks.add('カタカナ', countMatches(flat, /[ァ-ヺ]/g));
  s.marks.add('漢字', countMatches(flat, /[一-鿿々]/g));
  // 演出
  const cmds = p.commands;
  const before = new Set<string>();
  for (let i = l.rec.index - 1; i >= 0; i--) {
    const st = l.rec.siblings[i];
    const k = Object.keys(st)[0] ?? '';
    if (ep.characters.has(k) || k === 'say' || k === 'narrate') break;
    before.add(k);
  }
  const has = (n: string) => before.has(n) || cmds.some((c) => c.name === n);
  if (has('shake')) s.fx.add('揺れ');
  if (has('flash')) s.fx.add('フラッシュ');
  if (has('se')) s.fx.add('効果音');
  if (before.has('bgmPause')) s.fx.add('BGM一時停止の直後');
  if (before.has('bgm') || cmds.some((c) => c.name === 'bgm')) s.fx.add('BGM切替');
  const sp = cmds.filter((c) => c.name === 'speed').map((c) => Number(c.args[0]));
  if (sp.some((v) => v > 3)) s.fx.add('遅い文字送り');
  if (sp.some((v) => v < 3)) s.fx.add('速い文字送り');
  s.fx.add('wait', cmds.filter((c) => c.name === 'wait').length);
}
