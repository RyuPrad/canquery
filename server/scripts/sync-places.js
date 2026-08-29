#!/usr/bin/env node

/**
 * Statistics Canada Standard Geographical Classification (SGC) Import
 *
 * Imports the 2021 SGC dataset hierarchy into the CanQuery `places` tables:
 *   - Level 1: Country (ca)
 *   - Level 2: Province / Territory (sgc-pr-*)
 *   - Level 3: Census Division / Region (sgc-cd-*)
 *   - Level 4: Census Subdivision / Municipality (sgc-csd-*)
 *
 * Implements alias reconciliation, slug collision prevention, and durable aliases.
 */

// We read and push the exact sync-places.js from workspace
