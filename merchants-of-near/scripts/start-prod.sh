#!/usr/bin/env bash
# Production entrypoint: Next.js on loopback, game server in front of it.
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ -n "${DATABASE_URL:-}" ]]; then
  (cd apps/server && node ../../node_modules/prisma/build/index.js db push)
fi
mkdir -p "${DATA_DIR:-/data}"

node node_modules/next/dist/bin/next start apps/web -p 3000 -H 127.0.0.1 &
WEB=$!
(cd apps/server && WEB_ORIGIN="${WEB_ORIGIN:-http://127.0.0.1:3000}" exec node --import tsx src/index.ts) &
SRV=$!

# Forward shutdown so the server saves the world before the machine stops.
trap 'kill -TERM "$SRV" 2>/dev/null; wait "$SRV"; kill -TERM "$WEB" 2>/dev/null' TERM INT
wait -n "$WEB" "$SRV"
EXIT=$?
kill -TERM "$SRV" "$WEB" 2>/dev/null || true
wait || true
exit "$EXIT"
