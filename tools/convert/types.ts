// 変換の入力（tools/rom/script_json.py の JSON と assets/extracted/tables/*.json）と出力（シナリオ YAML のステップ）の型。

/** 台本の 1 命令。op が 'text' なら文 */
export type Op =
  | { at: number; op: 'text'; text: string }
  | {
      at: number;
      op: number;
      name: string;
      args: number[];
      /** 「区画 + 128」を解いたもの（8/9/10/15/32/42/44/111） */
      targets?: ({ section: number; offset: number } | null)[];
      /** ラベルを解いたもの（54/120/122、53） */
      target?: { section: number | null; offset: number } | null;
    };
export type CmdOp = Extract<Op, { op: number }>;

export interface Section {
  section: number;
  ops: Op[];
}

export interface ChoiceInfo {
  textures: number[];
  text: (string | null)[];
}

export interface Entry {
  entry: number;
  lang: 'ja' | 'en';
  sections: number;
  labels: Record<string, { section: number; offset: number }>;
  body: Section[];
  choices?: Record<string, ChoiceInfo>;
}

/** court.json のパート */
export interface CourtPart {
  part: number;
  gameover_section: number;
  present_table: { section: number; item: number; goto: number; flag: number | null }[];
  testimonies: { section: number; title: string; statements: number[]; end: number }[];
  cross_examinations: {
    section: number;
    title: string;
    testimony: number;
    after_last: number;
    statements: {
      section: number;
      text: string;
      press: number | null;
      press_return: { op: string; goto?: number; label?: number } | null;
      present: { item: number; kind: string; goto: number; flag: number | null }[];
      next: number;
      /** 次の文への行き方（42 でフラグにより分かれる、44 で飛ぶ） */
      next_route?: {
        op: string;
        flag?: number;
        if_set?: number;
        else?: number;
        goto?: number;
      } | null;
    }[];
  }[];
  present_requests: {
    section: number;
    op: number;
    prompt: string;
    correct: { item: number; goto: number; flag: number | null }[];
    wrong: number;
    wrong_return: { op: string; goto?: number; label?: number } | null;
  }[];
}

export interface Tables {
  /** どのゲームの台本か（aa1 = 蘇る逆転、aa2 = 逆転裁判2、aa3 = 逆転裁判3） */
  game: import('./tables.ts').GameKey;
  names: { id: number; text: { ja: string; en: string } }[];
  chars: Record<string, { name: string | null; name_id: number }>;
  evidence: {
    id: number;
    icon?: number;
    text_ja?: { name: string; desc: string };
    start_as?: string;
  }[];
  evidenceStart: { part: number; profiles: number[]; evidence: number[] }[];
  /** SDAT の番号 → 名前（BGM008、SE019 など） */
  sounds: Map<number, string>;
  /** 名前の番号 → 文字送りの音の種類（0 標準・1 女性。sound.json の blip.name_kind） */
  blipKinds: number[];
  /** 法廷で写真の一点を指す問題（investigation.json の court_point） */
  courtPoints?: {
    id: number;
    quad_a: number[][];
    section_a: { section: number };
    quad_b: number[][];
    section_b: { section: number };
    miss: { section: number };
  }[];
  /** 法廷記録の名前と説明文（文字認識。tables/record_text.json） */
  recordText?: Record<string, { name: string; desc: string }>;
  /**
   * 2・3: 法廷記録の番号 → 英語の名前の絵の番号・名前と、話し手の名前の番号（tables/profiles.json。
   * tools/rom/record_profiles.py。null = 台詞の無い人物）
   */
  profiles?: Record<string, { name_image: number; name_en: string; name_id: number | null }>;
  /** 探偵パートの最初の場所（tables/invest_start.json） */
  investStart?: Record<string, number>;
  court: {
    common_wrong: { section: number }[];
    common_item: number;
    parts: CourtPart[];
    /** 逆転裁判3: パート → そのパートの最初の項目（日本語） */
    part_starts?: number[];
    /** 逆転裁判3: 106 k → 読む項目（日本語） */
    load_106?: Record<string, number>;
    /** 逆転裁判3: パートの種類（3 = 法廷、4 = 探偵） */
    part_kinds?: number[];
  };
  /** 「3D で詳しく調べる」の表（tables/examine3d.json、第 5 話） */
  examine3d?: import('./examine3d.ts').Examine3d;
  /** DS 版の第 5 話だけの遊び（指紋・映像・ツボ。tables/minigames.json） */
  minigames?: import('./minigames.ts').Minigames;
}

/** シナリオのステップ（YAML にそのまま書く形） */
export type Step = Record<string, unknown>;
