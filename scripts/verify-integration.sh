#!/usr/bin/env bash
set -euo pipefail
ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# Refuse silent integration skips. These fixtures delete rows; the caller must
# select the same disposable database explicitly through all three test gates.
if [[ -z "${CANQUERY_DATABASE_URL:-}" || -z "${SPATIAL_TEST_DATABASE_URL:-}" || -z "${COMMERCIAL_TEST_DATABASE_URL:-}" ||
      "$CANQUERY_DATABASE_URL" != "$SPATIAL_TEST_DATABASE_URL" || "$CANQUERY_DATABASE_URL" != "$COMMERCIAL_TEST_DATABASE_URL" ]]; then
  echo 'Integration verification requires three matching explicit disposable database URLs: CANQUERY_DATABASE_URL, SPATIAL_TEST_DATABASE_URL and COMMERCIAL_TEST_DATABASE_URL.' >&2
  exit 2
fi
if [[ "${NODE_ENV:-}" == production || "${STRIPE_MODE:-}" == live ]]; then
  echo 'Integration verification refuses production or live-billing environments.' >&2
  exit 2
fi
cd "$ROOT_DIR/server"
npm run migrate
npx --no-install jest __tests__/spatialIntegration.test.js __tests__/searchConsoleIntegration.test.js __tests__/localSearchIntegration.test.js __tests__/catalogDiscoveryIntegration.test.js __tests__/preparationIntegration.test.js --runInBand
node --test --test-concurrency=1 integration/*.test.cjs
echo 'Disposable database integration verification passed.'
