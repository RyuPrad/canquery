# Contributing to canquery

Thanks for your interest! canquery is an independent open-source project that puts
one consistent query API + UI over Canada's open data portal. Contributions -
bug reports, fixes, features, docs - are welcome.

## Getting set up

See **[README.md](README.md) → Local setup** for the full walkthrough. The short
version (Node 22, PostgreSQL 16):

```bash
# server
cd server && cp .env.example .env   # fill in CANQUERY_DATABASE_URL
npm ci && npm run migrate
node scripts/catalog-sync.js --limit 200   # small, polite real harvest
npm run dev                                 # API on :3100

# client (separate terminal)
cd client && npm ci && npm run dev     # Vite on :5173, proxies /api → :3100
```

## Before you open a PR

Run the source checks from the repository root:

```bash
npm --prefix server run verify
```

- The server test suite **mocks the database**, so it runs without Postgres.
- `verify` identifies its source-only scope: guide/operational guards, lint,
  scoped client types/formatting, unit/component tests and the frontend build.
  It does not claim database, native analytics, browser or production acceptance.
- Use PostgreSQL 16/PostGIS 3.5 and set `CANQUERY_DATABASE_URL`,
  `SPATIAL_TEST_DATABASE_URL` and `COMMERCIAL_TEST_DATABASE_URL` to the same
  **disposable** database. Then `npm --prefix server run verify:integration`
  applies migrations and runs every CI database suite. Missing/mismatched gates
  fail instead of silently skipping. Fixtures must never target production or
  a persistent Stripe sandbox. `verify:release` combines source and database
  checks; task-specific browser and native analytics acceptance remain separate.
- Boundary modules use JSDoc with `client/tsconfig.boundaries.json`; run
  `npm --prefix client run typecheck`. Extend this explicit scope as contracts
  stabilize. `format:check` and `format:boundaries` apply only to the listed
  resource/client boundary files. Keep mechanical formatting separate from
  behavior changes, and preserve the existing style elsewhere.
- Add or update tests for any behavior you change. Conventions to follow:
  - Server: `catchAsync` + `AppError`; thin controllers, logic in services, SQL in
    `db/*Queries.js`; **parameterized SQL only** (values as `$N`, identifiers
    validated against a known list - never string-interpolate user input).
  - Client: keep user-facing strings in `client/src/i18n.jsx` (EN + FR).

## Pull requests

- Branch off `main`, keep PRs focused, and describe what changed and why.
- Make sure lint, tests, and the client build pass locally.
- By contributing you agree your contributions are licensed under the project's
  [MIT License](LICENSE).

CI pins Node 22.22.1 and official action commits. Once the server, client and
database jobs pass, the release job packages the exact checked commit and the
frontend already built by the client job as `canquery-<commit>`. Its tarball and
checksum contain a `release-manifest.json` with source identity, runtime,
migrations and per-file SHA-256 hashes. Only tracked source and `client/dist`
are included; ignored configuration and dependencies stay outside the archive.
Install locked production server dependencies in isolated release staging.
Promote the tested frontend without rebuilding it, and verify the manifest
before promotion. CI artifacts have 30-day transport retention; operational
release and backup retention are separate. A passing artifact does not authorize
deployment or establish compatibility with a newer database/configuration.

## SEO research reviews

Run a review whenever a new Google Trends export is supplied. In chat, provide
the CSV path and ask: "Run the CanQuery SEO review on this export." The result is
a research shortlist; content changes remain a separate implementation task.

1. Read the export and record its region, period, query labels, relative interest
   and growth. Mark missing seed terms, categories and other settings as unknown.
   Trends interest is relative, not monthly search volume; proposed related
   keywords remain hypotheses until research supports them.
2. Read finalized Search Console results for the exact verified property. Use
   explicit, complete 28-day periods. Report homepage impressions separately
   from site totals, and Canadian results separately from worldwide results.
   Keep page totals, reported queries and query-page metrics separate: privacy
   omissions mean reported queries do not reconstruct page or property totals.
3. Match useful search tasks to admitted datasets and official publisher
   evidence. Verify coverage, canonical links and actual download, table, map or
   API capabilities. Consider the general public, data seekers and developers;
   qualify preparation and download limits rather than promising universal access.
4. Return at most five ranked opportunities and identify the three strongest
   next actions. Include the audience, English/French target queries, supporting
   evidence, destination page, proposed improvement, effort and uncertainty.
   Prioritize relevant intent, verified data support, existing visibility and
   lasting usefulness; use Trends interest and growth as supporting evidence.

For a homepage change, capture a separate private baseline before release and
measure homepage-only impressions as the primary outcome. Use the existing
search-intent classifier for reported brand, semantic and diagnostic queries;
report their populations separately. Compare complete 28-day windows starting
on the first full Search Console calendar day after deployment, and annotate
other releases and seasonality. Keep existing frozen cohorts unchanged. Store
exports, Search Console snapshots and release evidence outside the public
repository; do not commit private query data, account identifiers or credentials.

## Reporting bugs / requesting features

Use the GitHub issue templates. For anything security-related, please follow
[SECURITY.md](SECURITY.md) instead of opening a public issue.

## A note on the data

canquery indexes multiple government source portals. Every adapter must preserve
the publisher, upstream landing page, and verified licence; never apply one
publisher's default licence to another publisher. Problems with an **underlying
dataset** belong with its source organization - canquery only makes supported
resources easier to discover, map, and query.
