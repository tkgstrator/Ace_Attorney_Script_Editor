// シナリオ YAML の構造の定義のうち、シナリオ全体（人物・証拠品・シーン・証言・探索編の場所・編）の形。
// 全体の入口は schema.ts。

import { z } from 'zod';
import { Cond, FlagValue, Id } from './schema-base.ts';

export function makeScenario<S extends z.ZodType>(steps: S) {
  const Statement = z.strictObject({
    id: Id.optional().describe('証言の ID。エディタや参照のために付けておくのを推奨'),
    text: z.string(),
    when: Cond.optional().describe('この条件が真のときだけ証言に現れる'),
    press: steps.optional().describe('ゆさぶったとき'),
    before: steps
      .optional()
      .describe('尋問でこの証言を出す前に実行する、止まらない命令（人物の動き・背景・音など）'),
    present: z.record(Id, steps).optional().describe('証拠品 ID → つきつけたとき'),
  });
  const Testimony = z.strictObject({
    testimony: z.string().describe('証言のタイトル'),
    witness: Id,
    statements: z.array(Statement).min(1),
    reading: steps
      .optional()
      .describe(
        '証言を最初に聞く場面（書けば、証言の文の代わりにこれを見せる。元のゲームでは尋問の文と別）',
      ),
    after: steps.optional().describe('証言を聞き終えてから尋問に入るまで'),
    loop: steps.optional().describe('尋問で最後の証言を過ぎたとき'),
    wrong: steps
      .optional()
      .describe('見当違いの証拠品をつきつけたとき（defaults.wrongPresent を上書き）'),
  });
  /** 探索編の「場所」。行動（調べる・話す・つきつける）が終わると、その場所の探偵メニューに戻る */
  const Place = z.strictObject({
    name: z.string().describe('「移動する」の一覧などに出す場所の名前'),
    background: Id.optional().describe('背景のキー。省略すると場所の ID'),
    examineScroll: z
      .union([z.boolean(), Cond])
      .optional()
      .describe(
        '「調べる」の間に背景をスクロールできるか（true / false か条件式。背景が画面より大きいときだけ効く。省略するとできる）',
      ),
    person: z
      .union([Id, z.array(z.strictObject({ id: Id, when: Cond.optional() }))])
      .optional()
      .describe('その場所にいる人物。一覧なら、when が真の最初の人物'),
    enter: steps
      .optional()
      .describe(
        'この場所に来たときに毎回実行する。初回だけにするには if: not visited(場所ID)（探偵メニューに着いた時点で訪問済みになる）',
      ),
    examine: z
      .array(
        z.strictObject({
          id: Id.optional().describe(
            '調べた印（seen() で使う）の ID。省略すると 場所ID_examine番号',
          ),
          name: z.string().optional().describe('エディタでの表示名'),
          area: z
            .tuple([z.number(), z.number(), z.number(), z.number()])
            .describe(
              '背景の上の範囲 [x, y, 幅, 高さ]（ドット。横長の背景なら 0〜512 など、背景の座標）',
            ),
          when: Cond.optional(),
          // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
          then: steps,
        }),
      )
      .optional()
      .describe('「調べる」で選べる範囲。重なっていれば先に書いたもの'),
    examineDefault: steps.optional().describe('何もない所を調べたとき'),
    talk: z
      .array(
        z.strictObject({
          id: Id.optional().describe('話した印（seen() で使う）の ID。省略すると 場所ID_talk番号'),
          topic: z.string().describe('話題の名前'),
          when: Cond.optional().describe('この条件が真のときだけ話題に出る'),
          locked: Cond.optional().describe('この条件が真のとき、話題にサイコ・ロックの印を出す'),
          // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
          then: steps,
        }),
      )
      .optional()
      .describe('「話す」の話題（その場所にいる人物と）'),
    present: z
      .record(Id, steps)
      .optional()
      .describe('証拠品 ID か人物 ID（人物ファイル）→ その場所の人物につきつけたとき'),
    presentWrong: steps.optional().describe('ほかの証拠品・人物ファイルをつきつけたとき'),
    move: z
      .array(z.union([Id, z.strictObject({ to: Id, when: Cond.optional() })]))
      .optional()
      .describe('「移動する」の行き先'),
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
    defaults: z
      .strictObject({
        penalty: z
          .number()
          .positive()
          .optional()
          .describe('penalty: true のときに減るライフ（既定 2）'),
        wrongPresent: steps
          .optional()
          .describe('見当違いの証拠品をつきつけたときの既定の反応。{evidence} に証拠品名が入る'),
        autoShow: z
          .boolean()
          .optional()
          .describe(
            '台詞の話し手を自動で表示する（既定 true）。false なら表示は show だけで変わる（元のゲームと同じ）',
          ),
        autoPause: z
          .boolean()
          .optional()
          .describe('句読点のあとで自動的に少し待つ（元のゲームにはない。既定 false）'),
      })
      .optional(),
    characters: z.record(
      Id,
      z.strictObject({
        name: z.string(),
        stand: Id.optional(),
        blip: z
          .enum(['male', 'female', 'typewriter', 'none'])
          .optional()
          .describe(
            '文字送りの音（既定 male。元のゲームは話し手の名前ごとに標準・女性・タイプライターのどれか）',
          ),
        profile: z
          .strictObject({
            name: z
              .string()
              .optional()
              .describe('人物ファイルでの表示名（漢字の氏名など）。省略すると name'),
            age: z.number().int().nonnegative().optional(),
            description: z.string(),
            icon: Id.optional().describe(
              '人物ファイルの顔の絵のキー（省略すると人物 ID。元のゲームから変換したときは r<記録の番号>）',
            ),
          })
          .optional()
          .describe('法廷記録の人物ファイルに載せる内容'),
      }),
    ),
    evidence: z.record(
      Id,
      z.strictObject({
        name: z.string(),
        description: z.string(),
        icon: Id.optional().describe(
          'アイコンの絵のキー（省略すると証拠品 ID。元のゲームから変換したときは r<記録の番号>）',
        ),
        examine: z
          .array(
            z.strictObject({
              spot: z.string().describe('調べる場所の名前（選択肢に出す）'),
              when: Cond.optional().describe('この条件が真のときだけ選べる'),
              // biome-ignore lint/suspicious/noThenProperty: シナリオの形（then はステップ列）
              then: steps.describe(
                '調べたとき。終わると調べ始めた場面（台詞の途中ならその台詞）に戻る。then の中で goto・investigate したら戻らずに進む',
              ),
            }),
          )
          .min(1)
          .optional()
          .describe(
            '「詳しく調べる」（DS 版の第 5 話の、証拠品を 3D で調べる遊び）。法廷記録を開ける場面ならいつでも（台詞・証言・選択肢・つきつけの要求・探偵メニュー）、法廷記録から調べる場所を選ぶ',
          ),
      }),
    ),
    flags: z.record(Id, FlagValue).optional().describe('フラグ名 → 初期値。型は初期値から決まる'),
    start: z.strictObject({
      scene: Id,
      evidence: z.array(Id).optional(),
      profiles: z
        .array(Id)
        .optional()
        .describe('最初に人物ファイルに載っている人物（省略すると profile のある全員）'),
    }),
    gameover: Id.optional().describe('ライフが尽きたときに移るシーン'),
    psycheLock: z
      .strictObject({
        keys: z
          .array(Id)
          .min(1)
          .describe('探偵パートで人物につきつけるとロックに挑む証拠品（勾玉）'),
        heal: z
          .number()
          .int()
          .nonnegative()
          .optional()
          .describe('ロックを解除したときに回復するライフ（既定 0）'),
      })
      .optional()
      .describe('サイコ・ロック（逆転裁判2・3）。ロックそのものはステップ psycheLock で決める'),
    scenes: z
      .record(Id, z.union([steps, Testimony]))
      .optional()
      .describe('編に分けないときのシーン（裁判編として扱う）'),
    parts: z
      .array(Part)
      .optional()
      .describe('章を探索編・裁判編に分けたもの。シーン・場所の ID は章の中で重ならないこと'),
  });
}
