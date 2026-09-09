# v38 search visibility closeout

This release adds crawlable initial content and organization discovery, keeps
page metadata current during client navigation, and separates semantic search
opportunities from brand and diagnostic queries. It follows the first v38
release (PR #38). Migration 031 belongs to that earlier release and must remain
applied; this closeout introduces no migration.

## Verification before deployment

1. Preserve existing local work and prepare the release in an isolated worktree
   based on current `main`. Keep raw catalogue/SEO fixtures and backup records
   in a private evidence directory outside the public repository.
2. Run `npm ci` in `server/` and `client/`, then `npm run verify --prefix server`.
3. Use a disposable PostgreSQL 16/PostGIS 3.5 database. Set
   `CANQUERY_DATABASE_URL` and `SPATIAL_TEST_DATABASE_URL` to that database,
   run `npm run migrate --prefix server`, then run the spatial and Search Console
   integration suites. CI repeats these checks, including migration 031
   idempotence, query classification parity, report limits and publisher counts.
4. Check canonical dataset, resource, place and organization pages with
   JavaScript enabled and disabled. Require a single h1, canonical and valid
   JSON-LD. Verify client navigation and Back update the title, canonical and
   schema. Check French mobile layout and document language.
5. Confirm aliases return 301 with query strings preserved; unknown routes
   return 404/noindex; catalogue failures, including directory/preview queries,
   return 503/noindex with `Retry-After: 60` and `Cache-Control: no-store`.
6. Review the complete diff and merge only after all CI jobs pass. Record the
   reviewed merge and pre-deployment commit in the private release manifest.

## Production preflight and backups

- Require a clean checkout, healthy database/upstream checks and active API,
  ingest-worker and map-worker units. Record any existing source-job failures
  separately from release regressions. Verify service-user ownership of Git,
  dependencies and generated output before running Git or npm as that user.
- Confirm migration 031 and both query-page reporting indexes exist. Do not
  reverse or re-create this migration during the closeout.
- Take fresh catalogue and analytics custom-format dumps under the existing
  backup lock. Exclude only rebuildable `map_store.features` data. Validate
  both with `pg_restore --list` before any production source or checkout write.
- Encrypt both dumps with the existing private backup credential, copy to the
  established off-host destination, and verify ciphertext hashes plus decrypted
  plaintext hashes. Retain manifests privately and remove temporary plaintext
  transport copies. Existing scheduled local retention continues unchanged.
- Freeze the latest finalized Search Console 28-day report baseline. Keep
  property totals separate from reported-query metrics and query-page pairs.

## Source recovery, only when still needed

If `source:red-deer-hub` remains failed, recover only that source:

1. Capture one upstream catalogue snapshot and validate it with the configured
   adapter. Dry-run that exact snapshot with catalogue comparison enabled.
2. Require the expected source identity, nonzero admission, zero enrichment
   failures and zero proposed dataset deletions. Independently compare admitted
   resource IDs and map-job IDs against stored rows; require zero removals.
3. Hold the existing municipal cron lock and a database transaction lock on
   the affected catalogue tables while rechecking these assertions. Use the
   same frozen snapshot for the write with `source.maxDeleteFraction = 0`.
   Roll back the source transaction if any deletion assertion fails.
4. Retain dry-run/write summaries, resource identity checks and before/after
   health responses in the private release directory. Do not run a broad
   municipal or federal sync or start a second map worker.

## Deploy and public acceptance

As the service user, fetch `origin`, fast-forward the clean checkout to the
reviewed merge, run `npm ci` in both packages, and run the release verifier.
Restart the API after the production bundle succeeds. Confirm the two existing
worker services remain active; this release does not change their runtime
behavior. Rebuild the private Search Console report with `npm run gsc:report`
from `server/` using the existing read-only grant.

Record production commit/cleanliness, unit states, `/healthz`, `/api/v1/ops`,
stats and settled map queue counts. Repeat the canonical/alias/unknown-page
checks against public HTTPS, validate all sitemap families including
`sitemap-organizations.xml`, and test browser navigation against the deployed
bundle. Never simulate a database outage in production.

## Rollback and observation

For an application regression, return the clean checkout to the recorded
previous release, reinstall its locked dependencies, rebuild its client and
restart the API. Retain migration 031, all catalogue rows, ingestion state and
map data. A successful source-only recovery does not need to be reversed with
an application rollback.

Use read-only API URL inspection for representative dataset, resource, place
and organization pages. The owner must submit the sitemap and request indexing
through authenticated Search Console; keep the current OAuth scope. Compare
the first seven finalized post-release days for crawl changes and the first
complete 28-day cohort for semantic search visibility. These observations
require elapsed time and must not be recorded as completed at deployment.
