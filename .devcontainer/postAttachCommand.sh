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

# Codex は OPENAI_API_KEY ではなく auth.json から資格情報を読むので、環境変数だけでは
# TUI がサインイン画面に留まる。キーを標準入力経由で一度だけ渡してログインする
# （ps に出ないようにするため）。
[ -n "$OPENAI_API_KEY" ] && command -v codex >/dev/null 2>&1 \
  && { codex login status >/dev/null 2>&1 \
    || printenv OPENAI_API_KEY | codex login --with-api-key; } || true

# Codex はプロジェクトローカルの .codex/config.toml にある model_provider /
# model_providers を無視するので、OpenAI 互換エンドポイントはユーザーレベルの
# 設定でしか反映されない。
write_codex_provider() {
  [ -n "$OPENAI_BASE_URL" ] && [ -n "$CODEX_HOME" ] || return 0
  cfg="$CODEX_HOME/config.toml"
  grep -q '^model_provider[[:space:]]*=' "$cfg" 2>/dev/null && return 0
  mkdir -p "$CODEX_HOME" || return 1
  # トップレベルのキーは最初のテーブルヘッダーより前に置かないと、TOML が
  # [projects.*] のメンバーとして読んでしまう。provider テーブル自体は追記して安全。
  {
    printf 'model_provider = "compat"\n\n'
    [ -f "$cfg" ] && cat "$cfg"
    printf '\n[model_providers.compat]\nname = "compat"\nbase_url = "%s"\nenv_key = "OPENAI_API_KEY"\nwire_api = "responses"\n' "$OPENAI_BASE_URL"
  } >"$cfg.tmp" && chmod 600 "$cfg.tmp" && mv "$cfg.tmp" "$cfg"
}
write_codex_provider || true
