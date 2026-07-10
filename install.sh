#!/usr/bin/env bash
# Download the latest desktop installer from the official GitHub Release.
set -euo pipefail

repo="shoal-rat/dianzi-junshi"
api="https://api.github.com/repos/$repo/releases/latest"
tmp="$(mktemp -d)"
cleanup() { rm -rf "$tmp"; }
trap cleanup EXIT

json="$(curl -fsSL -H 'Accept: application/vnd.github+json' "$api")"
urls="$(printf '%s' "$json" | grep -oE '"browser_download_url"[[:space:]]*:[[:space:]]*"[^"]+"' | cut -d '"' -f 4)"
os="$(uname -s)"
arch="$(uname -m)"

pick_url() {
  local pattern="$1"
  printf '%s\n' "$urls" | grep -Ei "$pattern" | head -n 1
}

if [ "$os" = "Darwin" ]; then
  case "$arch" in
    arm64|aarch64) pattern='aarch64.*\.dmg$' ;;
    x86_64) pattern='x64.*\.dmg$' ;;
    *) echo "暂不支持这个 Mac 架构：$arch" >&2; exit 1 ;;
  esac
  url="$(pick_url "$pattern")"
  [ -n "$url" ] || { echo "最新 Release 里还没有对应的 macOS 安装包" >&2; exit 1; }
  dmg="$tmp/电子军师.dmg"
  curl -fL "$url" -o "$dmg"
  mount="$(hdiutil attach -nobrowse -readonly "$dmg" | awk -F '\t' '/\/Volumes\// {print $3; exit}')"
  trap 'hdiutil detach "$mount" >/dev/null 2>&1 || true; cleanup' EXIT
  target="/Applications"
  [ -w "$target" ] || { mkdir -p "$HOME/Applications"; target="$HOME/Applications"; }
  ditto "$mount/电子军师.app" "$target/电子军师.app"
  hdiutil detach "$mount" >/dev/null
  echo "安装好了：$target/电子军师.app"
  open "$target/电子军师.app"
elif [ "$os" = "Linux" ]; then
  case "$arch" in
    x86_64|amd64) pattern='(amd64|x86_64).*\.AppImage$' ;;
    aarch64|arm64) pattern='(aarch64|arm64).*\.AppImage$' ;;
    *) echo "暂不支持这个 Linux 架构：$arch" >&2; exit 1 ;;
  esac
  url="$(pick_url "$pattern")"
  [ -n "$url" ] || { echo "最新 Release 里还没有对应的 Linux AppImage" >&2; exit 1; }
  mkdir -p "$HOME/.local/bin" "$HOME/.local/share/applications"
  app="$HOME/.local/bin/dianzi-junshi.AppImage"
  curl -fL "$url" -o "$app"
  chmod +x "$app"
  desktop="$HOME/.local/share/applications/dianzi-junshi.desktop"
  printf '%s\n' '[Desktop Entry]' 'Type=Application' 'Name=电子军师' "Exec=$app" 'Terminal=false' 'Categories=Utility;' > "$desktop"
  echo "安装好了：$app"
  "$app" >/dev/null 2>&1 &
else
  echo "这个脚本只支持 macOS 和 Linux；Windows 请运行 install.ps1。" >&2
  exit 1
fi
