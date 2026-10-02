FROM mcr.microsoft.com/devcontainers/base:dev-ubuntu24.04

# auth.json だけをホストからバインドマウントする。マウント先の親ディレクトリが無いと
# Docker が root 所有で作ってしまい、codex が config や state DB を書けなくなる。
RUN install -d -o vscode -g vscode /home/vscode/.codex
