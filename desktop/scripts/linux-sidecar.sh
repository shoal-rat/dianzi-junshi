#!/bin/sh
set -eu

if [ -z "${DJ_BACKEND_ARCHIVE:-}" ] || [ ! -f "$DJ_BACKEND_ARCHIVE" ]; then
  echo "电子军师后端资源不存在，请重新安装应用。" >&2
  exit 1
fi

cache_root="${XDG_CACHE_HOME:-${HOME:-/tmp}/.cache}/dianzi-junshi"
backend="$cache_root/server-__APP_VERSION__"

if [ ! -x "$backend" ]; then
  mkdir -p "$cache_root"
  temporary="$backend.tmp.$$"
  trap 'rm -f "$temporary"' EXIT INT TERM
  gzip -dc "$DJ_BACKEND_ARCHIVE" > "$temporary"
  chmod 700 "$temporary"
  mv -f "$temporary" "$backend"
  trap - EXIT INT TERM
fi

exec "$backend" "$@"
