#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'Instale o Node.js 20 ou mais recente: https://nodejs.org/'
  exit 1
fi
exec node server.mjs
