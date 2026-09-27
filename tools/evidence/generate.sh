#!/usr/bin/env bash
# 証拠品画像を Codex CLI で生成する。
#   使い方:  bash tools/evidence/generate.sh          # 未生成のものをすべて
#            bash tools/evidence/generate.sh clock    # 1個だけ
#            FORCE=1 bash tools/evidence/generate.sh clock   # 作り直し
#   Codex に追加の引数を渡す場合:  CODEX_ARGS="-m モデル名" bash tools/evidence/generate.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DIR="$ROOT/tools/evidence"
OUT_REL="assets/generated/evidence/raw"
mkdir -p "$ROOT/$OUT_REL"
ONLY="${1:-}"
command -v codex >/dev/null || { echo "codex コマンドが見つかりません。Codex CLI をインストールしてログインしてください。"; exit 1; }

while IFS=$'\t' read -r id name subject <&3; do
  [[ -z "${id:-}" || "$id" == \#* ]] && continue
  [[ -n "$ONLY" && "$ONLY" != "$id" ]] && continue
  out="$OUT_REL/$id.png"
  if [[ -f "$ROOT/$out" && -z "${FORCE:-}" ]]; then echo "スキップ（生成済み）: $id"; continue; fi
  echo "生成中: $id（$name）"
  prompt="$(sed -e "s|{{SUBJECT}}|$subject|" -e "s|{{OUT}}|$out|" "$DIR/prompt.txt")"
  # shellcheck disable=SC2086
  codex exec --full-auto -C "$ROOT" ${CODEX_ARGS:-} "$prompt" </dev/null || echo "失敗: $id"
  [[ -f "$ROOT/$out" ]] && echo "保存しました: $out" || echo "ファイルが保存されていません: $out"
done 3< "$DIR/evidence.tsv"
