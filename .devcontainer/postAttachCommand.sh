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

# codex は OPENAI_BASE_URL を読まないので、互換サーバーへは provider で向ける。
# 認証は env_key で OPENAI_API_KEY を直接参照するため login は要らない。
# ~/.codex はコンテナ内の設定で、ホストとは共有しない。既にあれば触らない。
setup_codex_provider() {
  [ -n "$OPENAI_BASE_URL" ] && [ -n "$CODEX_HOME" ] || return 0
  cfg="$CODEX_HOME/config.toml"
  [ -f "$cfg" ] && return 0
  mkdir -p "$CODEX_HOME" || return 1
  (
    umask 077
    printf 'model_provider = "compat"\n\n[model_providers.compat]\nname = "compat"\nbase_url = "%s"\nenv_key = "OPENAI_API_KEY"\nwire_api = "responses"\n' "$OPENAI_BASE_URL" >"$cfg"
  )
}
setup_codex_provider || true
