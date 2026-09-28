// 変換中に共有するもの（表・集計・ID の割り当て・参照の記録）。
import { characterId, profileId, speakerId } from './people.ts';
import { Stats } from './stats.ts';
import { isStorySection, soundId } from './tables.ts';
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
  /** 名前の番号 → 人物 ID（対応表から。表が無ければ使った順に決め、英語の名札が重なれば 2 つ目から _番号） */
  readonly nameIds = new Map<number, string>();
  /** 2・3: 話し手に結び付かない人物ファイルの、英語の名前の絵の番号 → 人物 ID（表が無いときに英語の名前から作る） */
  readonly profileIds = new Map<number, string>();
  /** 人物 ID → 元の ROM の番号（name:名前の番号 / char:人物の番号 / profile:法廷記録の番号。対応表の手入れ用） */
  readonly idSources = new Map<string, Set<string>>();
  /** 人物 ID の対応表に無い番号の警告 */
  readonly idWarnings = new Set<string>();
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

  get court() {
    return this.t.court.parts.find((p) => p.part === this.part);
  }

  /** 名前の番号（14）→ 人物 ID（0 = null）。people.ts */
  speaker(n: number): string | null {
    return speakerId(this, n);
  }

  /** 人物の番号（30）→ 人物 ID。people.ts */
  character(k: number): string {
    return characterId(this, k);
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

  /** 法廷記録の人物ファイル → 人物 ID（人物の profile も書く）。people.ts */
  profile(rec: number): string {
    return profileId(this, rec);
  }
}
