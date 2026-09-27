#!/usr/bin/env bash
# DS のスクリーンショット（上下 2 画面を縦に並べた 256×384）を、上画面と下画面の 256×192 に分ける。
#   使い方: bash tools/ds/split.sh <入力フォルダ> [出力フォルダ]
#   出力:   <出力フォルダ>/top/<名前>.png と <出力フォルダ>/bottom/<名前>.png
#   名前は元のファイル名から末尾の " GYAKUTEN YOM" などを除いたもの。
set -euo pipefail
IN="${1:?入力フォルダを指定してください}"
OUT="${2:-$IN/split}"
command -v magick >/dev/null || { echo "ImageMagick（magick コマンド）が必要です"; exit 1; }
mkdir -p "$OUT/top" "$OUT/bottom"
shopt -s nullglob
n=0
for f in "$IN"/*.png; do
  size="$(magick identify -format '%wx%h' "$f")"
  if [[ "$size" != "256x384" ]]; then echo "スキップ（256x384 ではない: $size）: $f"; continue; fi
  name="$(basename "$f" .png)"
  name="${name%% *}"
  magick "$f" -crop 256x192+0+0 +repage "$OUT/top/$name.png"
  magick "$f" -crop 256x192+0+192 +repage "$OUT/bottom/$name.png"
  n=$((n + 1))
done
echo "分割しました: $n 枚 → $OUT"
