#!/bin/zsh
set -e

sudo chown -R $(whoami):$(whoami) node_modules 2>/dev/null || true
sudo chown -R $(whoami):$(whoami) target 2>/dev/null || true
sudo chown -R $(whoami):$(whoami) ~/.cargo 2>/dev/null || true
sudo chown -R $(whoami):$(whoami) /usr/local/cargo 2>/dev/null || true
sudo chown -R $(whoami):$(whoami) .venv 2>/dev/null || true

# direnv の出力を抑える。
# direnv 2.36 以降は direnv.toml が無いと DIRENV_LOG_FORMAT 環境変数が無視される。
# 参照: https://github.com/direnv/direnv/issues/1418
mkdir -p ~/.config/direnv
cat > ~/.config/direnv/direnv.toml <<'EOF'
[global]
log_format = ""
hide_env_diff = true
EOF

# package.json があれば依存関係をインストールする。ロックファイルが無くても許容する
# （テンプレートを cp しただけで bun install をまだ実行していない場合があるため）。
if [ -f package.json ]; then
  if [ -f bun.lock ]; then
    bun install --frozen-lockfile --ignore-scripts
  else
    bun install --ignore-scripts
  fi
fi

# コンパイル可能な Rust プロジェクトがあれば依存を先取りする（Cargo.toml のみで
# src/ が無い場合、cargo fetch はエラーになるため、その組み合わせを除外する）。
if [ -f Cargo.toml ] && { [ -d src ] || grep -q '^\[workspace\]' Cargo.toml; }; then
  cargo fetch
fi

# tools/rom（ROM 解析スクリプト）が使う Python 依存関係を pyproject.toml から同期する。
# uv sync は .venv が無ければ作る。
if [ -f pyproject.toml ]; then
  if [ -f uv.lock ]; then
    uv sync --frozen
  else
    uv sync
  fi
fi
