# Rust のツールのビルド済みの実行ファイル

ROM から素材を取り出す **aa-extract** と、シナリオの整合性チェッカー **aa-verify** は、GitHub Releases にビルド済みの実行ファイルを置いている。Rust を入れてビルドしなくても使える。

**リリースには ROM も、ROM から取り出したデータも含まない。** aa-extract には、自分が持っているソフトから吸い出した ROM を使うこと。

## ダウンロード

[Releases](https://github.com/tkgstrator/Ace_Attorney_Script_Editor/releases) から、タグが `tools-v` で始まるリリースを開き、自分の環境のアーカイブを取る。

| 環境 | アーカイブ |
|---|---|
| macOS（Apple シリコン） | `aa-tools-<版>-aarch64-apple-darwin.tar.gz` |
| macOS（Intel） | `aa-tools-<版>-x86_64-apple-darwin.tar.gz` |
| Linux（x86_64） | `aa-tools-<版>-x86_64-unknown-linux-musl.tar.gz` |
| Linux（arm64） | `aa-tools-<版>-aarch64-unknown-linux-musl.tar.gz` |
| Windows（x86_64） | `aa-tools-<版>-x86_64-pc-windows-msvc.zip` |

Linux 版は musl で静的リンクしているので、ディストリビューションや glibc の版を問わず動く。Windows 版は C ランタイムを静的に入れているので、VC++ 再頒布パッケージは要らない。

アーカイブの中身:

```
aa-tools-<版>-<ターゲット>/
  aa-extract          （Windows は aa-extract.exe）
  aa-verify           （Windows は aa-verify.exe）
  README.md           （この文書）
  README-aa-verify.md （aa-verify の詳しい説明。crates/aa-verify/README.md）
  LICENSE
```

### チェックサムを確かめる

各アーカイブに `.sha256` が付いている（まとめたものは `SHA256SUMS`）。

```sh
shasum -a 256 -c aa-tools-0.1.0-aarch64-apple-darwin.tar.gz.sha256   # macOS
sha256sum -c aa-tools-0.1.0-x86_64-unknown-linux-musl.tar.gz.sha256  # Linux
```

Windows（PowerShell）は `Get-FileHash .\aa-tools-0.1.0-x86_64-pc-windows-msvc.zip` の値を `.sha256` の中身と見比べる。

### 展開する

```sh
tar -xzf aa-tools-0.1.0-aarch64-apple-darwin.tar.gz
cd aa-tools-0.1.0-aarch64-apple-darwin
```

### macOS で「開発元を検証できない」と言われたとき

実行ファイルには Apple の署名・公証をしていない。ブラウザーで取ったファイルには quarantine の属性が付き、Gatekeeper が実行を止める。取り出したフォルダーで属性を外す。

```sh
xattr -d com.apple.quarantine aa-extract aa-verify
```

アーカイブを展開する前に `xattr -d com.apple.quarantine aa-tools-*.tar.gz` としてもよい（`curl` や `gh release download` で取ったファイルには属性が付かない）。

## aa-verify（整合性チェッカー）

コンパイル済みのシナリオ（IR の JSON）を読んで、最後まで遊べるかを調べる。詳しくは同梱の `README-aa-verify.md`（[整合性チェックの説明](../crates/aa-verify/README.md)）。

### IR の JSON を渡す（実行ファイルだけで動く）

```console
$ ./aa-verify clocktower.json
== 1. つきつけの証拠品を持てるか: 0 件
== 2. シーン・場所に着けるか: 0 件
== 3. 条件のフラグを立てられるか（満たせない条件）: 0 件
clocktower.json: 軽いチェック OK（状態を区別しない近似。見落とし・誤検知がありえます。網羅的に調べるには --complete）（0.00 秒）

$ ./aa-verify --complete clocktower.json
  … 展開 0・発見 1
編ごとの状態の数（まとまり: 行き来のある編は一緒に調べる）:
  investigation: 状態 17、入り口 1、解析 1 回、0.0 秒
  trial: 状態 15、入り口 1、解析 1 回、0.0 秒
clocktower.json: OK（シーン 10、証拠品 9、フラグ 3、調べた状態 32、0.0 秒）
```

- 問題がなければ終了コード 0、詰みなどが見つかれば 1、使い方の誤りは 2。
- `--json` で結果を JSON で出す（例: `{"file":"clocktower.json","mode":"light","sec":0.00001,"findings":[]}`）。
- 引数なしで実行すると使い方を出す。

### YAML から IR の JSON を作る（bun とリポジトリが要る）

シナリオの YAML を IR にするコンパイラーは TypeScript（`packages/script`）にあるので、YAML を調べるにはリポジトリの clone と [bun](https://bun.sh) が要る。

```sh
git clone https://github.com/tkgstrator/Ace_Attorney_Script_Editor.git
cd Ace_Attorney_Script_Editor
bun install
bun packages/script/src/export-ir.ts apps/player/cases/clocktower.yaml -o clocktower.json
/path/to/aa-verify clocktower.json
```

YAML を直接渡すこともできる（`aa-verify apps/player/cases/clocktower.yaml`）。このとき aa-verify は、今のフォルダー（または実行ファイルの置き場所）から上へ `packages/script/src/export-ir.ts` を探し、`bun` で IR にしてから調べる。リポジトリの外で YAML を渡すと、次のように言って止まる。

```
s.yaml: packages/script/src/export-ir.ts が見つかりません（IR の JSON を渡してください）
```

## aa-extract（ROM から素材を取り出す）

```console
$ ./aa-extract --help
使い方: aa-extract <rom.nds> [--out 出力先] [--only 手順,...] [--no-raw]
            [--font-mapping mapping.tsv] [--font-fixes font_fixes.tsv] [--font-extra font_extra.txt]
            [--font-also フォルダー ...] [--path-prefix assets/extracted] [--jobs N]
            [--max-bgm 秒] [--max-se 秒] [--audio-only 名前,...]

手順（--only、既定はすべて）:
  files     NitroFS のファイルをそのまま files/ に
  ...
```

（`--help` は使い方を出して終了コード 2 で終わる。）

出力の既定は、今のフォルダーの `assets/extracted-rs`。台本の文字の対応を直す表（`tools/rom/font_fixes.tsv`・`tools/rom/font_extra.txt`）は、今のフォルダーから相対で探す。そのため、**リポジトリの clone の根で実行する**のがいちばん簡単。

```sh
cd Ace_Attorney_Script_Editor
/path/to/aa-extract ~/roms/gyakuten.nds --out assets/extracted-rs
```

リポジトリの外で使うときは、表を明示する（無くても動くが、台本の一部の字が直らない）。

```sh
./aa-extract ~/roms/gyakuten.nds --out ./extracted \
  --font-fixes /path/to/repo/tools/rom/font_fixes.tsv \
  --font-extra /path/to/repo/tools/rom/font_extra.txt
```

## リリースの作り方（開発者向け）

ワークフローは [.github/workflows/rust-release.yml](../.github/workflows/rust-release.yml)。

- **タグ `tools-v<版>` の push**: 5 つの環境でビルドし、GitHub Release を作ってアーカイブ・`.sha256`・`SHA256SUMS` を添付する。
- **手動（Actions の画面の Run workflow）**: ビルドして、アーカイブを Actions の artifact に上げるだけ。リリースは作らない。版は `<クレートの版>-dev.<コミットの先頭 7 桁>`。

PR と develop・master への push では、[.github/workflows/rust-ci.yml](../.github/workflows/rust-ci.yml) が Linux でビルドとテスト（`cargo test -p aa-verify -p aa-rom -p aa-extract`）を行う。テストは ROM も `assets/extracted` も要らない。

### 版の決め方

- クレートの版は、ルートの `Cargo.toml` の `[workspace.package] version` にまとめている（各クレートは `version.workspace = true`）。
- タグ `tools-vX.Y.Z` の `X.Y.Z` は、この版と一致しなければならない。ワークフローの最初のジョブ（prepare）が aa-extract と aa-verify の版を `cargo metadata` で読み、タグと違えば失敗する（ビルドもリリースもしない）。
- 版は [SemVer](https://semver.org/lang/ja/) に従う。コマンドの引数・出力の形・IR の読み方を互換でなく変えたら、マイナー（1.0 までは）を上げる。

### 版を上げてリリースする手順

1. develop から枝を切り、ルートの `Cargo.toml` の `[workspace.package] version` を新しい版にする。
2. `cargo build --workspace` を実行して `Cargo.lock` の版も更新する（CI は `--locked` でビルドするので、`Cargo.lock` が古いと失敗する）。
3. `Cargo.toml` と `Cargo.lock` をコミットし（例: `chore: bump the Rust tools to 0.2.0`）、PR を develop・master へ入れる。
4. master の、その版のコミットにタグを打って push する。

   ```sh
   git switch master && git pull
   git tag tools-v0.2.0
   git push origin tools-v0.2.0
   ```

5. Actions の「Rust tools release」が終わると、Releases に `tools-v0.2.0` ができる。

最初のリリースは、今の版 `0.1.0` のまま `tools-v0.1.0` を打てばよい。
