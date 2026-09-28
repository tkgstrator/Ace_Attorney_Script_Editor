// シナリオをコンパイルした後の中間表現（IR）と、ゲームの状態・表示単位（Beat）の型。
// core は YAML を知らない。YAML → IR の変換は @gyakusai/script が担当する。

export type Value = boolean | number | string;

export type BinaryOp = '&&' | '||' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '+' | '-';

export type Expr =
  | { t: 'lit'; v: Value }
  | { t: 'var'; name: string }
  | { t: 'call'; fn: 'has' | 'visited' | 'seen'; arg: string }
  | { t: 'not'; e: Expr }
  | { t: 'bin'; op: BinaryOp; l: Expr; r: Expr };

export type TextColor = 'white' | 'blue' | 'green' | 'orange' | 'red';
export type ShoutKind = 'objection' | 'hold' | 'takethat';
export type FlashColor = 'white' | 'red';
export type BlipKind = 'male' | 'female' | 'typewriter' | 'none';
/** 人物の動き（元のゲームの動きの番号など）。文字送りの間は talk、止まっている間は idle */
export interface Pose {
  talk: number | string;
  idle: number | string;
}
export type FadeColor = 'black' | 'white';

/** 尋問の途中に差し込んだブロックを抜けて、証言に戻るときの戻り先 */
export type ResumeTarget = 'next' | 'stay' | 'first' | 'crossIntro' | 'afterReading';

export type Instr =
  /** auto: 文を出し終えたら、ボタンを待たずに次へ進む */
  | { op: 'say'; speaker: string | null; text: string; color: TextColor; auto?: boolean }
  | { op: 'shout'; kind: ShoutKind; by: string | null }
  | { op: 'banner'; text: string }
  | { op: 'card'; text: string }
  | { op: 'showEvidence'; evidence: string | null; side?: 'left' | 'right' }
  /** 分岐先のどれかへ乱数で飛ぶ（元のゲームの、尋問で見当違いの証拠品をつきつけたときの反応など） */
  | { op: 'random'; to: number[] }
  /** 画面の色の変え方（grayscale: 白黒の回想） */
  | { op: 'palette'; palette: 'normal' | 'grayscale' }
  | { op: 'choice'; options: { text: string; when?: Expr; to: number }[] }
  /**
   * 絵の上の範囲を選ぶ（元のゲームの DS 版だけの遊び: 指紋・映像など）。images が空なら今の背景（調べると同じ座標）。
   * options は選べるもの（範囲・範囲の外・やめる）の並び。選ぶと to へ。範囲の外（miss）のブロックの後は、もう一度選ぶ
   */
  | { op: 'pick'; prompt: string; images: string[]; options: PickOption[] }
  /** options: 証拠品 ID → 正解の pc。profiles: 人物 ID → 正解の pc（あれば人物ファイルもつきつけられる） */
  | {
      op: 'demand';
      prompt: string;
      options: Record<string, number>;
      profiles?: Record<string, number>;
      wrong: number;
      speaker?: string;
      /** サイコ・ロックの「やめる」の行き先（あれば、つきつけずにやめられる） */
      giveUp?: number;
    }
  | { op: 'set'; flag: string; value: Value }
  | { op: 'add'; flag: string; amount: number }
  | { op: 'give'; evidence: string }
  | { op: 'take'; evidence: string }
  /** 法廷記録の人物ファイルに加える・外す */
  | { op: 'giveProfile'; character: string }
  | { op: 'takeProfile'; character: string }
  /** 法廷の視点の流し（0〜5）。行き先の人物と動きに替わる */
  | { op: 'pan'; type: number; character: string | null; pose: Pose | null }
  /** 重ね絵を出す・消す（元のゲームの 47 anim など） */
  | { op: 'overlay'; id: string; on: boolean }
  /** 背景の表示位置を毎フレーム動かす（null で止める） */
  | { op: 'scroll'; scroll: { x: number; y: number } | null }
  /** 文字の枠を出す・隠す */
  | { op: 'textbox'; show: boolean }
  /** 画面の部品の表示（法廷記録を開けるか、ライフを出すか。null は既定に戻す） */
  | { op: 'ui'; record?: boolean; life?: boolean | null }
  /** BGM を一時停止する・再開する */
  | { op: 'bgmPause'; pause: boolean; frames: number }
  | { op: 'jump'; to: number }
  | { op: 'jumpUnless'; cond: Expr; to: number }
  | { op: 'goto'; scene: string }
  /** risk: 減る量は lifeRisk で予告した量（元のゲームのゲージの点滅した部分） */
  | { op: 'penalty'; amount: number; risk?: boolean }
  /** ライフを回復する（full は最大まで）。最大は超えない */
  | { op: 'heal'; amount: number | 'full' }
  /** 見当違いのときに減るライフの量を予告する（ゲージの点滅。0 で消す） */
  | { op: 'lifeRisk'; amount: number }
  /** サイコ・ロックの錠の表示（数 = 出す、true = 出し直す、false = 隠す、break = 1 つ壊す、unlock = 解除） */
  | { op: 'locks'; show: number | boolean | 'break' | 'unlock' }
  /** frames があれば、人物をだんだん出す（消すときはだんだん消す） */
  | { op: 'show'; character: string | null; pose: Pose | null; frames?: number }
  | { op: 'location'; location: string | null }
  | { op: 'resume'; to: ResumeTarget }
  /** 時間の単位はすべてフレーム（1/60 秒）。元のゲームの台本と同じ */
  | { op: 'bgm'; id: string | null; frames: number }
  | { op: 'se'; id: string }
  | { op: 'shake'; frames: number; strength: number }
  | { op: 'flash'; color: FlashColor; frames: number }
  /** wait: false なら止まらずに次へ進む（元のゲームのフェードは止まらない） */
  | { op: 'fade'; dir: 'out' | 'in'; color: FadeColor; frames: number; wait: boolean }
  | { op: 'wait'; frames: number }
  /** 探索編の場所へ行く（来たときのブロックがあれば実行してから探偵メニュー） */
  | { op: 'investigate'; place: string }
  /** 探索編の行動のブロックの終わり。今の場所の探偵メニューに戻る */
  | { op: 'menu' }
  /** 証拠品を詳しく調べるブロックの終わり。調べ始めた場面（台詞・証言・選択肢・つきつけの要求・探偵メニュー）に戻る */
  | { op: 'inspectEnd' }
  | { op: 'end' }
  | { op: 'gameover' };

/** 範囲 [x, y, 幅, 高さ]（背景・絵の座標） */
export type Area = [number, number, number, number];

/**
 * pick の選べるもの。kind: area（範囲。image は複数の絵のどれの上か、無ければどの絵でも）・miss（範囲の外）・quit（やめる）。
 * when は範囲だけ（偽なら選べない）
 */
export interface PickOption {
  kind: 'area' | 'miss' | 'quit';
  to: number;
  when?: Expr;
  area?: Area;
  image?: number;
  /** エディタ・報告での表示名 */
  name?: string;
  /** 人物を選ぶ（nominate）ときの、この範囲に顔を出す人物 ID（表示側は絵の代わりに顔を並べる） */
  person?: string;
}

export interface Statement {
  id: string;
  text: string;
  when?: Expr;
  /** ゆさぶったときに実行するブロックの先頭 pc */
  press?: number;
  /** 証拠品 ID → つきつけたときに実行するブロックの先頭 pc */
  present: Record<string, number>;
  /** 人物 ID → その人物ファイルをつきつけたときのブロック（あれば、この証言では人物ファイルもつきつけられる） */
  presentProfile?: Record<string, number>;
  /** 尋問でこの証言を出す前に実行する、止まらない命令のブロック（人物の動き・背景など） */
  before?: number;
}

export interface DialogueScene {
  kind: 'dialogue';
  id: string;
  program: Instr[];
}

export interface TestimonyScene {
  kind: 'testimony';
  id: string;
  title: string;
  witness: string;
  program: Instr[];
  statements: Statement[];
  /** 証言を聞き終えてから尋問に入る前に実行するブロック */
  after?: number;
  /** 証言を最初に聞く場面の流れ（あれば、証言の文の代わりにこれを見せる） */
  reading?: number;
  /** 尋問で最後の証言を過ぎたときに実行するブロック */
  loop?: number;
  /** 見当違いの証拠品をつきつけたときのブロック */
  wrong: number;
}

/** 探索編の場所。program には、来たとき・調べる・話す・つきつけるの各ブロックが並ぶ */
export interface PlaceScene {
  kind: 'place';
  id: string;
  name: string;
  /** 背景のキー */
  background: string;
  /** その場所にいる人物の候補。when が真の最初の人物 */
  person: { id: string; when?: Expr }[];
  program: Instr[];
  /** 来たときのブロック */
  enter?: number;
  /**
   * 「調べる」の間に背景をスクロールできるか（背景が画面より大きいときだけ効く）。無ければできる。
   * 元のゲームでは横長の背景で、下の画面のボタン（L ボタン）を押すと左端と右端の間を動く
   */
  examineScroll?: Expr;
  examine: {
    id: string;
    name?: string;
    /** 範囲 [x, y, 幅, 高さ]（背景の座標。横長の背景なら 0〜512 など） */
    area: [number, number, number, number];
    when?: Expr;
    pc: number;
  }[];
  examineDefault: number;
  /** locked: 真ならサイコ・ロックの印を出す（表示だけ） */
  talk: { id: string; topic: string; when?: Expr; locked?: Expr; pc: number }[];
  present: Record<string, number>;
  /** 人物 ID → 人物ファイルをつきつけたときのブロック（無い人物は presentWrong） */
  presentProfile?: Record<string, number>;
  presentWrong: number;
  move: { to: string; when?: Expr }[];
}

export type Scene = DialogueScene | TestimonyScene | PlaceScene;

/** 章の中の編（探索編・裁判編）。エディタや表示のためのまとまりで、実行には使わない */
export interface PartDef {
  id: string;
  kind: 'investigation' | 'trial';
  title: string;
  scenes: string[];
}

export interface CharacterDef {
  name: string;
  /** 法廷での立ち位置（defense / prosecution / witness / judge など）。背景の選択に使う */
  stand?: string;
  /** 文字送りの音の種類（既定 male） */
  blip?: BlipKind;
  /** 法廷記録の人物ファイルに載せる内容。ない人物は載せない。name は人物ファイルでの表示名（名前欄の name と別にできる） */
  profile?: { name?: string; age?: number; description: string; icon?: string };
}

export interface EvidenceDef {
  name: string;
  description: string;
  /** アイコンの絵のキー（省略すると証拠品 ID） */
  icon?: string;
  /** 「詳しく調べる」で実行するシーン（コンパイラが examine から作る。調べる場所の選択肢から始まる） */
  inspect?: string;
}

/** 証拠品を詳しく調べ始めた場面（調べ終えたら、ここに戻る） */
export interface InspectFrame {
  scene: string;
  pc: number;
  mode: 'run' | 'investigate' | 'testimony';
  /** 証言・尋問の途中なら、その段階と証言の番号 */
  phase?: TestimonyPhase;
  statement?: number;
  /** 調べ始めたときの表示（戻るときに表示を戻す。探偵メニューからなら無し） */
  stage?: GameState['stage'];
  vars?: Record<string, string>;
}

export interface CompiledScenario {
  id: string;
  title: string;
  /** プレイヤーが操作する弁護士。ゆさぶる・つきつけるときの掛け声の主 */
  player: string | null;
  maxLife: number;
  characters: Record<string, CharacterDef>;
  evidence: Record<string, EvidenceDef>;
  flags: Record<string, Value>;
  startScene: string;
  startEvidence: string[];
  /** 最初に人物ファイルに載っている人物（null なら profile のある全員） */
  startProfiles: string[] | null;
  gameoverScene: string | null;
  /** ライフが尽きたときにだけ入るシーン（サイコ・ロックの挑戦中にライフが尽きたとき。整合性チェックでは調べない） */
  lifeOutScenes?: string[];
  /** 句読点のあとで自動的に少し待つか（元のゲームにはない。既定 false） */
  autoPause: boolean;
  /** 台詞の話し手を自動で表示するか（元のゲームは false 相当） */
  autoShow: boolean;
  scenes: Record<string, Scene>;
  parts: PartDef[];
}

export type TestimonyPhase = 'intro' | 'reading' | 'crossIntro' | 'cross';

/** セーブデータにそのまま使える、JSON 化可能なゲームの状態 */
export interface GameState {
  scene: string;
  pc: number;
  /** run: 命令を実行中 / testimony: 証言・尋問の画面 / investigate: 探索編の探偵メニュー（scene が場所） */
  mode: 'run' | 'testimony' | 'investigate';
  phase: TestimonyPhase;
  statement: number;
  flags: Record<string, Value>;
  evidence: string[];
  life: number;
  visited: string[];
  /** 調べた・話した印（場所の examine・talk の ID） */
  seen: string[];
  /** 人物ファイルに載っている人物（載せた順）。null は古いセーブデータの「profile のある全員」（読み込むときに一覧にする） */
  profiles: string[] | null;
  /** evidence: 画面左上の小窓に見せている証拠品 / bgm: 流している BGM / fade: 画面を覆っている色（フェードアウト中） */
  stage: {
    character: string | null;
    location: string | null;
    evidence: string | null;
    bgm: string | null;
    fade: FadeColor | null;
    /** show で指定した人物の動き（なければ表示側の既定の立ち絵） */
    pose: Pose | null;
    /** 法廷の視点の流し（背景を変えるまで、流し終えた絵のまま）。from は流す前の人物 */
    pan: { type: number; from: { character: string | null; pose: Pose | null } } | null;
    /** 証拠品の小窓を右に出すか */
    evidenceRight: boolean;
    /** 画面の色の変え方（白黒の回想など） */
    palette: 'normal' | 'grayscale';
    /** 出している重ね絵 */
    overlays: string[];
    /** 背景のスクロールの速さ（ドット/フレーム）。背景を変えると止まる */
    scroll: { x: number; y: number } | null;
    /** 文字の枠（null は台詞のときだけ出す、既定の動き） */
    textbox: boolean | null;
    bgmPaused: boolean;
    /** 法廷記録を開けなくする / ライフの表示（null は既定） */
    recordLocked: boolean;
    lifeGauge: boolean | null;
    /** 見当違いのときに減るライフの予告（0 なら無し） */
    lifeRisk: number;
    /** サイコ・ロックの錠の表示（null は出していない） */
    locks: { total: number; left: number; hidden: boolean } | null;
  };
  /** 文中の {evidence} などに差し込む一時的な値 */
  vars: Record<string, string>;
  /** 証拠品を詳しく調べている間、調べ始めた場面（別のシーンへ移ると消える） */
  inspectFrom?: InspectFrame | null;
}

/** エディタの「ここから再生」で遊び始める位置（restoreEngine の at） */
export type PlayTarget =
  /** 命令の位置から。証言のシーンのブロック（ゆさぶり・つきつけなど）なら、どの証言の中か */
  | { kind: 'pc'; scene: string; pc: number; statement?: number }
  /** 尋問の、その証言から */
  | { kind: 'statement'; scene: string; statement: number }
  /** シーンの頭から（場所なら、来たときのブロックか探偵メニューから） */
  | { kind: 'scene'; scene: string };

export interface Snapshot {
  version: 1;
  scenario: string;
  state: GameState;
}

export * from './types-beat.ts';
