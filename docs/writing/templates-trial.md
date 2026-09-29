# YAML のひな形（法廷パート）

[演出の使い方](effects.md)・[文字の使い方](typography.md)・[書き方の型（構成）](structure.md) の型を、このエンジンの YAML で書いたもの。
台詞はすべて自作の例。人物はサンプル [サンプル事件「時計塔の鐘」](../../apps/player/cases/clocktower.yaml) に合わせ、助手を 1 人足している。

- ここの断片をつないだ章は `bun run check --check-font` を通ることを確かめてある（DS 版のフォントに無い「塔」「嘘」「瀬」は
  使っていない。字の言い換えは [カタカナの表記](../katakana.md)）。
- 音の ID のうち `gavel`・`discover`・`damage`・`trial`・`investigation`・`verdict` はプレイヤーに仮の音がある。
  `shock`（衝撃）・`testimony`（証言）・`cross`（尋問）・`pursuit`（追いつめる曲）・`plaza` は役割で付けた名前で、
  音を用意するまで鳴らない。
- 立ち絵の動きの名前（`shocked` など）は [立ち絵の仕様](../../tools/sprites/SPEC.md) のポーズ（通常・動揺・本性 など）に
  合わせて付ける。絵が無い動きは通常の絵で出る。

## 人物と既定の反応

```yaml
player: naruse
life: 5
defaults:
  penalty: 1
  # 見当違いのつきつけ: 主人公の言い訳 1 → 裁判長の叱責 2 → ペナルティ → 心の声（公式の型）
  wrongPresent:
    - naruse: "え、ええと‥‥[wait 10]これが、[wait 6]\nその‥‥関係あるかと‥‥"
    - judge: "弁護人。[wait 12]\n法廷は、あてずっぽうの場ではありません。"
    - judge: "[speed 4]‥‥ペナルティを科します。"
    - penalty: true
    - naruse: "（[speed 4]うう‥‥。[wait 12]\n　証言をもう一度よく聞こう）"
characters:
  naruse: { name: ナルセ, stand: defense }
  sayo: { name: サヨ, blip: female, profile: { name: 早川 小夜, age: 19, description: 助手。 } }
  himuro: { name: ヒムロ, stand: prosecution }
  torii: { name: トリイ, stand: witness }
  judge: { name: サイバンチョ, stand: judge }
```

`autoPause` は書かない（公式は句読点の後の間を手で置く）。間は `[wait N]` で入れる。

## 開廷

公式の法廷編の始まりは「フェードイン → 日時・場所 → （木槌）→ BGM → 裁判長」。

```yaml
opening:
  - card: "9月27日 午前10時\n地方裁判所 第2法廷"
  - fade: in
  - se: gavel            # 木槌は短い揺れ（10 フレーム・強さ 1）と組み、2 回続ける
  - shake: 10
    strength: 1
  - wait: 12
  - se: gavel
  - shake: 10
    strength: 1
  - wait: 18
  - bgm: trial
  - judge: "これより、[wait 10]時田 進の\n審理を開廷します。"
  - naruse: 弁護側、準備完了しています。
  - himuro: "検察側も、[wait 8]とうに。"
  - goto: t1
```

## 証言と尋問

- 証言の文は 2 行をほぼ使い切る長さ（公式の中央 28 字）。題は 10 字前後。
- `reading`（最初に聞く所）では `[wait]` 入りの台詞で読ませ、尋問の `text` は同じ文から wait を除いたものにする。
- 正解の文は 1 つ。ゆさぶりで現れる隠れた文（`when`）を 0〜1 つ。ゆさぶり 1 つは 3〜10 ページ。
- 証言の後（`after`）は裁判長が受けて、主人公の心の声で構える。一巡（`loop`）では助手がヒントを言う。
- 証拠品の前提: 《修理票》は「事件の3日前から、鐘を鳴らす機械を外して修理していた」記録、《置時計》は被害者の部屋の
  「毎正時に鐘の音で時を打つ」時計。矛盾は、ゆさぶりで出る「時計台の鐘が鳴った」で初めて成り立つ
  （元の文は「鐘の音が聞こえた」だけなので、《修理票》とは両立する）。

```yaml
t1:
  testimony: 事件の夜に見たこと
  witness: torii
  reading:
    - bgm: testimony
    - torii: "あの夜、[wait 10]私は広場の\nベンチで休んでおりました。"
    - torii: "9時ちょうどに、[wait 8]\n鐘の音が聞こえたんです。"
    - torii: "顔を上げると、[wait 10]男が\n走り去るのが見えましたな。"
  statements:
    - id: bench
      text: "あの夜、私は広場の\nベンチで休んでおりました。"
      before:
        - bgm: cross
      press:
        - naruse: "なぜ、[wait 8]その時間に\n広場にいたんですか？"
        - torii: "散歩ですよ。[wait 10]\n医者に歩けと言われましてな。"
        - naruse: "（ありそうな話だ‥‥）"
    - id: bell
      text: "9時ちょうどに、\n鐘の音が聞こえたんです。"
      press:                         # ゆさぶりで隠れた文を引き出す型
        - naruse: "どこの鐘か、[wait 8]\n分かりますか？"
        - torii: "そりゃあ、[wait 8]\n広場の時計台ですとも。"
        - if: not asked_bell
          then:
            - naruse: "何回鳴ったか、[wait 8]\n覚えていますか？"
            - torii: "9回。[wait 12]\nこの耳で数えましたとも。"
            - judge: "今の話を、[wait 8]\n証言に加えてください。"
            - set: { asked_bell: true }
    - id: bell_count
      when: asked_bell
      text: "時計台の鐘が9回。\nこの耳で数えました。"
      press:
        - naruse: 間違いありませんか？
        - torii: "しつこいですな。[wait 10]\n時計台が9回ですとも。"
      present:
        repair:
          - goto: contra1            # 正しいつきつけ。「異議あり！」はエンジンが出す
    - id: runner
      text: "顔を上げると、男が\n走り去るのが見えましたな。"
      press:
        - naruse: "その男の顔は\n見ましたか？"
        - torii: "暗くて、[wait 10]顔までは‥‥。"
  after:
    - judge: "では弁護人、[wait 8]\n尋問をお願いします。"
    - naruse: "（どこかに[color red]矛盾[color blue]があるはずだ。\n　[wait 8]法廷記録とくらべよう）"
  loop:
    - sayo: "ナルセさん、[wait 10]鐘の話、[wait 6]\nもっと聞いてみたら？"
```

## 正しいつきつけの後（決定的な証拠の直後）

公式の定番の並び（[演出の使い方](effects.md#正しいつきつけの後)）:
BGM を止める → 主人公が矛盾を指摘（証拠品の小窓 + 赤字）→ 小窓を消す → パンで証人へ → 衝撃（音 + フラッシュ + 揺れ 2）→
証人の動揺 → 検事の割り込み → 裁判長 → 追いつめる曲。

```yaml
contra1:
  - bgmPause: true                    # まず無音にする（蘇る逆転で 3 分の 2）
  - naruse: "証人は、[wait 10]時計台の鐘が\n[color red]9回[color white]鳴ったと言いました。"
  - showEvidence: repair              # 小窓は 1〜3 ページだけ見せる
  - se: discover                      # 気づきの音 + フラッシュ（揺らさない）
  - flash: true
  - naruse: "しかし、[wait 8]時計台の鐘は\n[color red]機械を外して[color white]修理中だった！"
  - showEvidence: null
  - pan: 0                            # 弁護側 → 証言台
    to: torii
  - wait: 31
  - show: torii
    talk: shocked
    idle: shocked
  - se: shock                         # 決定的な衝撃: 音 + フラッシュ + 揺れ 2
  - flash: true
  - shake: 30
    strength: 2
  - torii: "[speed 2]な、[wait 8]なんですとォ！"
  - bgmPause: false
    frames: 60
  - himuro: "[speed 4]‥‥フン。[wait 12][speed 3]証人の\n聞き違い、[wait 6]だろう。"
  - shout: objection                  # 相手の割り込みだけは YAML に書く
    by: himuro
  - himuro: "鐘など、[wait 8]\n事件の本筋ではない。"
  - judge: "証人。[wait 10]\n今の点について、証言を。"
  - bgm: pursuit                      # 追いつめる曲に替える（逆転裁判2 で 44%）
  - goto: q1
```

軽い矛盾（話を一歩進めるだけのつきつけ）では、揺れを 1 にし、BGM は止めない。

## 選択肢とつきつけの要求

- 選択肢は 2 択（7 割）か 3 択。1 つの文は 7 字前後、14 字まで。
- 誤りは「主人公の言い分 → 裁判長 2 ページ → ペナルティ」で、選び直させる。
- つきつけの要求の問いは、証拠品の性質を言ってヒントにする。正解の後は正しいつきつけと同じ並び（パンは少なめ）。

```yaml
q1:
  - choice:
      - text: 何も聞いていない
        then:
          - naruse: "証人は、[wait 8]鐘の音など\n聞いていないんです！"
          - judge: "しかし、[wait 8]証人の態度は\nウソには見えませんが‥‥。"
          - judge: "[speed 4]‥‥ペナルティです。"
          - penalty: true
          - goto: q1
      - text: 時計台でない鐘を聞いた
        then:
          - naruse: "証人が聞いたのは、[wait 8]\n時計台ではない鐘だった！"
  - demand: "時計台ではない鐘を\n示す証拠品は？"
    present:
      clock:
        - showEvidence: clock
        - naruse: "被害者の部屋の、[wait 8]\nこの[color red]置時計[color white]です！"
        - showEvidence: null
        - se: shock
        - flash: true
        - shake: 30
          strength: 2
        - torii: "[speed 2]う‥‥[wait 10]うおおおッ！"
        - goto: ending
    wrong:
      - judge: "それが、[wait 8]\n鐘を鳴らすのですか？"
      - penalty: true
```

## 判決

```yaml
ending:
  - bgm: null
  - banner: 無罪
  - se: gavel
  - bgm: verdict
  - end: true
```

## ほかの小さな型

| 場面 | 並び |
|---|---|
| 傍聴席がざわつく → 静粛に | `se: murmur` → `wait: 60`〜`120` → `se: gavel` + `shake: 10, strength: 1`（2〜3 回）→ 裁判長「静粛に」 |
| 新しい証拠品の提出 | 検事の台詞 → `give: 証拠品` → 名前なしの青字の知らせ（`narrate` か `say: null` + `color: blue`） |
| 証人が崩れ落ちる | `bgmPause: true` → 揺れ 2 + フラッシュ + 衝撃の音 → `[speed 2]` の叫び → `wait: 60` → フェードアウト |
| 1 日目の終わり | 裁判長「審理を明日に」→ 木槌 → `bgm: null` → `fade: out` → 探偵編へ `goto` |
