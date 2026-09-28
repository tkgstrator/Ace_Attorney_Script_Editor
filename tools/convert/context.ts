// 変換中に共有するもの（表・集計・ID の割り当て・参照の記録）。
import { RESERVED_KEYS } from '../../packages/script/src/schema.ts';
import { isStorySection, parseProfileName, slug, soundId } from './tables.ts';
import { Stats } from './stats.ts';
import type { Entry, Step, Tables } from './types.ts';

export interface Character {
  name: string;
  stand?: string;
  blip?: 'male' | 'female';
  profile?: { name?: string; age?: number; description: string; icon?: string };
}

/** 章の中の編（項目）で共有するもの: 人物・証拠品・立ち位置の推定 */
export class Shared {
  readonly characters = new Map<string, Character>();
  readonly evidence = new Set<number>();
  readonly standVotes = new Map<string, Map<string, number>>();
  /** 名前の番号 → 人物 ID（使った順に決める。英語の名札が重なれば 2 つ目から _番号） */
  readonly nameIds = new Map<number, string>();
  /** 人物ファイルとして使う法廷記録の番号（つきつけの表で証拠品と区別する） */
  readonly profileRecords = new Set<number>();
}

/** 探偵パートの表（investigation.json の parts の 1 つ） */
export type InvPart = Record<string, any>;

export class Context {
  readonly stats = new Stats();
  readonly shared: Shared;
  get characters() {
    return this.shared.characters;
  }
  get evidence() {
    return this.shared.evidence;
  }
  get standVotes() {
    return this.shared.standVotes;
  }
  readonly flags = new Map<string, boolean | number>();
  /** goto の行き先になった区画 */
  readonly referenced = new Set<number>();
  /** 証言・つきつけの外れなどに取り込んだ区画（シーンとしては出さない） */
  readonly consumed = new Set<number>();
  /** 証言のタイトルの区画 → 証言の前のシーン（「証言開始」の前まで → 証言シーンへ） */
  readonly preScenes = new Map<number, Step[]>();
  /** 区画 → 別のシーン ID（証言に取り込んだ区画など） */
  readonly redirect = new Map<number, string>();
  /** 区画の途中から始まるシーンで、行き先になったもの（区画, 位置） */
  readonly pieces = new Set<string>();
  /** 21 player_turn の代わりに移る区画（ルミノールの説明の後など、ARM9 が決める行き先。examine3d.ts） */
  readonly turnGoto = new Map<number, number>();
  /** 3D で詳しく調べた結果として証拠品の examine に取り込む区画 → ステップ列（examine3d.ts） */
  readonly examineSteps = new Map<number, Step[]>();
  readonly #nameIds: Map<number, string>;
  readonly part: number;
  readonly t: Tables;
  readonly entry: Entry;
  /** シーン・場所・フラグの ID の頭（章に複数の編をまとめるとき。例 p1_） */
  readonly pfx: string;
  /** 探偵パートなら、その表 */
  readonly inv: InvPart | null;
  /** 探偵パート: 場所 → 行き先の版（51 で書き換わる） */
  moveVersions = new Map<number, number[][]>();
  /** 探偵パート: 着いたときの会話（event）の区画 → 場所 */
  readonly eventSections = new Map<number, number>();
  /** 22 next_part（次の編へ）のステップ。1 つの編だけなら end */
  nextPart: Step[] = [{ end: true }];
  /** パートの番号を決めて移る（106: 次の語の値のパートの台本を読む）ステップ */
  toPart: (part: number) => Step[] = () => [{ end: true }];

  /** 探偵パートの組（第 5 話では 1 つの探偵パートが複数の項目にまたがる）で共有する、フラグ・場所・探偵メニューの ID の頭 */
  readonly gpfx: string;
  /** 探偵パートの組の、ほかの項目の Context（場所ごとの台本の項目 → Context） */
  group = new Map<number, Context>();

  constructor(
    t: Tables,
    entry: Entry,
    opts: { shared?: Shared; pfx?: string; gpfx?: string; inv?: InvPart | null } = {},
  ) {
    this.t = t;
    this.entry = entry;
    this.part = entry.entry >> 1;
    this.shared = opts.shared ?? new Shared();
    this.#nameIds = this.shared.nameIds;
    this.pfx = opts.pfx ?? '';
    this.gpfx = opts.gpfx ?? this.pfx;
    this.inv = opts.inv ?? null;
  }

  /** 区画（と区画の中の位置）→ シーン ID */
  sid(section: number, at?: number): string {
    return `${this.pfx}s${String(section).padStart(3, '0')}${at ? `_${at}` : ''}`;
  }
  /** 尋問の区画 → 証言シーン ID */
  tid(section: number): string {
    return `${this.pfx}t${String(section).padStart(3, '0')}`;
  }
  /** 場所の番号 → 場所 ID */
  placeId(n: number): string {
    return `${this.gpfx}place${n}`;
  }
  /** 台本のフラグ（組, 番号）→ フラグ名（宣言もする）。元のゲームと同じく章の中で共通（探偵パートの始めで組 0 を戻す） */
  fname(group: number, index: number): string {
    return this.flag(`f_${group}_${index}`);
  }
  /** 探偵パートで今出ている人物の番号（30 char の人物、0 = なし） */
  personFlag(): string {
    return this.flag(`${this.gpfx}person`, 0);
  }
  /** 探偵パートで今いる場所（-1 = まだ） */
  placeFlag(): string {
    return this.flag(`${this.gpfx}place`, -1);
  }
  /** 探偵メニューへ戻るところか（場所の enter で、着いたときの処理を飛ばす） */
  returnFlag(): string {
    return this.flag(`${this.gpfx}menu_return`, false);
  }
  /** 探偵メニューへ戻るシーン（今いる場所へ） */
  menuScene(): string {
    return `${this.gpfx}menu`;
  }
  /** 探偵メニューへ戻る（28 3 → 21） */
  menuReturn(): Step[] {
    return [{ set: { [this.returnFlag()]: true } }, { goto: this.menuScene() }];
  }

  #idForName(n: number): string {
    let id = this.#nameIds.get(n);
    if (id) return id;
    const base = slug(this.t.names.find((x) => x.id === n)?.text.en ?? '');
    const taken = new Set(this.#nameIds.values());
    id = !base ? `c${n}` : taken.has(base) || RESERVED_KEYS.has(base) ? `${base}_${n}` : base;
    this.#nameIds.set(n, id);
    return id;
  }

  get court() {
    return this.t.court.parts.find((p) => p.part === this.part);
  }

  /** 名前の番号（14）→ 人物 ID（0 = null） */
  speaker(n: number): string | null {
    if (n === 0) return null;
    const id = this.#idForName(n);
    if (!this.characters.has(id)) {
      const tag = this.t.names.find((x) => x.id === n)?.text[this.entry.lang] ?? '';
      this.characters.set(id, { name: tag, blip: this.t.blipKinds[n] === 1 ? 'female' : 'male' });
    }
    return id;
  }

  /** 人物の番号（30）→ 人物 ID。名前の番号が同じなら、その名前の人物と同じ ID */
  character(k: number): string {
    const c = this.t.chars[String(k)];
    const n = c?.name_id ?? k;
    if (
      this.t.names.some((x) => x.id === n) &&
      n !== 0 &&
      (this.t.names.find((x) => x.id === n)?.text.ja ?? '') !== ''
    ) {
      return this.speaker(n)!;
    }
    const id = `c${k}`;
    if (!this.characters.has(id)) this.characters.set(id, { name: c?.name ?? '' });
    return id;
  }

  evidenceId(n: number): string {
    if (this.shared.profileRecords.has(n))
      this.stats.gap('人物ファイルを証拠品として扱った（つきつけ・小窓）', -1);
    this.evidence.add(n);
    return `e${n}`;
  }

  sound(n: number): string {
    return soundId(this.t, n);
  }

  flag(name: string, init: boolean | number = false): string {
    if (!this.flags.has(name)) this.flags.set(name, init);
    return name;
  }

  /** 区画 → シーン ID */
  scene(section: number): string {
    return this.redirect.get(section) ?? this.sid(section);
  }

  /** 区画への移動 */
  goto(section: number): Step {
    this.referenced.add(section);
    if (
      this.redirect.get(section)?.startsWith(`${this.pfx}t`) &&
      this.court?.cross_examinations.some((x) => x.statements.some((s) => s.section === section))
    ) {
      this.stats.gap('尋問の途中（文・助言）へ外から戻る（証言シーンの最初からになる）', section);
    }
    return { goto: this.scene(section) };
  }

  /** 区画 → そこへの移動（どこから・何で）。1 回目の変換で集め、2 回目で取り込む区画を決める */
  readonly refs = new Map<number, { from: number; kind: 'choice' | 'flow' }[]>();
  /** その場に取り込む区画（選択肢からだけ行く区画と、そこからだけ続く区画） */
  inline = new Set<number>();
  /** 区画をステップ列にする（scenario.ts が設定する） */
  convertSection: ((section: number) => Step[]) | null = null;
  readonly #inlining: number[] = [];

  /**
   * 表（尋問・つきつけ・探偵パート）が行き先にする区画。noCourtPresent: 探偵パートの法廷のつきつけの表
   * （0x020b44c8[パート]。探偵パートでは使わず、別の表の中身が見えているだけ）を除く
   */
  tableRefs(noCourtPresent = false): Set<number> {
    const out = new Set<number>();
    const c = this.court;
    if (c) {
      for (const r of c.present_table) out.add(r.goto);
      for (const r of c.present_requests) {
        out.add(r.wrong);
        r.correct.forEach((x) => out.add(x.goto));
      }
      for (const x of c.cross_examinations) {
        [x.section, x.after_last, x.testimony ?? -1].forEach((v) => out.add(v));
        for (const st of x.statements) {
          out.add(st.section);
          if (st.press !== null) out.add(st.press);
          st.present.forEach((p) => out.add(p.goto));
        }
      }
      for (const t of c.testimonies) {
        out.add(t.section);
        t.statements.forEach((v) => out.add(v));
      }
    }
    const walk = (x: unknown): void => {
      if (Array.isArray(x)) {
        x.forEach(walk);
        return;
      }
      if (typeof x !== 'object' || x === null) return;
      const o = x as Record<string, unknown>;
      if (typeof o.section === 'number' && isStorySection(o)) out.add(o.section);
      for (const [k, v] of Object.entries(o))
        if (!(noCourtPresent && k === 'court_present')) walk(v);
    };
    for (const g of this.group.size ? this.group.values() : [this as Context])
      if (g.inv) walk(g.inv);
    return out;
  }

  /** 共通の台本（項目 072/073）の区画をステップ列にする（scenario.ts が設定する） */
  convertCommon: ((section: number) => Step[]) | null = null;

  /** 区画への移動のステップ。取り込む区画なら、その区画のステップ列そのもの */
  jump(target: number, from: number, kind: 'choice' | 'flow' = 'flow'): Step[] {
    // 値が 0x80 未満（区画の番号が負）なら共通の台本の区画（日時・編の表示など）
    if (target < 0 && this.convertCommon) return this.convertCommon(target + 128);
    const list = this.refs.get(target) ?? [];
    list.push({ from, kind });
    this.refs.set(target, list);
    if (this.inline.has(target) && this.convertSection && !this.#inlining.includes(target)) {
      this.#inlining.push(target);
      try {
        return this.convertSection(target);
      } finally {
        this.#inlining.pop();
      }
    }
    return [this.goto(target)];
  }

  voteStand(who: string, key: string) {
    let m = this.standVotes.get(who);
    if (!m) {
      m = new Map();
      this.standVotes.set(who, m);
    }
    m.set(key, (m.get(key) ?? 0) + 1);
  }

  /** 法廷記録の名前と説明文（evidence.json の text_ja、無ければ文字認識した record_text.json） */
  recordText(rec: number): { name: string; desc: string } | null {
    return (
      this.t.evidence.find((e) => e.id === rec)?.text_ja ?? this.t.recordText?.[String(rec)] ?? null
    );
  }

  /** 法廷記録の人物ファイル → 人物（氏名が chars.json と一致すればその人物、なければ r番号） */
  profile(rec: number): string {
    const text = this.recordText(rec);
    const p = text ? parseProfileName(text.name) : { name: `人物ファイル ${rec}` };
    const bare = (x: string) => x.replace(/\s/g, '');
    const k = Object.entries(this.t.chars).find(
      ([, c]) => c.name && bare(c.name) === bare(p.name),
    )?.[0];
    const id = k !== undefined ? this.character(Number(k)) : `r${rec}`;
    const ch = this.characters.get(id) ?? { name: p.name };
    const name = k !== undefined ? this.t.chars[k]!.name! : p.name;
    ch.profile = {
      name,
      ...(p.age !== undefined ? { age: p.age } : {}),
      description: text?.desc ?? '',
      icon: `r${rec}`,
    };
    this.characters.set(id, ch);
    return id;
  }
}
