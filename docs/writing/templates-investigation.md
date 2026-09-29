# YAML のひな形（探偵パートと小さな演出）

[templates-trial.md](templates-trial.md) の続き。人物・音の ID の決まりは同じ。台詞はすべて自作の例。

## 探偵編の始まり

公式の探偵編の始まりは「フェードイン（74%）→ 日時・場所の表示（43%）→ BGM（61%）」。
助手と「今日やること」を確かめてから探偵メニューへ。

```yaml
day1:
  - card: "9月26日 午後2時\n時計台の広場"
  - fade: in
  - bgm: investigation
    frames: 30
  - sayo: "ナルセさん、[wait 8]まずは\n現場を見ておきましょうよ。"
  - naruse: "（そうだな。[wait 10]\n　明日の法廷に備えないと）"
  - investigate: plaza
```

## 1 つの場所

目安: 話題 3〜4（1 つ 15 ページ前後）、調べる所 5〜7（1 か所 2〜6 ページ）、そのうち証拠品は 1〜2。

```yaml
plaza:
  name: 時計台の広場
  person: torii
  enter:
    - bgm: plaza                      # 場所ごとの曲（探偵パートの BGM の切り替えの 6 割はここ）
    - if: not visited(plaza)          # 初めて来たときだけ、人物の紹介
      then:
        - torii: "おや、[wait 10]弁護士さんですかな。\nご苦労さまですな。"
        - naruse: "（事件を見たという、[wait 8]\n　鳥居さんだ）"
  examine:
    - id: bench                       # ふつうの調べる所: 心の声 1 + 助手の相づち 1
      name: ベンチ
      area: [16, 120, 80, 40]
      then:
        - naruse: "（古いベンチだ。[wait 10]\n　時計台がよく見える）"
        - sayo: "ここに座ってたんですね、[wait 8]\n鳥居さん。"
    - id: tower                       # 証拠品の見つかる所: 気づきの音 + フラッシュ + 赤字
      name: 時計台
      area: [96, 8, 64, 88]
      then:
        - naruse: "（扉に、[wait 8]\n　紙が貼ってある‥‥）"
        - if: not has(repair)
          then:
            - se: discover
            - flash: true
            - naruse: "（[color red]修理中[color blue]‥‥！[wait 12]\n　鐘は止まっていたのか）"
            - give: repair
            - narrate: 証拠品《修理票》を法廷記録にファイルした。
  talk:
    - id: night
      topic: 事件の夜のこと
      then:
        - torii: "あの夜は、[wait 10]このベンチで\n休んでおりましてな。"
        - naruse: "最近、[wait 6]\nおかしな物音でもしました？"
        - torii: "鐘が鳴って、[wait 12]\n顔を上げたんですよ。"
    - id: bell
      topic: 時計台の鐘
      when: seen(night)               # 前の話題を聞くと出る
      then:
        - torii: "毎正時に鳴るんですよ。\n町の自慢でしてな。"
  present:
    repair:                           # 核心の証拠品: 動揺を見せて、次の話題や法廷の伏線にする
      - torii: "修理中？[wait 12]\nはて‥‥。"
      - shake: 30
      - torii: "[speed 2]い、[wait 6]いや！[wait 10][speed 3]\n確かに聞きましたとも！"
    sayo:                             # 人物ファイル: 人物同士の関係を見せる短い会話（逆転裁判2 から多い）
      - torii: "お嬢さんも、[wait 8]\n弁護士さんですかな？"
  presentWrong:                       # そのほか: その人物らしい一言で返す
    - torii: "はて、[wait 8]\nそれが何か？"
  move:
    - to: gate
      when: has(repair)               # 手がかりを得ると行ける場所が増える
```

## 日の終わり（探偵編から法廷編へ）

```yaml
gate:
  name: 地方裁判所
  enter:
    - naruse: "（証拠品はそろった。[wait 12]\n　明日に備えよう）"
    - bgm: null
      frames: 60
    - fade: out
      frames: 48
    - goto: opening
```

## サイコ・ロック

書き方は [../scenario-games.md](../scenario-games.md#サイコ・ロック逆転裁判23)。公式の目安は 1 話に 2〜3 つ、錠は 2〜3。
錠 1 つにつき「主人公の問い 2〜4 ページ → つきつけの要求 → 相手が認める 2〜4 ページ」。
最後の錠の前で BGM を止め、解除の後に本音を話させる。

## 小さな演出の並び

公式でよく使われる組み合わせを、強さの順に並べた（数は [effects.md](effects.md#台詞の直前の演出)）。

### 驚きの 3 段階

```yaml
# 軽い（フラッシュ + 揺れ 0。音なし）
- flash: true
- shake: 30
- sayo: "えっ、[wait 8]\nそうなんですか？"

# ふつう（フラッシュ + 衝撃の音 + 揺れ 1）
- se: shock
- flash: true
- shake: 30
  strength: 1
- naruse: "な、[wait 6]なんだって！"

# 決定的（BGM を止める + 衝撃の音 + フラッシュ + 揺れ 2）
- bgmPause: true
- se: shock
- flash: true
- shake: 30
  strength: 2
- torii: "[speed 2]そ、[wait 8]そんな‥‥！"
```

### 台詞の途中で一撃

1 ページの中の決め所の字で光らせる。文中では「flash + se + shake」の組が最も多い。

```yaml
- naruse: "犯人は、[wait 16][se shock][flash][shake 30 1]あなただ！"
```

### 気づき（新しい事実）

揺らさず、気づきの音とフラッシュだけ。要の語を赤にする。

```yaml
- se: discover
- flash: true
- naruse: "（そうか‥‥[wait 12][color red]9回[color blue]の鐘は、\n　この置時計が鳴らしていたのか）"
```

### 沈黙と、ためらい

「‥‥」だけのページは遅い文字送りで出す。ためらいは台詞の頭を遅くし、途中で標準に戻す。

```yaml
- torii: "[speed 8]‥‥‥‥"
- torii: "[speed 5]あの夜のことは‥‥[wait 20][speed 3]\n話したくありませんな。"
```

### 電話・無線・画面の外の声

台詞全体を緑にする（公式の緑の多くはこの使い方）。

```yaml
- say: torii
  text: "もしもし、[wait 8]\n弁護士さんですかな？"
  color: green
```

### 回想に入る・出る

白いフェードで入り、黒いフェードで戻る（公式のフェードアウトの 13〜22% が白）。

```yaml
- bgmPause: true
- fade: out
  color: white
  frames: 48
- narrate: "[speed 4]‥‥3年前、[wait 12]\nあの冬の夜。"
- fade: in
  color: white
  frames: 48
# ……回想の場面……
- fade: out
  frames: 30
- bgmPause: false
  frames: 60
- fade: in
```

### 立ち絵の動きの切り替え

1〜2 ページごとに `show` で動きを替え、感情が変わる字で文中の `[show ...]` を使う
（公式の法廷では 100 ページに 50〜60 回の動き替え）。

```yaml
- show: torii
  talk: normal
- torii: "私は、[wait 10]見たままを\n話しているだけですよ。"
- torii: "ですから、[wait 10][show torii shocked shocked]\nそ、[wait 6]その証拠品は‥‥！"
```
