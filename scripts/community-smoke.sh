#!/usr/bin/env bash
# Start the open-source edition against a migrated disposable database and check
# that it serves the anonymous API with no hosted pages, routes or wording.
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ -e "$ROOT_DIR/server/enterprise" ]]; then
  echo 'The community smoke runs only without the hosted extension installed.' >&2
  exit 2
fi
if [[ -z "${CANQUERY_DATABASE_URL:-}" || "${NODE_ENV:-}" == production ]]; then
  echo 'Set CANQUERY_DATABASE_URL to a disposable database; production environments are refused.' >&2
  exit 2
fi
port="${SMOKE_PORT:-3197}"
base="http://127.0.0.1:$port"
log="$(mktemp)"
cd "$ROOT_DIR/server"
npm run migrate
NODE_ENV=production HOST=127.0.0.1 PORT="$port" node server.js > "$log" 2>&1 &
api=$!
trap 'kill "$api" 2>/dev/null || true' EXIT
for _ in $(seq 1 60); do
  if curl -fsS "$base/readyz" > /dev/null 2>&1; then break; fi
  if ! kill -0 "$api" 2>/dev/null; then cat "$log" >&2; exit 1; fi
  sleep 1
done
expect() {
  local got
  got="$(curl -s -o /dev/null -w '%{http_code}' "$base$1")"
  if [[ "$got" != "$2" ]]; then
    echo "GET $1 returned $got, expected $2" >&2
    exit 1
  fi
}
expect /readyz 200
expect /api/v1/datasets 200
expect /api/v1/openapi.json 200
expect /docs 200
expect /pricing 404
expect /account 404
expect /api/account/plans 404
expect /api/auth/get-session 404
if curl -fsS "$base/api/v1/openapi.json" | grep -qE 'bearerAuth|x-credit-cost|QUOTA_EXCEEDED'; then
  echo 'The community OpenAPI document describes hosted features.' >&2
  exit 1
fi
echo 'Community edition smoke passed.'
