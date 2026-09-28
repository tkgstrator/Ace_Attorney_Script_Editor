# Ace Attorney Script Editor

逆転裁判風の法廷アドベンチャーを作るための TypeScript フレームワーク。
シナリオは YAML で書き、ブラウザで遊べる。

## 使い方

パッケージ管理と実行には [Bun](https://bun.sh) を使う。

```bash
bun install
bun run dev        # サンプル事件「時計塔の鐘」を起動（表示された URL を開く）
bun run editor     # エディタを起動（apps/player/cases/*.yaml を直接編集・保存）
bun run test       # テスト（Vitest）
bun run typecheck  # 型チェック
bun run check apps/player/cases/clocktower.yaml   # シナリオの検証
target/release/aa-verify --complete <シナリオ.yaml>  # 整合性チェックの Rust 版（crates/aa-verify/README.md）
bun run schema     # エディタ補完用の JSON Schema を書き出す
```

## 構成

```
packages/
  core/      状態（フラグ・証拠品・ライフ）と、証言・尋問のステートマシン。描画を知らない
  script/    YAML → 中間表現のコンパイラ。zod スキーマ・参照チェック・行番号付きエラー
  runtime/   canvas への描画と入力。Engine の Beat を画面にする
             画面は DS 版のメイン画面と同じ 256×192 ドット（1 ドット = 2px で描く）
             文字は同梱の PixelMplus12/10（M+ FONT LICENSE）で、ドット絵と同じ粗さで描く
apps/
  player/    サンプル事件とデバッグパネル（フラグの書き換え、シーン移動、セーブ/ロード）
  editor/    逆裁エディタ（React + shadcn/ui）。章を探索編・裁判編ごとにフォームで編集し、
             右でコンパイル結果の診断・整合性チェック・プレビューを見られる。保存は開発サーバー経由で YAML に書く
crates/
  aa-verify/ 整合性チェックの Rust 版（既定は軽いチェック、--complete で網羅的な探索）
schema/      scenario.schema.json（bun run schema で生成）
docs/        シナリオの書き方
```

データの流れ:

```
YAML ─(script: 検証・コンパイル)→ CompiledScenario ─(core: Engine)→ Beat ─(runtime: Player)→ canvas
                                                        ↑
                                     advance / press / present / choose
```

- シナリオの形は `packages/script/src/schema.ts` の zod スキーマが唯一の正。
  検証・型・JSON Schema はすべてここから作る。
- エンジンの状態（`GameState`）はそのまま JSON にでき、セーブデータになる。
- 文字送りや演出の状態は runtime だけが持ち、エンジンには入れない。

シナリオの書き方は [docs/scenario.md](docs/scenario.md)、台詞の文体（カタカナ表記）は [docs/katakana.md](docs/katakana.md) を参照。

## ドット絵の素材

人物・背景・机・証拠品のドット絵は、Codex CLI の組み込み画像生成で作る（人物・机・証拠品は透過）。
作るものの一覧と指示文は `tools/sprites/manifest.ts` にある。

```bash
bun tools/sprites/generate.ts            # まだ無い元画像を生成（種類ごとに並列）→ assets/generated/raw/
bun tools/sprites/generate.ts evidence   # 種類を指定（character / background / foreground / evidence）
bun tools/sprites/process.ts             # 画面用のドット絵に縮めて apps/player/src/art/ に取り込む
```

- 画像生成は Codex の利用枠を消費する（画像のあるやり取りは通常の 3〜5 倍の速さで減る）。
- 人物は口パク用に、口を開けた絵（`<ID>-talk.png`）も作る。
- まだ画像が無いものは、プレイヤーではコードで描いた仮の絵（`apps/player/src/placeholder-art.ts`）を使う。

## DS 版から取り出したフォント（手元用・配布しない）

自分で吸い出した ROM から、DS 版の本文フォントを取り出して使える。取り出したものは `assets/extracted/`
（`.gitignore` 済み）に置き、プレイヤーはそこにフォントがあれば使う（無ければ PixelMplus12 で表示する）。

```bash
python3 tools/rom/dsfont.py <rom.nds>       # フォントを探して全文字を切り出す → assets/extracted/font/glyphs.txt
python3 tools/rom/ocr_font.py <rom.nds>     # 台詞を DS 版の字形で画像にし、macOS の文字認識で漢字の対応を決める → mapping.tsv
python3 tools/rom/compose.py 'apps/player/cases/*.yaml'   # DS 版にない漢字を部品から作る → tools/rom/font_extra.draft.txt
python3 tools/rom/build_font.py             # ゲームで使う形に書き出す → assets/extracted/font/ds-font.png / ds-font.json
```

逆転裁判2・3 の ROM があれば、蘇る逆転にない字をそこから足せる（2・3 は同じ画風のフォント）。

```bash
python3 tools/rom/dsfont.py <rom2.nds> assets/extracted/font/A2GJ
python3 tools/rom/ocr_font.py <rom2.nds> assets/extracted/font/A2GJ --base assets/extracted/font   # 同じ字形は蘇る逆転の文字、残りを文字認識
python3 tools/rom/build_font.py assets/extracted/font --also assets/extracted/font/YG3J assets/extracted/font/A2GJ
```

- `tools/rom/font_fixes.tsv`: 文字認識の結果を、字形を目で見て直したもの（ほかの作品の分は `font_fixes.<フォルダ名>.tsv`）
- `tools/rom/font_extra.txt`: DS 版にない字（下書きを確認・手直ししたもの）。`font_parts.txt` は手で描いた部品
- `tools/rom/data/ids.txt`: 漢字の部品の組み立て（cjkvi-ids、CHISE 由来、GPLv2）
- 比較用ページ `apps/player/compare.html` で、DS 版のスクリーンショットと点の単位で見比べられる
- `uv run tools/rom/extract_assets.py <rom.nds>` で背景・人物・机などを取り出すと、プレイヤーは DS 版の人物・背景・机・吹き出しで表示する
  （`apps/player/src/official-assets.ts`。生成したドット絵にするには `?art=generated` かデバッグパネルの「絵」）。
  人物は anim.tsv の原点を画面の中央 (128, 96) に、机は取り出した 256×192 の画像をそのまま重ねると DS 版と一致する
