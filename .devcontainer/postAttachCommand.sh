#!/bin/zsh

git config --global --unset commit.template 2>/dev/null || true
git config --global --add safe.directory /home/vscode/app
git config --global fetch.prune true
git config --global --add --bool push.autoSetupRemote true
git config --global commit.gpgSign false
git worktree prune || true
current_branch=$(git branch --show-current)
git branch --format='%(refname:short)' --merged | egrep -Fxv -e "$current_branch" -e develop -e main -e master | xargs -r git branch -d || true
[ -f .envrc ] && direnv allow || true

# ~/.codex はマウントしない。リポジトリの .codex/config.toml は trusted なプロジェクトでしか
# 読まれず、その trust と model_provider(s) はリポジトリ側では無視されるため、
# ユーザー側の設定だけをコンテナ内に生成する。
setup_codex() {
  command -v codex >/dev/null 2>&1 && [ -n "$CODEX_HOME" ] || return 0
  cfg="$CODEX_HOME/config.toml"
  mkdir -p "$CODEX_HOME" || return 1
  if [ ! -f "$cfg" ]; then
    (
      umask 077
      exec >"$cfg" || exit 1
      # トップレベルのキーは最初のテーブルヘッダーより前に置く。
      [ -z "$OPENAI_BASE_URL" ] || printf 'model_provider = "compat"\n\n'
      printf '[projects."%s"]\ntrust_level = "trusted"\n' "$PWD"
      [ -z "$OPENAI_BASE_URL" ] || printf '\n[model_providers.compat]\nname = "compat"\nbase_url = "%s"\nenv_key = "OPENAI_API_KEY"\nwire_api = "responses"\n' "$OPENAI_BASE_URL"
    ) || return 1
  fi
  # TUI は OPENAI_API_KEY ではなく auth.json を見るので、キーは標準入力経由で一度だけ渡す
  # （ps に出さないため）。
  [ -n "$OPENAI_API_KEY" ] || return 0
  codex login status >/dev/null 2>&1 || printenv OPENAI_API_KEY | codex login --with-api-key
}
setup_codex || true
