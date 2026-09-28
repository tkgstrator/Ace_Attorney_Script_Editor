// 章の中で ID を参照している所を探す（ID を変えるときに、参照も書き換えるため）。
// スキーマ（packages/script/src/schema.ts）の形に沿って歩くので、別の種類の同じ名前の ID は拾わない。
// 台詞の本文の中の文中コマンド（[show x] など）は対象外
import { type CondRef, condMentions } from './cond.ts';
import { stepKind } from './steps.ts';
import type { Path } from './yaml-doc.ts';

export type RefTarget = 'scene' | 'place' | 'character' | 'evidence' | 'flag';

export type Ref =
  /** path の値（文字列）がその ID */
  | { how: 'value'; path: Path }
  /** path のマップのキーがその ID */
  | { how: 'key'; path: Path }
  /** path の値が条件式で、その中に kind の ID がある */
  | { how: 'cond'; path: Path; kind: CondRef };

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => typeof v === 'object' && v !== null && !Array.isArray(v);

export const REF_LABELS: Record<RefTarget, string> = {
  scene: 'シーン',
  place: '場所',
  character: '人物',
  evidence: '証拠品',
  flag: 'フラグ',
};

/** 条件式の中で、その種類の ID を書く所 */
const COND_KIND: Partial<Record<RefTarget, CondRef[]>> = {
  flag: ['var'],
  evidence: ['has'],
  scene: ['visited'],
  place: ['visited'],
};

/** data の中で、target の id を参照している所の一覧 */
export function findRefs(data: unknown, target: RefTarget, id: string): Ref[] {
  const out: Ref[] = [];
  if (!isRec(data)) return out;
  const evidenceIds = isRec(data.evidence) ? Object.keys(data.evidence) : [];

  const value = (v: unknown, path: Path, t: RefTarget) => {
    if (t === target && v === id) out.push({ how: 'value', path });
  };
  const list = (v: unknown, path: Path, t: RefTarget) => {
    if (!Array.isArray(v)) {
      value(v, path, t);
      return;
    }
    v.forEach((x, i) => {
      value(x, [...path, i], t);
    });
  };
  const cond = (v: unknown, path: Path) => {
    if (typeof v !== 'string') return;
    for (const kind of COND_KIND[target] ?? [])
      if (condMentions(v, kind, id)) out.push({ how: 'cond', path, kind });
  };
  /** つきつけの表のキー（証拠品か、人物ファイルの人物） */
  const presentKeys = (m: unknown, path: Path, profiles: boolean) => {
    if (!isRec(m)) return;
    for (const [k, v] of Object.entries(m)) {
      const isTarget =
        k === id &&
        (target === 'evidence' || (profiles && target === 'character' && !evidenceIds.includes(k)));
      if (isTarget) out.push({ how: 'key', path });
      steps(v, [...path, k]);
    }
  };

  const step = (s: unknown, path: Path) => {
    if (!isRec(s)) return;
    const kind = stepKind(s);
    const at = (k: string) => [...path, k];
    switch (kind) {
      case 'shorthand': {
        const key = Object.keys(s)[0]!;
        if (target === 'character' && key === id) out.push({ how: 'key', path });
        return;
      }
      case 'say':
        return value(s.say, at('say'), 'character');
      case 'set':
      case 'add':
        if (target === 'flag' && isRec(s[kind]) && id in (s[kind] as Rec))
          out.push({ how: 'key', path: at(kind) });
        return;
      case 'give':
      case 'take':
        return list(s[kind], at(kind), 'evidence');
      case 'giveProfile':
      case 'takeProfile':
        return list(s[kind], at(kind), 'character');
      case 'if':
        cond(s.if, at('if'));
        steps(s.then, at('then'));
        return steps(s.else, at('else'));
      case 'choice':
        if (Array.isArray(s.choice))
          s.choice.forEach((o, i) => {
            if (!isRec(o)) return;
            cond(o.when, [...path, 'choice', i, 'when']);
            steps(o.then, [...path, 'choice', i, 'then']);
          });
        return;
      case 'pick':
        if (Array.isArray(s.areas))
          s.areas.forEach((o, i) => {
            if (!isRec(o)) return;
            cond(o.when, [...path, 'areas', i, 'when']);
            steps(o.then, [...path, 'areas', i, 'then']);
          });
        steps(s.miss, at('miss'));
        return steps(s.quit, at('quit'));
      case 'demand':
        presentKeys(s.present, at('present'), true);
        steps(s.wrong, at('wrong'));
        return value(s.by, at('by'), 'character');
      case 'goto':
        return value(s.goto, at('goto'), 'scene');
      case 'investigate':
        return value(s.investigate, at('investigate'), 'place');
      case 'shout':
        return value(s.by, at('by'), 'character');
      case 'showEvidence':
        return value(s.showEvidence, at('showEvidence'), 'evidence');
      case 'show':
        return value(s.show, at('show'), 'character');
      case 'pan':
        return value(s.to, at('to'), 'character');
      case 'random':
        if (Array.isArray(s.random))
          s.random.forEach((l, i) => {
            steps(l, [...path, 'random', i]);
          });
        return;
    }
  };
  const steps = (v: unknown, path: Path) => {
    if (!Array.isArray(v)) return;
    v.forEach((s, i) => {
      step(s, [...path, i]);
    });
  };

  const testimony = (t: Rec, path: Path) => {
    value(t.witness, [...path, 'witness'], 'character');
    if (Array.isArray(t.statements))
      t.statements.forEach((st, i) => {
        if (!isRec(st)) return;
        const p = [...path, 'statements', i];
        cond(st.when, [...p, 'when']);
        steps(st.press, [...p, 'press']);
        steps(st.before, [...p, 'before']);
        presentKeys(st.present, [...p, 'present'], false);
      });
    for (const k of ['reading', 'after', 'loop', 'wrong']) steps(t[k], [...path, k]);
  };
  const scenes = (m: unknown, path: Path) => {
    if (!isRec(m)) return;
    for (const [k, v] of Object.entries(m)) {
      if (isRec(v)) testimony(v, [...path, k]);
      else steps(v, [...path, k]);
    }
  };
  const place = (pl: unknown, path: Path) => {
    if (!isRec(pl)) return;
    if (Array.isArray(pl.person))
      pl.person.forEach((x, i) => {
        if (!isRec(x)) return;
        value(x.id, [...path, 'person', i, 'id'], 'character');
        cond(x.when, [...path, 'person', i, 'when']);
      });
    else value(pl.person, [...path, 'person'], 'character');
    steps(pl.enter, [...path, 'enter']);
    for (const k of ['examine', 'talk'])
      if (Array.isArray(pl[k]))
        (pl[k] as unknown[]).forEach((x, i) => {
          if (!isRec(x)) return;
          cond(x.when, [...path, k, i, 'when']);
          steps(x.then, [...path, k, i, 'then']);
        });
    steps(pl.examineDefault, [...path, 'examineDefault']);
    presentKeys(pl.present, [...path, 'present'], true);
    steps(pl.presentWrong, [...path, 'presentWrong']);
    if (Array.isArray(pl.move))
      pl.move.forEach((m, i) => {
        if (isRec(m)) {
          value(m.to, [...path, 'move', i, 'to'], 'place');
          cond(m.when, [...path, 'move', i, 'when']);
        } else value(m, [...path, 'move', i], 'place');
      });
  };

  // 章の一番上
  value(data.player, ['player'], 'character');
  value(data.gameover, ['gameover'], 'scene');
  if (isRec(data.start)) {
    value(data.start.scene, ['start', 'scene'], 'scene');
    list(data.start.evidence, ['start', 'evidence'], 'evidence');
    list(data.start.profiles, ['start', 'profiles'], 'character');
  }
  if (isRec(data.defaults)) steps(data.defaults.wrongPresent, ['defaults', 'wrongPresent']);
  if (isRec(data.evidence))
    for (const [k, ev] of Object.entries(data.evidence))
      if (isRec(ev) && Array.isArray(ev.examine))
        ev.examine.forEach((x, i) => {
          if (!isRec(x)) return;
          cond(x.when, ['evidence', k, 'examine', i, 'when']);
          steps(x.then, ['evidence', k, 'examine', i, 'then']);
        });
  scenes(data.scenes, ['scenes']);
  if (Array.isArray(data.parts))
    data.parts.forEach((p, i) => {
      if (!isRec(p)) return;
      scenes(p.scenes, ['parts', i, 'scenes']);
      if (isRec(p.places))
        for (const [k, pl] of Object.entries(p.places)) place(pl, ['parts', i, 'places', k]);
    });
  return out;
}

/** 記録（人物・証拠品・フラグ）の表のパス → 参照の種類 */
export const RECORD_TARGET: Record<string, RefTarget> = {
  characters: 'character',
  evidence: 'evidence',
  flags: 'flag',
};
