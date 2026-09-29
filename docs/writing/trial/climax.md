# 5. 反論から次の展開・判決／持ち越し

`t2` の《ライト》のつきつけから、判決まで。休廷と、日をまたぐときの終わり方もここに書く。

**決めること:** 決定的な矛盾で何が崩れるか・検事の最後の抵抗・つきつけの要求の問い・終わり方（決着か持ち越しか）。
**点検:** 最後のつきつけの要求に要る事実が、すべてそれより前に出ているか（[裁判パートの設計](design.md#3-証言と矛盾の設計) の対応表）。

## 追い詰め

- **傾向:** 決定的な矛盾の直後に BGM を止め（`bgmPause`）、揺れ 2 の衝撃で証人を崩し、検事の抵抗 → 傍聴席のざわめき →
  静粛に → 追いつめる曲、と進む。揺れ 2 は揺れ全体の 6〜17%（[演出の集計](../numbers/effects.md)）。
  追いつめる曲への切り替えは、逆転裁判2 で正しいつきつけの後の 44%。
- **誰が:** 主人公が矛盾を言い切る（2〜3 ページ、要の語を赤）→ 証人の動揺（`[speed 2]` の叫び）→ 検事の割り込み →
  裁判長が静める → つきつけの要求で「証拠を示せ」と迫る。
- **静粛に:** ざわめきの音（`murmur`）→ 長い間（60〜120 フレーム）→ 木槌 2〜3 回 →「静粛に！静粛に！」（14 話。3 回くり返す形も 11 話）。
- **文中コマンド:** 動揺の叫びは `[speed 2]`、崩れる前の沈黙は `[speed 8]‥‥‥‥`。決め台詞の途中で `[se shock][flash][shake 30 2]`
  と一撃を入れる形もある（文中の演出の組み合わせで最多）。

**実例:**

> 裁判長「静粛に!静粛に!静粛に!」（蘇る逆転 第3話）

```yaml
contra2:
  - bgmPause: true                   # まず無音にする
  - naruse: "このライトは、[wait 10]倉庫の\n[color red]棚の下[color white]にありました。"
  - showEvidence: lamp
  - naruse: "10時半から、[wait 8]ずっと中に！\n[wait 12]照らせたはずがない！"
  - showEvidence: null
  - pan: 0
    to: kurata
  - wait: 31
  - se: shock                        # 決定的な衝撃: 音 + フラッシュ + 揺れ 2
  - flash: true
  - shake: 30
    strength: 2
  - kurata: "[speed 2]な、[wait 8]なんと‥‥！"
  - se: murmur                       # 傍聴席のざわめき → 長い間 → 木槌 → 静粛に
  - wait: 90
  - se: gavel
  - shake: 10
    strength: 1
  - wait: 12
  - se: gavel
  - shake: 10
    strength: 1
  - judge: 静粛に！静粛に！
  - bgmPause: false
    frames: 60
  - shout: objection
    by: himuro
  - himuro: "倉庫にいたのは、[wait 8]10時半。\n殺しは11時すぎだ。"
  - bgm: pursuit                     # 追いつめる曲
  - goto: final
```

## 決定的な証拠

- **制約:** つきつけの要求（`demand`）の正解の後に、法廷ならエンジンが「くらえ！」を出す。誤りは `wrong` の後にもう一度問われる。
- **傾向:** 正解の後の並びは、効果音 78〜88%、フラッシュ 71〜84%、証拠品の小窓 63〜83%、揺れ 47〜74%、BGM 一時停止 34〜55%。
  正しいつきつけの後とほぼ同じで、パンは少ない（[演出の使い方](../effects.md#つきつけの要求demandの正解の後)）。
- **推奨:** 問いの文で証拠品の性質を言う（「〜を示す証拠品」）。2 行・20 字前後。山場の前に「何がおかしいか」
  「だれが犯人か」の 2〜3 択を置くのもよくある形（誤りはペナルティ）。
- **決まり文句:** 検事の抵抗への裁判長の「異議は認められません。」（14 話）。

```yaml
final:
  - judge: "弁護人。[wait 10]その主張には\n証拠が要りますぞ。"
  - demand: "証人が11時すぎにも、\n倉庫の中にいた証拠は？"
    by: judge
    present:
      gloves:
        - showEvidence: gloves
        - naruse: "詰め所の[color red]手袋[color white]です！[wait 12]\n床にこぼれた油がついていた！"
        - naruse: "油がこぼれたのは、[wait 10]\n持ち主が倒れたとき！"
        - showEvidence: null
        - se: shock
        - flash: true
        - shake: 30
          strength: 2
        - kurata: "[speed 2]ぐ、[wait 6]ぐおおおッ！"
        - himuro: "異議あり！[wait 12]\nそれは、ただの‥‥"
        - judge: 異議は認められません。
        - goto: confess
    wrong:
      - judge: "それが、[wait 8]証人が倉庫に\nいたことを示すのですか？"
      - judge: "[speed 4]‥‥ペナルティを与えます。"
      - penalty: true
confess:
  - bgm: null
    frames: 60
  - kurata: "[speed 8]‥‥‥‥"
  - kurata: "[speed 5]あの晩、[wait 16]わしは\n倉庫の中におりました。"
  - kurata: "[speed 5]‥‥あの男が、[wait 12]\n先に殴りかかってきたんで。"
  - fade: out
    frames: 48
  - goto: verdict
```

## 判決

- **傾向（無罪の並び）:** 木槌 → 裁判長の前置き 1〜2 ページ →「判決を言い渡します。」（14 話）→ 文字の枠を隠して 60 フレーム →
  大きな文字（`banner: 無罪`）→ BGM を止める → 木槌 →「では、本日はこれにて閉廷！」（14 話）→ 60 フレーム → フェードアウト。
- **ライフが尽きたとき（`gameover` のシーン）:** 裁判長が審理を打ち切り → 判決 → `banner: 有罪` → 閉廷。公式の YAML の「有罪」50 回のうち
  46 回は、この後に高等裁判所へ送る言い渡しが続くゲームオーバーの写し。
- **推奨:** 判決の直前に主人公の「待った！」・検事の抗議でもう一山置くのもよい。閉廷の後は後日談（依頼人のお礼・助手との会話）を
  10〜30 ページ置いて `end`。
- **制約:** `banner` は 1 行 9 字まで（[文字数の決まり](../text-length.md)）。

**実例:** ゲームオーバーの打ち切りの言葉（全話で同じ）。

> 裁判長「そこまで!」（蘇る逆転 第1話）

> 裁判長「本法廷は、これ以上の審議の必要性を認めません。」（蘇る逆転 第1話）

```yaml
verdict:
  - fade: in
  - se: gavel
  - shake: 10
    strength: 1
  - wait: 40
  - judge: "[speed 5]‥‥それでは。"
  - judge: "被告人、[wait 10]港 健太に\n判決を言い渡します。"
  - textbox: false
  - wait: 60
  - banner: 無罪
  - bgm: verdict
  - wait: 120
  - bgmPause: true
    frames: 60
  - se: gavel
  - shake: 10
    strength: 1
  - wait: 40
  - judge: "では、[wait 16]本日はこれにて閉廷！"
  - wait: 60
  - fade: out
    frames: 64
  - end: true
guilty:                              # ゲームオーバーのシーン（トップレベルの gameover: guilty）
  - bgm: null
  - se: gavel
  - shake: 10
    strength: 1
  - judge: そこまで！
  - judge: "本法廷は、[wait 10]これ以上の\n審議の必要性を認めません。"
  - banner: 有罪
  - judge: では、本日はこれにて閉廷！
  - fade: out
    frames: 64
  - gameover: true
```

## 休廷

- **誰が:** 裁判長が休憩を宣言（11 話）→ 控え室（助手と作戦会議・新しい手がかり）→ 係官の呼び出し →
  裁判長「では、審理を再開します。」（13 話）。
- **演出:** 宣言の後に木槌 1 回 → フェードアウト → カード（「同日　午前11時20分」のような時刻と、控え室）→ フェードイン。
  戻るときもカードで法廷を出し、木槌から。

**実例:**

> 裁判長「では、ここで10分間の休憩をとります。」（蘇る逆転 第4話）

> 裁判長「では、審理を再開します。」（蘇る逆転 第3話）

```yaml
recess:
  - judge: "ここで、[wait 8]\n10分間の休憩をとります。"
  - se: gavel
  - shake: 10
    strength: 1
  - fade: out
  - card: "同日 午前11時20分\n地方裁判所 被告人第2控え室"
  - fade: in
  - sayo: "ナルセさん、[wait 8]\nあのライト、気になりますね。"
  - kakari: "弁護人！[wait 10]\n審理が再開します。"
  - fade: out
  - card: "同日 午前11時30分\n地方裁判所 第2法廷"
  - fade: in
  - se: gavel
  - shake: 10
    strength: 1
  - judge: "では、[wait 8]審理を再開します。"
  - goto: t2
```

## 日をまたぐ

- **傾向:** 1 日目の法廷は、真相に届かないまま審理が持ち越される所で切る（[書き方の型（構成）](../structure.md#話の組み立て)）。
  持ち越しの言い方は決まっていない（「明日まで延期します。」3 話・「ここまでとします。」4 話など）。
- **誰が:** 検事か主人公が「新しい証拠が要る」と言い出す → 裁判長が審理を明日に持ち越す → 閉廷 →
  主人公の心の声で次にやることを決める（探偵パートの目的になる）。
- **演出:** 木槌 → BGM を止める（60 フレームのフェード）→ フェードアウト → 探偵編の最初のシーンへ `goto`。
  探偵編の頭で日時・場所のカード（[探偵パートの設計](../investigation/design.md#3-場所と人物と進行条件)）。

```yaml
adjourn:
  - himuro: "検察側は、[wait 8]\nライトの鑑定を要求する。"
  - judge: "わかりました。[wait 10]\n審理は明日に持ち越します。"
  - se: gavel
  - shake: 10
    strength: 1
  - judge: では、本日はこれにて閉廷！
  - bgm: null
    frames: 60
  - fade: out
    frames: 48
  - naruse: "（[speed 4]明日までに、[wait 12]\n　あの倉庫を調べ直すしかない）"
  - goto: day2
```
