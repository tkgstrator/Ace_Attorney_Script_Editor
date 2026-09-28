// シナリオ YAML の構造の定義のうち、ステップ（各コマンド）の形。
// 全体の入口は schema.ts。

import { z } from 'zod';
import { Cond, FlagValue, Id, ShoutKind, TextColor } from './schema-base.ts';

/**
 * 各コマンドの形を作る。`steps` にはネストしたステップ列の型を渡す。
 * - 検証時は z.array(z.unknown()) を渡し、中身はコンパイラが1つずつ再帰的に検証する
 *   （union の検証だと、どのコマンドの間違いかが分からないエラーになるため）
 * - JSON Schema の生成時は、再帰的な Step の配列を渡す
 */
export function makeCommands<S extends z.ZodType>(steps: S) {
  return {
    say: z
      .strictObject({
        say: Id.nullable().describe('話す人物の ID。null ならナレーション'),
        text: z.string(),
        color: TextColor.optional(),
        auto: z.boolean().optional().describe('出し終えたら、ボタンを待たずに次へ進む'),
      })
      .describe('台詞（省略形: `- 人物ID: 台詞`）'),
    narrate: z.strictObject({ narrate: z.string() }).describe('ナレーション（名前欄なし）'),
    set: z.strictObject({ set: z.record(Id, FlagValue) }).describe('フラグに値を入れる'),
    add: z.strictObject({ add: z.record(Id, z.number()) }).describe('数値フラグに加算する'),
    give: z.strictObject({ give: z.union([Id, z.array(Id)]) }).describe('証拠品を法廷記録に加える'),
    giveProfile: z
      .strictObject({ giveProfile: z.union([Id, z.array(Id)]) })
      .describe('人物を法廷記録の人物ファイルに加える'),
    takeProfile: z
      .strictObject({ takeProfile: z.union([Id, z.array(Id)]) })
      .describe('人物を人物ファイルから外す'),
    take: z.strictObject({ take: z.union([Id, z.array(Id)]) }).describe('証拠品を法廷記録から外す'),
    // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
    if: z.strictObject({ if: Cond, then: steps, else: steps.optional() }).describe('条件分岐'),
    choice: z
      .strictObject({
        choice: z
          .array(
            // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
            z.strictObject({ text: z.string(), when: Cond.optional(), then: steps.optional() }),
          )
          .min(1),
      })
      .describe('選択肢。選んだ then を実行した後、次のステップへ進む'),
    demand: z
      .strictObject({
        demand: z.string().describe('つきつけを求める文'),
        present: z
          .record(Id, steps)
          .describe('証拠品 ID か人物 ID（人物ファイル）→ 正解のときのステップ'),
        wrong: steps.optional().describe('不正解のとき。実行後にもう一度つきつけを求める'),
        profiles: z
          .boolean()
          .optional()
          .describe(
            '人物ファイルもつきつけられるか（既定: present に人物 ID があれば true、なければ false）。人物ファイルの見当違いは wrong',
          ),
        by: Id.optional().describe('問いかける人物（名前欄に出す）'),
        giveUp: z
          .literal(true)
          .optional()
          .describe(
            'サイコ・ロックの挑戦中の「やめる」を出す（選ぶと、挑んでいるロックの quit のシーンへ）',
          ),
      })
      .describe('証拠品のつきつけを求める'),
    goto: z.strictObject({ goto: Id }).describe('別のシーンへ移る'),
    penalty: z
      .strictObject({
        penalty: z.union([z.literal(true), z.literal('risk'), z.number().positive()]),
      })
      .describe('ライフを減らす。true なら defaults.penalty、risk なら lifeRisk で予告した量'),
    heal: z
      .strictObject({ heal: z.union([z.literal(true), z.number().positive()]) })
      .describe('ライフを回復する（true は最大まで。最大は超えない）'),
    lifeRisk: z
      .strictObject({ lifeRisk: z.number().int().nonnegative() })
      .describe('見当違いのときに減るライフの量を、ゲージの点滅で予告する（0 で消す）'),
    psycheLock: z
      .strictObject({
        psycheLock: Id.describe('ロックの ID（元のゲームの枠 lock0〜lock3 など）'),
        locks: z.number().int().positive().optional().describe('錠の数'),
        person: Id.optional().describe('ロックのかかった人物'),
        place: Id.optional().describe('その人物がいる場所（そこで勾玉をつきつけると挑む）'),
        start: Id.optional().describe('挑んだときのシーン'),
        quit: Id.optional().describe('「やめる」を選んだときのシーン'),
        gaugeOut: Id.optional().describe('挑戦中にライフが尽きたときのシーン（ライフは 1 に戻る）'),
      })
      .describe('サイコ・ロックを決める・変える（書いた欄だけ変わる。書くと有効になる）'),
    breakLock: z
      .strictObject({ breakLock: z.union([z.literal(true), z.literal('hold')]) })
      .describe('錠を 1 つ壊す。最後の錠なら解除する（hold なら解除しない）'),
    unlock: z
      .strictObject({ unlock: z.literal(true) })
      .describe('挑んでいるロックをその場で解除する（回復し、ロックを無効にする）'),
    quitLock: z
      .strictObject({ quitLock: z.literal(true) })
      .describe('挑んでいるロックの挑戦をやめて quit のシーンへ（挑んでいなければ何もしない）'),
    shout: z
      .strictObject({ shout: ShoutKind, by: Id.optional() })
      .describe('「異議あり！」などの吹き出し'),
    banner: z.strictObject({ banner: z.string() }).describe('画面中央の帯テキスト'),
    card: z
      .strictObject({ card: z.string() })
      .describe('日時・場所の表示。背景を暗くし、テキストウィンドウに中央寄せで出す'),
    showEvidence: z
      .strictObject({
        showEvidence: Id.nullable(),
        side: z.enum(['left', 'right']).optional().describe('小窓を出す側（既定 left）'),
      })
      .describe('画面の上の小窓に証拠品を見せる。null で消す（シーンが変わっても消える）'),
    random: z
      .strictObject({ random: z.array(steps).min(1) })
      .describe('ステップ列のどれかを乱数で選んで実行する'),
    palette: z
      .strictObject({ palette: z.enum(['normal', 'grayscale']) })
      .describe('画面の色の変え方（grayscale: 白黒の回想。normal で戻す）'),
    show: z
      .strictObject({
        show: Id.nullable(),
        talk: z
          .union([z.number().int().nonnegative(), Id])
          .optional()
          .describe('話しているときの動き（元のゲームの動きの番号など）'),
        idle: z
          .union([z.number().int().nonnegative(), Id])
          .optional()
          .describe('黙っているときの動き（省略すると talk と同じ）'),
        frames: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('だんだん出す・消す長さ（フレーム。元のゲームの人物の半透明のフェード）'),
      })
      .describe(
        '表示する人物を切り替える。talk / idle で動きを指定すると、文字送りの間は talk、止まっている間は idle',
      ),
    location: z
      .strictObject({ location: Id.nullable() })
      .describe('場所（背景）を変える。null で法廷に戻る'),
    bgm: z
      .strictObject({
        bgm: Id.nullable().describe('BGM の ID。null で止める'),
        frames: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('前の曲を消す・次の曲を始めるフェードの長さ（フレーム、既定 0）'),
      })
      .describe('BGM を流す（繰り返し）。セーブデータに残り、ロードすると流れ直す'),
    se: z.strictObject({ se: Id.describe('効果音の ID') }).describe('効果音を鳴らす'),
    shake: z
      .strictObject({
        shake: z
          .union([z.literal(true), z.number().int().positive()])
          .describe('true か長さ（フレーム、既定 30）'),
        strength: z.number().int().min(0).max(2).optional().describe('強さ 0〜2（既定 0）'),
      })
      .describe('画面を揺らす'),
    flash: z
      .strictObject({
        flash: z.union([z.literal(true), z.enum(['white', 'red'])]).describe('true は white'),
        frames: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('長さ（フレーム、既定 3。元のゲームの白いフラッシュ）'),
      })
      .describe('画面を一瞬光らせる'),
    fade: z
      .strictObject({
        fade: z.enum(['out', 'in']).describe('out: 画面を覆う（暗転） / in: 覆いを外す'),
        color: z.enum(['black', 'white']).optional().describe('覆う色（既定 black）'),
        frames: z.number().int().nonnegative().optional().describe('長さ（フレーム、既定 30）'),
        nowait: z
          .boolean()
          .optional()
          .describe(
            'true なら終わるのを待たずに次へ進む（元のゲームのフェードはこちら。既定 false）',
          ),
      })
      .describe('画面のフェード。out の後は in まで覆ったまま（台詞は覆いの上に出る）'),
    wait: z
      .strictObject({ wait: z.number().int().positive().describe('フレーム（1/60 秒）') })
      .describe('待つ'),
    bgmPause: z
      .strictObject({
        bgmPause: z.boolean().describe('true で一時停止、false で続きから再開'),
        frames: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('フェードの長さ（フレーム、既定 0）'),
      })
      .describe('BGM を一時停止する・再開する'),
    pan: z
      .strictObject({
        pan: z
          .number()
          .int()
          .min(0)
          .max(5)
          .describe(
            '0 弁護側→証言台 / 1 証言台→弁護側 / 2 弁護側→検察側 / 3 検察側→弁護側 / 4 証言台→検察側 / 5 検察側→証言台',
          ),
        to: Id.nullable().describe('行き先の人物'),
        talk: z.union([z.number().int().nonnegative(), Id]).optional(),
        idle: z.union([z.number().int().nonnegative(), Id]).optional(),
      })
      .describe(
        '法廷の視点の流し（元のゲームの 26。31 フレームかけて全景を流す。止まらない。背景を変えるまで流し終えた絵のまま）',
      ),
    overlay: z
      .strictObject({
        overlay: z
          .union([z.number().int().nonnegative(), Id])
          .describe('重ね絵の ID（元のゲームの 47 anim の番号など）'),
        off: z.boolean().optional().describe('true で消す'),
      })
      .describe('背景・人物・机の上に重ね絵を出す・消す（止まらない）'),
    scroll: z
      .strictObject({
        scroll: z
          .strictObject({
            x: z
              .number()
              .int()
              .optional()
              .describe('横の速さ（ドット/フレーム。+ で右へ、- で左へ）'),
            y: z.number().int().optional().describe('縦の速さ（+ で下へ、- で上へ）'),
          })
          .nullable(),
      })
      .describe(
        '背景の表示位置を毎フレーム動かす（画面より大きい背景だけ。端で止まる。背景を変えると止まる。null で止める）',
      ),
    textbox: z
      .strictObject({ textbox: z.boolean() })
      .describe('文字の枠を出す・隠す（書かなければ台詞のときだけ出る）'),
    ui: z
      .strictObject({
        ui: z.strictObject({
          record: z.boolean().optional().describe('法廷記録を開けるか'),
          life: z.boolean().nullable().optional().describe('ライフを出すか（null で既定に戻す）'),
          locks: z
            .union([z.number().int().positive(), z.boolean()])
            .optional()
            .describe('サイコ・ロックの錠を出す（数）・出し直す（true）・隠す（false）'),
        }),
      })
      .describe('画面の部品の表示'),
    resume: z
      .strictObject({ resume: z.enum(['next', 'stay', 'first']) })
      .describe(
        '尋問のゆさぶり・つきつけのブロックから証言へ戻る（next: 次の証言 / stay: 同じ証言 / first: 最初の証言）',
      ),
    native: z
      .strictObject({
        native: z.string().describe('元のゲームの命令の名前'),
        args: z.array(z.number()).optional(),
      })
      .describe(
        '元のゲームの命令で、まだ対応していないもの（元の台本から変換したときに残す。今は何もしない）',
      ),
    investigate: z
      .strictObject({ investigate: Id })
      .describe('探索編の場所へ行き、探偵メニュー（調べる・移動する・話す・つきつける）を出す'),
    end: z.strictObject({ end: z.literal(true) }).describe('ゲームクリア'),
    gameover: z.strictObject({ gameover: z.literal(true) }).describe('ゲームオーバー'),
  };
}

export type CommandName = keyof ReturnType<typeof makeCommands>;
