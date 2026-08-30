#!/usr/bin/env bash
# scripts/verify-release.sh - Comprehensive CanQuery release verification
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

GREEN='\033[0;32m'
RED='\033[0;31m'
BLUE='\033[0;34m'
NC='\033[0m'

echo -e "${BLUE}=== CanQuery Release Verification ===${NC}"
echo "Root directory: ${ROOT_DIR}"
echo ""

# 1. Server Linter
echo -e "${BLUE}[1/5] Running Server ESLint...${NC}"
cd "${ROOT_DIR}/server"
npm run lint
echo -e "${GREEN}✓ Server ESLint clean${NC}\n"

# 2. Server Tests
echo -e "${BLUE}[2/5] Running Server Jest Test Suite...${NC}"
cd "${ROOT_DIR}/server"
npm test
echo -e "${GREEN}✓ Server test suite passed${NC}\n"

# 3. Client Linter
echo -e "${BLUE}[3/5] Running Client ESLint...${NC}"
cd "${ROOT_DIR}/client"
npm run lint
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
echo -e "${GREEN}✓ ALL RELEASE VERIFICATION CHECKS PASSED!   ${NC}"
echo -e "${GREEN}==============================================${NC}"
