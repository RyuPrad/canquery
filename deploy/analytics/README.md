# CanQuery performance analytics overlay

This overlay adds idempotent, standards-based CanQuery Web Vitals to the existing
Umami Performance dashboard. It targets the reviewed Umami 3.3.1 installation
with the Mochi account-report overlay at commit `d8915204e49ef8b6fb21e3705af1660f1b4cd8a9`.
The original Umami MIT license is retained in [LICENSE.umami](LICENSE.umami).
Files under `files/` preserve their upstream attribution and are installed at
the corresponding path in an isolated copy of the analytics source.

## Collection and reporting contract

The CanQuery client bundles exactly `web-vitals@6.2.2`, registers the five standard
callbacks once per document, and disables Umami's legacy performance observer
for CanQuery only. It honors DNT/GPC and `umami.disabled`; query strings, fragments,
element text and stable visitor identifiers are not added to performance payloads.
Existing page views, product events and heatmaps retain their existing collector.

The existing `POST /api/send` accepts a new `type: "performance-v2"` payload
with a required `performance` object:

```json
{"id":"navigation UUID","revision":1,"method":"web-vitals-v1","navigationType":"navigate"}
```

For this protocol, `id` is an ephemeral navigation identity; it is not an account
or visitor identity. Each delivery includes the complete known metric snapshot,
the captured document pathname/title and its original timestamp. The server
derives an event UUID from the website, method and navigation UUID. A single
atomic PostgreSQL upsert accepts only a newer revision; retries and reordered
requests do not create additional samples. A newer INP may legitimately decrease.
The original date, route, title and session dimensions remain attached to the row.
The new wire type deliberately makes older collectors reject updates on rollback,
rather than silently appending them as duplicate legacy samples. Storage remains
the existing native performance event type 5.
Absent metrics remain NULL; an observed zero CLS remains zero. A BFCache restore
starts a new identity and timestamp; SPA history changes do not reset metrics.

Corrected payloads are accepted only for `CANQUERY_PERFORMANCE_WEBSITE_ID` on the
PostgreSQL backend. Timing values must be finite, nonnegative and at most
86,400,000 ms (24 hours); CLS is bounded by the existing `DECIMAL(10,4)` storage
capacity, 999,999.9999. Values are never clamped. These explicit ingestion bounds
replace the legacy 60-second/100 limits for corrected CanQuery payloads. Legacy
clients and other websites retain their original limits and append-only path.
Client network failures receive at most one retry with identical data, only
while visible and if a newer complete snapshot has not superseded the request.

The native report accepts `parameters.method` as `corrected` or `legacy` for
CanQuery. Its default is corrected (`performance_method = 'web-vitals-v1'`);
legacy (`performance_method IS NULL`) remains selectable separately. Methodology
is applied consistently to summary, time series and route/device/browser tables.
The UI displays metric-specific sample counts, valid zeros and no-data gaps.
Corrected document-level metrics are a new baseline and must not be presented as
directly comparable to the former ten-second/SPA-route sampling.

## Build and verify

1. Copy the installed **source** into a new isolated stage; do not copy environment
   files, dependency directories or build outputs. Preserve its Mochi marker and
   all existing source. `base-manifest.json` pins the source to be replaced, its
   previous migrations and unrelated Mochi/auth/tracker files.
2. Run `python3 deploy/analytics/apply.py STAGE` to verify, then repeat with
   `--apply`. The tool refuses the live release and validates every file before
   writing. Keep its `.canquery-performance-overlay.json` receipt.
3. As the analytics service user, install the existing frozen pnpm lockfile in
   that stage. No analytics dependency upgrade is part of this overlay. Set up a
   **disposable** local PostgreSQL database named `analytics_performance`; set
   `DATABASE_URL` and `ANALYTICS_TEST_DATABASE_URL` to that same local database.
   Run `pnpm run build-db`, then `pnpm exec prisma migrate deploy`.
4. Run `pnpm exec vitest run src/canquery/performance src/app/api/send/route.test.ts`
   and `pnpm exec tsc --noEmit`. The integration tests refuse a nonlocal or
   differently named database. Run the inherited Mochi account-report tests and
   ordinary vendor tests relevant to the report/API changes.
5. Build the staged app with `pnpm run build-app`; this runs the Next build without
   migration or geo downloads. If using the vendor's full `pnpm build`, explicitly
   set `SKIP_DB_MIGRATION=1` and use a disposable database. Its `check-db` script
   otherwise automatically invokes `prisma migrate deploy`. Never run that build
   against production with the default migration behavior.

Repository-only overlay guard checks need no vendor installation:

```sh
python3 -m unittest discover -s deploy/analytics -p 'test_*.py'
```

Browser verification must exercise late interactions, real BFCache restoration,
zero CLS, original-route attribution, GPC/DNT, and unchanged normal collection.
Verify the actual native report for both methodologies, missing data, daily gaps
and zero-valued breakdowns. Confirm Mochi report access/auth and data collection
remain unchanged. Use isolated browser fixtures rather than real visitor data.

## Promotion and rollback

The runtime setting `CANQUERY_PERFORMANCE_WEBSITE_ID` is a public website UUID,
not a credential. Configure it only for the CanQuery website in the analytics
service environment. The application database and existing worker services are
unaffected by this overlay. Back up the analytics database and retain the previous
analytics source/build, environment and CanQuery frontend before promotion.
`CANQUERY_PERFORMANCE_COLLECTION_ENABLED=false` pauses only corrected collection
after the analytics service reload/restart. The endpoint returns `{disabled:true}`
before any collection writes and corrected clients stop sending. Existing reports
and legacy/Mochi collection continue; the default is enabled.

After the exact staged verification, run the reviewed additive Prisma migration
as the analytics service user through the explicit deployment step. Migration 25
adds three nullable fields and a positive-revision check atomically, with a
three-second lock timeout and thirty-second statement timeout. If contention
refuses the migration, retain the failure evidence and resolve/retry separately;
do not continue with a partial promotion or mark the migration applied manually.

Promote the analytics stage and restart only `canquery-analytics`, then verify
legacy collection and the new protocol using the controlled acceptance procedure
before publishing the matching CanQuery client. The shared analytics restart
briefly affects both dashboards/collectors; it does not restart the Mochi app.
Keep both source/build releases for rollback. Application publication must retain
the previous hashed client assets and publish its HTML entry point last.

For routine application rollback, restore the prior CanQuery client/HTML first,
retaining hashed assets, and **keep the compatible analytics backend and report
filters**. The previous analytics release's Performance SQL would blend stored
corrected and legacy rows because it has no methodology predicate. Do not restore
that unpatched dashboard after corrected collection has begun. If emergency
analytics rollback is necessary, first prepare and verify a compatibility build
that retains the CanQuery methodology filter; do not rewrite historical data to
fit an older report. Open newer clients may still emit `performance-v2`; an old
collector rejects that unknown type rather than appending duplicate legacy events.
Never delete additive columns or corrected historical rows. The database fields
are structurally backward compatible, but report semantics require this boundary.

Corrected rows deliberately retain event type 5: vendor traffic/session/realtime
queries exclude that exact type. A new numeric type would incorrectly count
performance updates as page views, particularly under old code.

Private field baselines, production configuration, acceptance traffic and
deployment receipts stay outside this public repository.
