#!/usr/bin/env bash
# Source verification by default; --full also requires disposable integration.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
SCOPE="${1:---source}"
if [[ "$#" -gt 1 || ( "$SCOPE" != --source && "$SCOPE" != --full && "$SCOPE" != --integration ) ]]; then
    echo 'Usage: verify-release.sh [--source|--integration|--full]' >&2
    exit 2
fi
if [[ "$SCOPE" == --integration ]]; then
    exec bash "${SCRIPT_DIR}/verify-integration.sh"
fi

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== CanQuery Release Verification ===${NC}"
echo "Root directory: ${ROOT_DIR}"
echo ""

# Validate the repository-authored guides before build or deployment.
node "${ROOT_DIR}/server/scripts/check-blog.js"
python3 -m unittest discover -s "${ROOT_DIR}/deploy/analytics" -p 'test_*.py'
python3 -m unittest discover -s "${ROOT_DIR}/deploy/mail" -p 'test_*.py'
python3 -m unittest discover -s "${ROOT_DIR}/deploy" -p 'test_*.py'
python3 -m unittest discover -s "${ROOT_DIR}/scripts" -p 'test_*.py'
node --test "${ROOT_DIR}/deploy/backup-upload.test.cjs"

# 1. Server Linter
echo -e "${BLUE}[1/5] Running Server ESLint...${NC}"
cd "${ROOT_DIR}/server"
npm run lint
echo -e "${GREEN}✓ Server ESLint clean${NC}\n"

# 2. Server Tests
echo -e "${BLUE}[2/5] Running Server Jest Test Suite...${NC}"
cd "${ROOT_DIR}/server"
SPATIAL_TEST_DATABASE_URL= COMMERCIAL_TEST_DATABASE_URL= npm test
echo -e "${GREEN}✓ Server test suite passed${NC}\n"

# 3. Client Linter
echo -e "${BLUE}[3/5] Running Client ESLint...${NC}"
cd "${ROOT_DIR}/client"
npm run lint
npm run typecheck
npm run format:check
echo -e "${GREEN}✓ Client ESLint clean${NC}\n"

# 4. Client Tests
echo -e "${BLUE}[4/5] Running Client Vitest Test Suite...${NC}"
cd "${ROOT_DIR}/client"
npm test
echo -e "${GREEN}✓ Client test suite passed${NC}\n"

# 5. Client Production Build
echo -e "${BLUE}[5/5] Running Client Production Vite Build...${NC}"
cd "${ROOT_DIR}/client"
npm run build
echo -e "${GREEN}✓ Client production build succeeded${NC}\n"

echo -e "${GREEN}==============================================${NC}"
if [[ "$SCOPE" == --full ]]; then
    bash "${SCRIPT_DIR}/verify-integration.sh"
    echo -e "${GREEN}✓ Source and disposable database verification passed.${NC}"
else
    echo -e "${GREEN}✓ Source verification passed.${NC}"
    echo 'Not run: disposable database integration, native analytics runtime, browser acceptance and production verification.'
    echo 'Run npm --prefix server run verify:release with explicit disposable database URLs for the source + database gates.'
fi
echo -e "${GREEN}==============================================${NC}"
