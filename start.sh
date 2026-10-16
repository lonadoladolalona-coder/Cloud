#!/usr/bin/env bash
# One-step launcher: installs dependencies and builds the UI on first run, then starts Studio H3.
set -euo pipefail
cd "$(dirname "$0")"
command -v node >/dev/null || { echo "Node.js 20 or newer is required: https://nodejs.org"; exit 1; }
[ -d node_modules ] || npm install
[ -f dist/web/index.html ] || npm run build
URL="http://127.0.0.1:${PORT:-8787}"
( sleep 3; (command -v xdg-open >/dev/null && xdg-open "$URL") || (command -v open >/dev/null && open "$URL") || true ) >/dev/null 2>&1 &
exec npm start
