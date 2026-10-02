# Performance and measurement release

This release reserves space while catalogue/resource pages load, avoids replacing
resource controls during metadata refresh, memoizes table rows, loads route code
when needed, and defers featured-chart requests/rendering until nearby. Initial HTML preloads only the requested
route's static dependencies. Discovery queries use bounded caches and page-first
enrichment; featured previews reuse immutable snapshot work across languages.

It also replaces CanQuery's legacy performance measurements with pinned
`web-vitals` document metrics. The existing analytics Performance screen separates
corrected and legacy samples, displays each metric's actual sample count, and
preserves zero CLS and absent measurements. Historical samples are not rewritten.
The analytics overlay is scoped to one configured website; other websites and
the existing account-report authorization remain unchanged.

## Verification

Run `npm --prefix server run verify`, including the analytics overlay application
guard tests. Apply all application migrations to a disposable PostgreSQL 16 /
PostGIS 3.5 database and run the five integration suites in CI. Native analytics
tests and builds require the exact compatible analytics source tree, its locked
dependencies, and a separate disposable database; see [analytics/README.md](analytics/README.md).
The ordinary CanQuery verifier does not run the native analytics suites.

Use HTTPS production builds in Chromium and WebKit, both languages, both themes,
and narrow/wide screens. Check loading/error/refresh states, initial HTML without
JavaScript, URL/Back navigation, table typing, file-only resources, preparation
cooldowns and all map providers. Confirm a requested route is preloaded without
eagerly loading unrelated charts/maps. Confirm featured previews load near the
viewport, retain their layout and carousel state, and stay suppressed by filters.

Retain before/after measurements with identical fixtures, viewport, CPU/network
throttling and cache state. Report sample counts and distributions rather than
claiming laboratory results establish field percentiles. Guard production browser
checks with DNT/GPC, block writes and resource row/profile/export requests, and use
isolated fixtures for stateful table/preparation checks. Any real collection
canary must be bounded and identified in private release evidence.

Test the collector's zero CLS, missing INP, short interactions, late values,
visibility transitions, BFCache, same-document navigation, retries and reordered
revisions. Native tests must prove idempotence, complete-snapshot replacement,
unchanged original dimensions, website/method isolation, existing authorization,
nullable metrics, per-metric counts and legacy access. Preserve a dated aggregate
baseline and the new methodology start time; the populations are not directly
comparable.

## Rollout

Use the existing release lock and service-user ownership. Record the clean
application commit, analytics symlink target, service identities, configuration
hashes and any pre-existing health failures. Require sufficient capacity above
the existing physical floors for backups and both isolated builds. Take fresh
application and analytics dumps under the existing backup lock, validate their
manifests, and independently verify encrypted off-host round trips twice before
production changes. Preserve prior source/assets/configuration and rollback
evidence.

1. Stage the exact reviewed application release as its application user. Install
   both lockfiles and run the complete verifier. Compare the compiled artifact
   with the browser-tested build, including `asset-manifest.json`.
2. Copy the current compatible analytics release to a new isolated release
   directory as its owning user. Run the overlay's full hash guard before applying
   it. Preserve unrelated customizations, authentication, lockfiles and credentials.
   Install frozen dependencies and build with database migration disabled; never
   let a staging build migrate production implicitly. Run native tests against
   the disposable analytics database before the release reaches this step.
3. Apply analytics migration `25_canquery_performance` explicitly with the native
   migrator and production analytics identity. It adds nullable method, revision
   and navigation-type fields plus a revision constraint. Its bounded transaction
   refuses busy locks instead of waiting indefinitely. Review any failed migration
   state before retrying. Do not resolve a genuinely partial migration blindly.
4. Set `CANQUERY_PERFORMANCE_WEBSITE_ID` only in the analytics service environment
   to the intended existing CanQuery website UUID. Atomically switch the analytics
   symlink and restart only analytics. Verify authenticated Performance reporting,
   unchanged authorization/account-report behavior, and legacy collection before
   enabling the new browser collector.
5. Apply application migration `033_catalog_place_lookup.sql` with the
   application migrator as its service user. It adds a dataset lookup index with
   short lock/statement timeouts. Promote matching source/assets, retain old hashed
   assets, publish `asset-manifest.json` and `index.html` last, then restart only
   the API to replace its cached HTML/template/manifest and module caches.
6. Warm English then French featured previews with bounded metadata requests.
   Verify route assets/MIME/CSP, catalogue/search/pagination, corrected collection
   and per-metric counts, health, workers, ownership and unrelated-service
   continuity. Record pre-existing source failures separately. Do not reset job
   history or queue work to make health appear green.

No preparation pause, worker restart, source synchronization, store eviction,
schedule change, proxy change or storage-limit change is required. Existing
workers and their single-owner locks continue running. Keep all catalogue and
analytics migrations, snapshot pins, retirement coordination and physical floors.

## Rollback

Require the expected deployed application commit and analytics target, unchanged
captured configuration (apart from the declared analytics setting), and the
release lock. Restore the prior application source and frontend first, retaining
both releases' hashed assets and publishing the prior manifest/index last. Restart
only the API. This stops new corrected collector clients; already-open tabs may
continue sending their version until navigation/reload.

Keep the compatible analytics release and its website setting during an
application rollback. The old analytics report would combine persisted corrected
and legacy rows. The versioned wire type makes an old collector reject new
updates, but cannot repair that reporting incompatibility. A full analytics
rollback after collection begins therefore requires a separately tested
compatibility patch retaining method-separated reports; do not blindly restore
the old symlink. Corrected collection can be paused independently while preserving
the reporting boundary, as described in the analytics overlay README.

Keep the additive analytics columns/constraint and application index; do not
delete corrected rows, rewrite legacy samples, reverse migrations or restore a
whole database. Capture the rollback/pause time as a methodology boundary and
retain the prior analytics release and its recovery evidence.
