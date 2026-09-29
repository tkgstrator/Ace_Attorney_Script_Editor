# 6（任意）. サイコ・ロック

人物が隠しごとをしている話題に錠がかかり、勾玉をつきつけて証拠品で錠を 1 つずつ壊す遊び（逆転裁判2・3 の型）。
YAML の書き方（**制約**）は [遊びの書き方](../../scenario-games.md)。

**決めること:** 相手が隠していること（錠を全部外すと認めること）・錠の数・錠ごとの問いと証拠品・外した後に話すこと。
**点検:** 錠ごとの証拠品が、ロックに挑める時点で手に入るか。外した後の本音が、法廷の前に真相を言い切っていないか。

## 目安（傾向）

- 1 話に 2〜3 つ。錠は 2〜3 が多く、1 つだけのものや、最後の山場の 4〜6 のものもある（[構成の集計](../numbers/structure.md)）。
- 錠 1 つにつき「主人公の問い 2〜4 ページ → 減る量の予告 → つきつけの要求 → 相手が認める 2〜4 ページ」。
- ライフは 80 のゲージ。予告（`lifeRisk`）は 16 が 73%。解除で 40 回復する。

## 流れ

1. **ロックが現れる:** 隠しごとの話題を選ぶ → 相手が口を閉ざす → 錠が現れる → 主人公の心の声
   「（サイコ・ロック‥‥！）」（6 話）。話題には `locked` で印を付け、ロックを `psycheLock` で有効にする。
2. **挑む（制約）:** その場所で勾玉（`keys`）をつきつけると、`start` のシーンへ。
   **傾向:** カードでロックの題（「～○○～」）を出し、専用の曲に替えて、ライフのゲージを出してから問い始める。
3. **錠を壊す:** 錠の数だけ「問い → `lifeRisk` → `demand`（`giveUp: true`）→ 正解で `breakLock`」をくり返す。
   正解の後は、相手の動揺（衝撃の音 + 揺れ）→ 錠が壊れる。見当違いは、相手が突っぱねて `penalty: risk`。
4. **最後の錠:** 最後の錠の前で BGM を止め、決定的な証拠品で壊す。解除でライフが回復し、相手が本音を話す（5〜15 ページ）。
   **推奨:** 本音は一部だけにして、残りの嘘は法廷で崩す（例では、入ったことは認めるが「すぐ出た」と言い張る）。
5. **話題を切り替える:** 解除のブロックでフラグを立て、印の付いた話題を、`when` で本音を話す話題に替える
   （[遊びの書き方](../../scenario-games.md#ロックが先へ進むのを止める)）。

- **やめる（`quit`）:** ロックは残ったまま探偵メニューへ。公式は、冷静に考え直すよう促す案内をカードで出す。
- **ライフが尽きたとき（`gaugeOut`）:** 公式は、続けると心が壊れると告げる案内をカードで出し、ライフを 1 に戻して探偵メニューへ
  （ゲームオーバーにはならない）。
- **制約:** ロックが有効なまま `end` に着く道があると、整合性チェックがエラーにする。法廷へ移る条件に、解除のフラグを入れる
  （[法廷記録と通知・捜査の終わり](progress.md#法廷へのつなぎ)）。

**実例:**

> 成歩堂「（サイコ・ロック‥‥!）」（逆転裁判2 第3話）

## 例

倉田の「ライトのこと」に、錠 2 つのロックをかける。1 つ目は《入館記録》、2 つ目は《ライト》で壊す。

```yaml
souko:
  talk:
    - id: lamp_locked
      topic: ライトのこと
      when: seen(night) and not unlocked
      locked: not unlocked
      then:
        - naruse: "倉田さん。[wait 10]あの夜、\nライトはどこに？"
        - kurata: "[speed 4]‥‥その話は、[wait 12]\nしとうないですな。"
        - psycheLock: lock_kurata
          locks: 2
          person: kurata
          place: souko
          start: lock_start
          quit: lock_quit
          gaugeOut: lock_out
        - se: shock
        - flash: true
        - naruse: "（サイコ・ロック‥‥！）"
    - id: lamp_open
      topic: ライトのこと
      when: unlocked
      then:
        - kurata: "[speed 4]あの晩、[wait 12]持ち主に\n呼ばれて入ったんです。"
        - kurata: "ライトも、[wait 8]あの晩に落とした。\nだが、わしはすぐ出ましたぞ。"
        - naruse: "（すぐ出た‥‥[wait 10]\n　本当だろうか）"
```

```yaml
lock_start:
  - card: ～夜警のライト～
  - bgm: psyche
  - ui: { life: true }
  - naruse: "倉田さん。[wait 10]もう、\n隠しごとはなしですよ。"
  - kurata: "[speed 4]話すことなんぞ、[wait 10]\nありゃしませんよ。"
  - naruse: "あなたは11時より前に、[wait 8]\n倉庫へ来ていたのでは？"
  - lifeRisk: 16
  - demand: "11時より前に、倉田さんが\n倉庫に入った証拠は？"
    giveUp: true
    present:
      log:
        - naruse: "10時半に、[wait 8][color red]夜警用[color white]の\nカードで扉が開いている！"
        - se: shock
        - shake: 30
          strength: 1
        - kurata: "[speed 2]ぐ、[wait 6]ぐぬ‥‥！"
        - breakLock: true
    wrong:
      - kurata: "そんなもん、[wait 8]\n何の関係もありませんな。"
      - penalty: risk
  - kurata: "入ったからって、[wait 10]\n何だと言うんです。"
  - bgm: null
    frames: 30
  - lifeRisk: 16
  - demand: "倉田さんが、倉庫の中で\n何かをなくした証拠は？"
    giveUp: true
    present:
      lamp:
        - naruse: "あなたのライトは、[wait 10]\n倉庫の[color red]棚の下[color white]にあった！"
        - se: shock
        - flash: true
        - shake: 30
          strength: 2
        - breakLock: true
        - set: { unlocked: true }
        - kurata: "[speed 8]‥‥‥‥"
        - kurata: "[speed 5]‥‥ええ、[wait 12]\nわしのライトですよ。"
    wrong:
      - kurata: "そんな物で、[wait 8]\nわしを疑うんですかな？"
      - penalty: risk
  - investigate: souko
lock_quit:
  - naruse: "（[speed 4]今は、[wait 10]\n　まだ崩せそうにない）"
  - investigate: souko
lock_out:
  - naruse: "（[speed 4]これ以上は、[wait 10]\n　無理だ‥‥）"
  - investigate: souko
```

- **制約:** `demand` の正解の後は次のステップへ進む。探偵パートのつきつけの要求では「くらえ！」は出ない。
- **推奨:** 錠を 1 つ壊すたびに、相手の言い逃れを 1〜2 ページはさんで、次の問いへ。
