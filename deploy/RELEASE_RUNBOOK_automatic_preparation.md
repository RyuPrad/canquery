# Automatic resource preparation

This release prepares only the eligible resource opened in Table or Chart.
Dataset lists, maps, metadata, initial HTML and sitemaps never enqueue table jobs.
The browser receives 50 rows per table page; chart queries aggregate the complete
prepared file with the active search/filters. Publisher revisions discovered by
catalogue sync trigger a refresh on the next eligible visit. The previous copy
remains readable until the replacement commits, and active readers retain their
snapshot until completion. No catalogue-wide preparation or forced sync is part
of this release.

## Verification

Run `npm --prefix server run verify`. Against a disposable PostgreSQL 16/PostGIS
3.5 database, apply all migrations and run the five integration suites listed in
`.github/workflows/ci.yml`, including `preparationIntegration.test.js`. Set both
`CANQUERY_DATABASE_URL` and `SPATIAL_TEST_DATABASE_URL` to that disposable database.
Never aim integration fixtures at production.

Check Chromium/WebKit, English/French, narrow/wide layouts and keyboard use:

- Opening an unprepared CSV/Excel resource starts one job and displays 50 rows.
  Reloads, simultaneous visitors and returning from Map share the same work.
- Ready tables and live CKAN table views respond immediately. A live resource
  prepares an eligible file only for Chart or non-equality filters.
- Chart totals include data beyond the first page, respect filters, and label
  limited group lists. Unsupported resources retain the original download.
- A source revision refreshes on visit; failed or superseded builds preserve the
  existing copy. Changed columns clear invalid filters/sort with an explanation.
- Hidden tabs pause new admission and polling. Capacity/cooldown responses obey
  Retry-After. Navigation aborts stale reads without canceling shared server work.
- Initial HTML, dataset browsing and Map do not send preparation POSTs.

## Rollout

Use the existing reviewed-release, service-user ownership, validated catalogue
and analytics backups, and encrypted hash-verified off-host backup procedure in
`DEPLOY.md`. Preserve the previous commit/frontend and private release evidence.
Validate the exact release in an isolated directory before promotion.

1. Set `AUTO_PREPARE_ENABLED=false` in the API environment before installing the
   release. Keep the existing size, row, memory, free-space and store-budget caps.
   The defaults for new automatic admissions are `AUTO_PREPARE_PER_IP_HOUR=20`
   and `AUTO_PREPARE_MAX_ACTIVE=10`. The IP budget is per API process, in memory;
   the queue admission lock and shared jobs are durable in PostgreSQL.
2. Stop the existing ingest worker gracefully and confirm it has exited before
   replacing its code. Do not run a second worker. Apply additive migration
   `032_resource_preparation.sql` through `npm run migrate` as the service user.
   Existing snapshots keep their data and get a NULL source version; their
   first eligible later visit revalidates them lazily.
3. Promote matching code/assets with `index.html` last and old hashed assets
   retained. Restart the API and ingest worker. Map worker, catalogue schedules,
   analytics and other applications require no changes. Check ownership and
   `/healthz`, `/api/v1/ops`, a ready table and a download-only resource.
4. Enable `AUTO_PREPARE_ENABLED=true` and restart the API. Exercise a small
   bounded set of eligible CSV/Excel and live-CKAN Chart visits; verify shared
   jobs, accurate full-file aggregates and unchanged dataset-list behavior.
5. Observe `ops.preparations`: pending/running, oldest pending time, completed
   and failed jobs in the last day. Invalid files are expected individual
   failures, so these counters do not alone change overall `ops.ok`. Inspect
   private worker logs for failure codes, queue age and resource use. Confirm
   retired tables drain after readers finish and total stored bytes stay within
   the existing budget. Keep both active and retired table bytes in accounting.

Transient work retries at 30/120 seconds, at most three attempts, then cools down
for one hour. Invalid files cool down for 24 hours. A catalogue source-version
change bypasses a prior version's cooldown. Current copies and joins consume no
new-job allowance. A full queue returns 429/Retry-After without admitting work.

## Pause and rollback

First set `AUTO_PREPARE_ENABLED=false` and restart the API. Ready tables, original
downloads and legacy `/ingest` remain available; admitted jobs finish normally.
The metadata flag makes the new UI explain unavailable preparation.

For a full code rollback, let the single new worker drain the bounded active
queue, then stop it gracefully. Allow existing readers to finish and verify
`retired_ingest_tables` is empty; the worker reaps these tables on its idle cycle.
Do not use the old eviction implementation while unaccounted retired tables
remain. Restore the preserved compatible code and matching frontend with the
index last, then restart API/ingest worker and verify health, queries and
ownership. Migration 032 is additive: retain it, the ready snapshots and source
versions. No database restore or reversal of catalogue migrations is required.

If a long reader prevents retirement, keep the new backend with admission paused
until it finishes. Do not drop the serving table or kill shared work to make a
rollback appear complete.
