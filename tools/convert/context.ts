// 変換中に共有するもの（表・集計・ID の割り当て・参照の記録）。
import { RESERVED_KEYS } from '../../packages/script/src/schema.ts';
import { Stats } from './stats.ts';
import { isStorySection, parseProfileName, slug, soundId } from './tables.ts';
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
  /** 2・3: 話し手に結び付かない人物ファイルの、英語の名前の絵の番号 → 人物 ID（英語の名前から作る） */
  readonly profileIds = new Map<number, string>();
  /** 人物ファイルとして使う法廷記録の番号（つきつけの表で証拠品と区別する） */
  readonly profileRecords = new Set<number>();
  /** 章の中で法廷記録に入りうる番号（空なら調べない。単体の変換・テスト用） */
  readonly chapterRecords = new Set<number>();
  /** サイコ・ロック（79）を使ったか（章に psycheLock の keys を書く） */
  lockKeys = false;
  /** 章の中で人物ファイルとして使う法廷記録の番号（1 回目の変換で集めたもの。2・3 の見当違いの人物ファイル用） */
  chapterProfiles: number[] = [];
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
  /** 21 player_turn の代わりのステップ（遊びの結果の区画から遊びに戻るとき。minigames.ts） */
  readonly turnSteps = new Map<number, Step[]>();
  /** 区画のほかに出すシーン（遊びの画面など。minigames.ts） */
  readonly extraScenes = new Map<string, Step[]>();
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
    // ゲームの無い表（テストの小さな表など）は蘇る逆転
    this.t = t.game ? t : { ...t, game: 'aa1' };
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
    const taken = new Set([...this.#nameIds.values(), ...this.shared.profileIds.values()]);
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

  /**
   * 話題の項目 id を使うか（talk_項目）のフラグ。初期値は表の active（どこで最初に読んでも同じにする。
   * 以前は着いたときの条件で先に読むと false になり、逆転裁判3 の第 5 話で春美のロックの話題 §111 を飛ばして
   * 解除の後の話題 §117 が出ていた）
   */
  talkFlag(id: number): string {
    const talk = (this.inv?.talk ?? []) as { id: number; active?: boolean }[];
    return this.flag(`${this.gpfx}talk_${id}`, !!talk.find((t) => t.id === id)?.active);
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
  /** 区画への参照（scene = シーンとして残す行き先。サイコ・ロックの start / quit / gaugeOut など） */
  readonly refs = new Map<number, { from: number; kind: 'choice' | 'flow' | 'scene' }[]>();
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
        for (const x of r.correct) out.add(x.goto);
      }
      for (const x of c.cross_examinations) {
        for (const v of [x.section, x.after_last, x.testimony ?? -1]) out.add(v);
        for (const st of x.statements) {
          out.add(st.section);
          if (st.press !== null) out.add(st.press);
          for (const p of st.present) out.add(p.goto);
        }
      }
      for (const t of c.testimonies) {
        out.add(t.section);
        for (const v of t.statements) out.add(v);
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
  jump(target: number, from: number, kind: 'choice' | 'flow' | 'scene' = 'flow'): Step[] {
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

  /**
   * 法廷記録の人物ファイル → 人物。蘇る逆転は氏名が chars.json と一致すればその人物、なければ r番号。
   * 2・3 は tables/profiles.json（英語の名前と名札の対応）で話し手の人物にまとめ、台詞の無い人物は英語の名前から ID を作る
   */
  profile(rec: number): string {
    const text = this.recordText(rec);
    const p = text ? parseProfileName(text.name) : { name: `人物ファイル ${rec}` };
    let id: string;
    let name = p.name;
    const link = this.t.profiles?.[String(rec)];
    if (link) {
      id = this.#profileOf(rec, link);
    } else {
      const bare = (x: string) => x.replace(/\s/g, '');
      const k = Object.entries(this.t.chars).find(
        ([, c]) => c.name && bare(c.name) === bare(p.name),
      )?.[0];
      id = k !== undefined ? this.character(Number(k)) : `r${rec}`;
      if (k !== undefined) name = this.t.chars[k]!.name!;
    }
    const ch = this.characters.get(id) ?? { name: p.name };
    ch.profile = {
      name,
      ...(p.age !== undefined ? { age: p.age } : {}),
      description: text?.desc ?? '',
      icon: `r${rec}`,
    };
    this.characters.set(id, ch);
    return id;
  }

  /** 2・3 の人物ファイルの人物 ID（話し手の名前の番号があればその人物、なければ英語の名前の ID） */
  #profileOf(rec: number, link: NonNullable<Tables['profiles']>[string]): string {
    const n = link.name_id;
    const tag = this.t.names.find((x) => x.id === n)?.text;
    if (n !== null && tag && tag.ja !== '') {
      // 同じ名札の名前の番号がいくつもあれば（ヤハリの 15 と 29 など）、章の中で名札の ID を先に取った番号にまとめる
      const same = this.t.names.filter((x) => x.text.ja === tag.ja && x.text.en === tag.en);
      const base = slug(tag.en);
      const owner = same.find((x) => this.#nameIds.get(x.id) === base);
      return this.speaker(owner?.id ?? n)!;
    }
    const ids = this.shared.profileIds;
    let id = ids.get(link.name_image);
    if (id) return id;
    const base = slug(link.name_en);
    const taken = new Set([...this.#nameIds.values(), ...ids.values()]);
    id = !base ? `r${rec}` : taken.has(base) || RESERVED_KEYS.has(base) ? `${base}_r${rec}` : base;
    ids.set(link.name_image, id);
    return id;
  }
}
