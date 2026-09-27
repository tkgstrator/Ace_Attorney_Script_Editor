// シナリオ YAML の構造の定義。ここが「唯一の正」で、
// コンパイラの検証・TypeScript の型・エディタ補完用 JSON Schema のすべてをここから作る。

import { z } from 'zod';

export const Id = z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/, 'ID は英字・数字・_ で、先頭は英字か _ にしてください');
export const FlagValue = z.union([z.boolean(), z.number(), z.string()]);
export const TextColor = z.enum(['white', 'blue', 'green', 'orange', 'red']);
export const ShoutKind = z.enum(['objection', 'hold', 'takethat']);
/** 条件式（例: `has(repair) and not bell_pressed`） */
export const Cond = z.string().min(1).describe('条件式。例: has(repair) and not pressed_s2');

/**
 * 各コマンドの形を作る。`steps` にはネストしたステップ列の型を渡す。
 * - 検証時は z.array(z.unknown()) を渡し、中身はコンパイラが1つずつ再帰的に検証する
 *   （union の検証だと、どのコマンドの間違いかが分からないエラーになるため）
 * - JSON Schema の生成時は、再帰的な Step の配列を渡す
 */
export function makeCommands<S extends z.ZodType>(steps: S) {
  return {
    say: z.strictObject({
      say: Id.nullable().describe('話す人物の ID。null ならナレーション'),
      text: z.string(),
      color: TextColor.optional(),
      auto: z.boolean().optional().describe('出し終えたら、ボタンを待たずに次へ進む'),
    }).describe('台詞（省略形: `- 人物ID: 台詞`）'),
    narrate: z.strictObject({ narrate: z.string() }).describe('ナレーション（名前欄なし）'),
    set: z.strictObject({ set: z.record(Id, FlagValue) }).describe('フラグに値を入れる'),
    add: z.strictObject({ add: z.record(Id, z.number()) }).describe('数値フラグに加算する'),
    give: z.strictObject({ give: z.union([Id, z.array(Id)]) }).describe('証拠品を法廷記録に加える'),
    giveProfile: z.strictObject({ giveProfile: z.union([Id, z.array(Id)]) }).describe('人物を法廷記録の人物ファイルに加える'),
    takeProfile: z.strictObject({ takeProfile: z.union([Id, z.array(Id)]) }).describe('人物を人物ファイルから外す'),
    take: z.strictObject({ take: z.union([Id, z.array(Id)]) }).describe('証拠品を法廷記録から外す'),
    if: z.strictObject({ if: Cond, then: steps, else: steps.optional() }).describe('条件分岐'),
    choice: z.strictObject({
      choice: z.array(z.strictObject({ text: z.string(), when: Cond.optional(), then: steps.optional() })).min(1),
    }).describe('選択肢。選んだ then を実行した後、次のステップへ進む'),
    demand: z.strictObject({
      demand: z.string().describe('つきつけを求める文'),
      present: z.record(Id, steps).describe('証拠品 ID か人物 ID（人物ファイル）→ 正解のときのステップ'),
      wrong: steps.optional().describe('不正解のとき。実行後にもう一度つきつけを求める'),
      profiles: z.boolean().optional()
        .describe('人物ファイルもつきつけられるか（既定: present に人物 ID があれば true、なければ false）。人物ファイルの見当違いは wrong'),
      by: Id.optional().describe('問いかける人物（名前欄に出す）'),
    }).describe('証拠品のつきつけを求める'),
    goto: z.strictObject({ goto: Id }).describe('別のシーンへ移る'),
    penalty: z.strictObject({ penalty: z.union([z.literal(true), z.number().positive()]) }).describe('ライフを減らす。true なら defaults.penalty'),
    shout: z.strictObject({ shout: ShoutKind, by: Id.optional() }).describe('「異議あり！」などの吹き出し'),
    banner: z.strictObject({ banner: z.string() }).describe('画面中央の帯テキスト'),
    card: z.strictObject({ card: z.string() }).describe('日時・場所の表示。背景を暗くし、テキストウィンドウに中央寄せで出す'),
    showEvidence: z.strictObject({
      showEvidence: Id.nullable(),
      side: z.enum(['left', 'right']).optional().describe('小窓を出す側（既定 left）'),
    }).describe('画面の上の小窓に証拠品を見せる。null で消す（シーンが変わっても消える）'),
    random: z.strictObject({ random: z.array(steps).min(1) }).describe('ステップ列のどれかを乱数で選んで実行する'),
    palette: z.strictObject({ palette: z.enum(['normal', 'grayscale']) }).describe('画面の色の変え方（grayscale: 白黒の回想。normal で戻す）'),
    show: z.strictObject({
      show: Id.nullable(),
      talk: z.union([z.number().int().nonnegative(), Id]).optional().describe('話しているときの動き（元のゲームの動きの番号など）'),
      idle: z.union([z.number().int().nonnegative(), Id]).optional().describe('黙っているときの動き（省略すると talk と同じ）'),
      frames: z.number().int().positive().optional().describe('だんだん出す・消す長さ（フレーム。元のゲームの人物の半透明のフェード）'),
    }).describe('表示する人物を切り替える。talk / idle で動きを指定すると、文字送りの間は talk、止まっている間は idle'),
    location: z.strictObject({ location: Id.nullable() }).describe('場所（背景）を変える。null で法廷に戻る'),
    bgm: z.strictObject({
      bgm: Id.nullable().describe('BGM の ID。null で止める'),
      frames: z.number().int().nonnegative().optional().describe('前の曲を消す・次の曲を始めるフェードの長さ（フレーム、既定 0）'),
    }).describe('BGM を流す（繰り返し）。セーブデータに残り、ロードすると流れ直す'),
    se: z.strictObject({ se: Id.describe('効果音の ID') }).describe('効果音を鳴らす'),
    shake: z.strictObject({
      shake: z.union([z.literal(true), z.number().int().positive()]).describe('true か長さ（フレーム、既定 30）'),
      strength: z.number().int().min(0).max(2).optional().describe('強さ 0〜2（既定 0）'),
    }).describe('画面を揺らす'),
    flash: z.strictObject({
      flash: z.union([z.literal(true), z.enum(['white', 'red'])]).describe('true は white'),
      frames: z.number().int().positive().optional().describe('長さ（フレーム、既定 3。元のゲームの白いフラッシュ）'),
    }).describe('画面を一瞬光らせる'),
    fade: z.strictObject({
      fade: z.enum(['out', 'in']).describe('out: 画面を覆う（暗転） / in: 覆いを外す'),
      color: z.enum(['black', 'white']).optional().describe('覆う色（既定 black）'),
      frames: z.number().int().nonnegative().optional().describe('長さ（フレーム、既定 30）'),
      nowait: z.boolean().optional().describe('true なら終わるのを待たずに次へ進む（元のゲームのフェードはこちら。既定 false）'),
    }).describe('画面のフェード。out の後は in まで覆ったまま（台詞は覆いの上に出る）'),
    wait: z.strictObject({ wait: z.number().int().positive().describe('フレーム（1/60 秒）') }).describe('待つ'),
    bgmPause: z.strictObject({
      bgmPause: z.boolean().describe('true で一時停止、false で続きから再開'),
      frames: z.number().int().nonnegative().optional().describe('フェードの長さ（フレーム、既定 0）'),
    }).describe('BGM を一時停止する・再開する'),
    pan: z.strictObject({
      pan: z.number().int().min(0).max(5).describe('0 弁護側→証言台 / 1 証言台→弁護側 / 2 弁護側→検察側 / 3 検察側→弁護側 / 4 証言台→検察側 / 5 検察側→証言台'),
      to: Id.nullable().describe('行き先の人物'),
      talk: z.union([z.number().int().nonnegative(), Id]).optional(),
      idle: z.union([z.number().int().nonnegative(), Id]).optional(),
    }).describe('法廷の視点の流し（元のゲームの 26。31 フレームかけて全景を流す。止まらない。背景を変えるまで流し終えた絵のまま）'),
    overlay: z.strictObject({
      overlay: z.union([z.number().int().nonnegative(), Id]).describe('重ね絵の ID（元のゲームの 47 anim の番号など）'),
      off: z.boolean().optional().describe('true で消す'),
    }).describe('背景・人物・机の上に重ね絵を出す・消す（止まらない）'),
    scroll: z.strictObject({
      scroll: z.strictObject({
        x: z.number().int().optional().describe('横の速さ（ドット/フレーム。+ で右へ、- で左へ）'),
        y: z.number().int().optional().describe('縦の速さ（+ で下へ、- で上へ）'),
      }).nullable(),
    }).describe('背景の表示位置を毎フレーム動かす（画面より大きい背景だけ。端で止まる。背景を変えると止まる。null で止める）'),
    textbox: z.strictObject({ textbox: z.boolean() }).describe('文字の枠を出す・隠す（書かなければ台詞のときだけ出る）'),
    ui: z.strictObject({
      ui: z.strictObject({
        record: z.boolean().optional().describe('法廷記録を開けるか'),
        life: z.boolean().nullable().optional().describe('ライフを出すか（null で既定に戻す）'),
      }),
    }).describe('画面の部品の表示'),
    resume: z.strictObject({ resume: z.enum(['next', 'stay', 'first']) })
      .describe('尋問のゆさぶり・つきつけのブロックから証言へ戻る（next: 次の証言 / stay: 同じ証言 / first: 最初の証言）'),
    native: z.strictObject({
      native: z.string().describe('元のゲームの命令の名前'),
      args: z.array(z.number()).optional(),
    }).describe('元のゲームの命令で、まだ対応していないもの（元の台本から変換したときに残す。今は何もしない）'),
    investigate: z.strictObject({ investigate: Id }).describe('探索編の場所へ行き、探偵メニュー（調べる・移動する・話す・つきつける）を出す'),
    end: z.strictObject({ end: z.literal(true) }).describe('ゲームクリア'),
    gameover: z.strictObject({ gameover: z.literal(true) }).describe('ゲームオーバー'),
  };
}

export type CommandName = keyof ReturnType<typeof makeCommands>;

/** 人物 ID と衝突してはいけない予約語（ステップ省略形の判定に使うため） */
export const RESERVED_KEYS = new Set<string>([
  ...Object.keys(makeCommands(z.array(z.unknown()))),
  'text', 'color', 'then', 'else', 'when', 'by', 'present', 'wrong', 'seen', 'frames', 'strength', 'talk', 'idle', 'args', 'auto', 'nowait', 'off', 'side', 'profiles',
]);

export function makeScenario<S extends z.ZodType>(steps: S) {
  const Statement = z.strictObject({
    id: Id.optional().describe('証言の ID。エディタや参照のために付けておくのを推奨'),
    text: z.string(),
    when: Cond.optional().describe('この条件が真のときだけ証言に現れる'),
    press: steps.optional().describe('ゆさぶったとき'),
    before: steps.optional().describe('尋問でこの証言を出す前に実行する、止まらない命令（人物の動き・背景・音など）'),
    present: z.record(Id, steps).optional().describe('証拠品 ID → つきつけたとき'),
  });
  const Testimony = z.strictObject({
    testimony: z.string().describe('証言のタイトル'),
    witness: Id,
    statements: z.array(Statement).min(1),
    reading: steps.optional().describe('証言を最初に聞く場面（書けば、証言の文の代わりにこれを見せる。元のゲームでは尋問の文と別）'),
    after: steps.optional().describe('証言を聞き終えてから尋問に入るまで'),
    loop: steps.optional().describe('尋問で最後の証言を過ぎたとき'),
    wrong: steps.optional().describe('見当違いの証拠品をつきつけたとき（defaults.wrongPresent を上書き）'),
  });
  /** 探索編の「場所」。行動（調べる・話す・つきつける）が終わると、その場所の探偵メニューに戻る */
  const Place = z.strictObject({
    name: z.string().describe('「移動する」の一覧などに出す場所の名前'),
    background: Id.optional().describe('背景のキー。省略すると場所の ID'),
    person: z.union([Id, z.array(z.strictObject({ id: Id, when: Cond.optional() }))]).optional()
      .describe('その場所にいる人物。一覧なら、when が真の最初の人物'),
    enter: steps.optional().describe('この場所に来たときに毎回実行する。初回だけにするには if: not visited(場所ID)（探偵メニューに着いた時点で訪問済みになる）'),
    examine: z.array(z.strictObject({
      id: Id.optional().describe('調べた印（seen() で使う）の ID。省略すると 場所ID_examine番号'),
      name: z.string().optional().describe('エディタでの表示名'),
      area: z.tuple([z.number(), z.number(), z.number(), z.number()]).describe('画面（256×192 ドット）上の範囲 [x, y, 幅, 高さ]'),
      when: Cond.optional(),
      then: steps,
    })).optional().describe('「調べる」で選べる範囲。重なっていれば先に書いたもの'),
    examineDefault: steps.optional().describe('何もない所を調べたとき'),
    talk: z.array(z.strictObject({
      id: Id.optional().describe('話した印（seen() で使う）の ID。省略すると 場所ID_talk番号'),
      topic: z.string().describe('話題の名前'),
      when: Cond.optional().describe('この条件が真のときだけ話題に出る'),
      then: steps,
    })).optional().describe('「話す」の話題（その場所にいる人物と）'),
    present: z.record(Id, steps).optional().describe('証拠品 ID か人物 ID（人物ファイル）→ その場所の人物につきつけたとき'),
    presentWrong: steps.optional().describe('ほかの証拠品・人物ファイルをつきつけたとき'),
    move: z.array(z.union([Id, z.strictObject({ to: Id, when: Cond.optional() })])).optional().describe('「移動する」の行き先'),
  });
  const Part = z.strictObject({
    id: Id,
    kind: z.enum(['investigation', 'trial']).describe('investigation: 探索編 / trial: 裁判編'),
    title: z.string().describe('編の名前（例: 探偵パート 1 日目）'),
    scenes: z.record(Id, z.union([steps, Testimony])).optional(),
    places: z.record(Id, Place).optional().describe('探索編の場所'),
  });
  return z.strictObject({
    id: Id,
    title: z.string(),
    player: Id.optional().describe('プレイヤーが操作する弁護士の人物 ID'),
    life: z.number().int().positive().optional().describe('ライフの最大値（既定 10）'),
    defaults: z.strictObject({
      penalty: z.number().positive().optional().describe('penalty: true のときに減るライフ（既定 2）'),
      wrongPresent: steps.optional().describe('見当違いの証拠品をつきつけたときの既定の反応。{evidence} に証拠品名が入る'),
      autoShow: z.boolean().optional().describe('台詞の話し手を自動で表示する（既定 true）。false なら表示は show だけで変わる（元のゲームと同じ）'),
      autoPause: z.boolean().optional().describe('句読点のあとで自動的に少し待つ（元のゲームにはない。既定 false）'),
    }).optional(),
    characters: z.record(Id, z.strictObject({
      name: z.string(),
      stand: Id.optional(),
      blip: z.enum(['male', 'female', 'typewriter', 'none']).optional()
        .describe('文字送りの音（既定 male。元のゲームは話し手の名前ごとに標準・女性・タイプライターのどれか）'),
      profile: z.strictObject({
        name: z.string().optional().describe('人物ファイルでの表示名（漢字の氏名など）。省略すると name'),
        age: z.number().int().nonnegative().optional(),
        description: z.string(),
        icon: Id.optional().describe('人物ファイルの顔の絵のキー（省略すると人物 ID。元のゲームから変換したときは r<記録の番号>）'),
      }).optional().describe('法廷記録の人物ファイルに載せる内容'),
    })),
    evidence: z.record(Id, z.strictObject({
      name: z.string(), description: z.string(),
      icon: Id.optional().describe('アイコンの絵のキー（省略すると証拠品 ID。元のゲームから変換したときは r<記録の番号>）'),
      examine: z.array(z.strictObject({
        spot: z.string().describe('調べる場所の名前（選択肢に出す）'),
        when: Cond.optional().describe('この条件が真のときだけ選べる'),
        then: steps.describe('調べたとき。終わると調べ始めた場面（台詞の途中ならその台詞）に戻る。then の中で goto・investigate したら戻らずに進む'),
      })).min(1).optional()
        .describe('「詳しく調べる」（DS 版の第 5 話の、証拠品を 3D で調べる遊び）。法廷記録を開ける場面ならいつでも（台詞・証言・選択肢・つきつけの要求・探偵メニュー）、法廷記録から調べる場所を選ぶ'),
    })),
    flags: z.record(Id, FlagValue).optional().describe('フラグ名 → 初期値。型は初期値から決まる'),
    start: z.strictObject({
      scene: Id, evidence: z.array(Id).optional(),
      profiles: z.array(Id).optional().describe('最初に人物ファイルに載っている人物（省略すると profile のある全員）'),
    }),
    gameover: Id.optional().describe('ライフが尽きたときに移るシーン'),
    scenes: z.record(Id, z.union([steps, Testimony])).optional().describe('編に分けないときのシーン（裁判編として扱う）'),
    parts: z.array(Part).optional().describe('章を探索編・裁判編に分けたもの。シーン・場所の ID は章の中で重ならないこと'),
  });
}

/** 検証用（ネストしたステップはコンパイラが個別に検証する） */
const Shallow = z.array(z.unknown());
export const commandSchemas = makeCommands(Shallow);
export const scenarioSchema = makeScenario(Shallow);
export type RawScenario = z.infer<typeof scenarioSchema>;
export type RawPart = NonNullable<RawScenario['parts']>[number];
export type RawPlace = NonNullable<RawPart['places']>[string];

/** エディタ補完用の、ネストまで含んだ完全なスキーマ */
export function fullScenarioSchema() {
  const Step: z.ZodType = z.lazy(() =>
    z.union([
      ...Object.values(makeCommands(Steps)),
      z.record(Id, z.string()).describe('台詞の省略形: `人物ID: 台詞`'),
    ] as unknown as [z.ZodType, z.ZodType, ...z.ZodType[]]),
  );
  const Steps = z.array(Step);
  return makeScenario(Steps);
}
