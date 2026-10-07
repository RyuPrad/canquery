# Preparation value and failure-credit release

This is the migration 035 release record and the current accounting reference.
Its original CA$49 offer is historical. The current CA$9 offer and API-only paid
launch are defined in [Business live launch](business-nine-live.md); do not replay
this earlier worker/admission cutover for that price release.

This release keeps Free at 1,000 credits per UTC calendar month and Business at
CA$49/month plus applicable taxes, with 100,000 credits per paid billing cycle.
Both use the same supported data capabilities. The stronger CABIN preparation
example demonstrates decoding, importing and hosting a supported file; it makes
no measured time-saving claim. Initial founder email help covers inspecting one
existing supported resource and getting one query working. Interviews, real
customer onboarding, payment, reuse and completed reports remain unvalidated.

The authoritative costs are `CREDIT_COSTS` in `commercialConfig.js`. The complete
illustrated workflows cost 2 credits for inspect/query, 103 for inspect/new
preparation/polls/inspect/query, and 2 for later inspect/query. Direct repeat
queries cost 1 and an optional export adds 25. Cached successes remain billable.
An exhausted allowance rejects requests; there are no automatic overage charges.

## Accounting and compatibility

Migration 035 adds `commercial.preparation_charges` and publication receipts on
`ingest_jobs`. Admission still deducts its credits immediately. The durable debit
records its original request, job, payer, actual amount, period and charge time.
It survives the seven-day HTTP request retention. Debit fields and resolved
outcomes are immutable. Pending records have no age-based deletion; resolved
records are retained for thirteen months after resolution.

A job's successful table publication and receipt commit together. Zero-row
publication is successful. Terminal failure without that publication reverses
the actual original debit once, in the same transaction as the terminal job
transition. Retries remain charged until a final outcome. Failed refreshes return
the refresh charge even if an older table remains available. Subsequent expiry or
eviction does not reverse successful preparation. Original-period usage is
reduced; a reversal after rollover creates no new-period credits. Missing,
ambiguous or inconsistent debit evidence never authorizes invented credits.

Shared/current preparation calls, job polls, activity and unmetered browser
requests have no preparation debit and cannot receive a reversal. Free-plan
accounts that actually paid preparation credits are eligible for reversal.
Subscription payments, invoices and cash refunds are outside this policy.

Resource lock → job lock → commercial meter → debit/period is the lock order.
Normal request maintenance never acquires resource locks under the meter. The
API's existing maintenance loop separately reconciles at most 100 eligible
receipt/terminal charges per pass, skips busy resources and retains exceptions.
It never turns an old heartbeat or stopped client polling into a failed job.
Only the established single worker recovers abandoned running jobs.

## Verification before release

Run the full application verifier serially, with `VITEST_MAX_WORKERS=2` when
needed for shared-host contention. Apply all migrations to a disposable
PostgreSQL 16/PostGIS 3.5 database. Point `CANQUERY_DATABASE_URL`,
`SPATIAL_TEST_DATABASE_URL` and `COMMERCIAL_TEST_DATABASE_URL` at that same
isolated database. Run the five existing Jest database suites, followed by:

```bash
# From server, with all three disposable database variables explicitly set
node --test --test-concurrency=1 integration/*.test.cjs
```

Verify both exact PR-head and deployable-merge CI. Retain logs, including initial
failures. Accounting coverage includes concurrent duplicates, final failures,
internal retries, actual original amounts, transaction interruption, old-period
reversal, adoption ambiguity, retained debit evidence, empty publication, failed
refresh, post-publication eviction and ordinary/cache/export accounting.

Run the documented CABIN sequence through a real isolated ingest worker and
query endpoint. Record source-file retrieval, preparation and API-result times
separately, compare the displayed result with the API response, and verify the
103-credit ledger change. Use only one worker against that disposable queue.

Exercise signup, email verification, key creation, a successful query and Free
usage with isolated accounts. Use Stripe sandbox for hosted Checkout, signed
webhook activation and portal cancellation; verify amount/currency and access
through the already-paid period, then Free fallback with isolated period-boundary
fixtures. Redirecting back from Checkout must not itself grant access.
For flexible subscriptions, period-end cancellation may be represented by
`cancel_at` matching the subscription item's `current_period_end` while
`cancel_at_period_end` remains false. Verify the portal's disclosure and actual
scheduled timestamp; paid-invoice periods continue to govern CanQuery access.

Capture pricing/docs/auth/account screenshots and exercise Chromium and WebKit,
English/French, both themes and narrow/wide screens. Include keyboard navigation,
copy examples, credit/refund explanations and meaningful initial HTML without
JavaScript. Never include credentials or private account records in screenshots.

## Cutover

Use the current private operating guide for installed host identities, service
names, paths, backup procedure and permissions. Public examples below assume the
application user's server directory; they must use its actual database and
installed environment. Keep command output in a new private evidence directory
outside Git. Do not use a historical release helper against a new commit.

1. Verify clean intended source and production commits, service ownership,
   process identities, configuration/cron hashes, current queue and accounting
   inventory, migration state, and disk headroom. Retain any existing unrelated
   health failures. Preserve the 35 GiB ingest and 30 GiB map floors, budgets,
   pins, idle expiry, reader-safe retirement and PostgreSQL settings.
2. Stage the exact release as the application user, run the full verifier and
   required disposable database/browser checks, and compare every build artifact
   with the reviewed browser-tested build. Retain source, logs and receipts.
   Exact staging may precede fresh release backups. Restore capacity by reviewed
   retention before staging or dumps if safeguards refuse them; never lower
   the floors.
3. Take fresh application and analytics backups under the installed backup lock,
   validate both manifests and independently verify encrypted off-host round
   trips twice. Complete these checks before admission/configuration changes,
   migration 035 or source/assets promotion; staging verification alone is not
   the backup gate.
4. Freeze **both** new admission interfaces. `AUTO_PREPARE_ENABLED=false` pauses
   `/prepare` only; it does not pause `/ingest`. Install a reviewed temporary
   ingress guard rejecting POSTs to both `/resources/:id/prepare` and
   `/resources/:id/ingest` under `/api/v1` and `/web-api/v1`. Verify all four
   routes reject before reaching the API. Account for loopback/direct script
   entry points and the Top 100 seed schedule; do not run an enqueueing script
   during cutover. Preserve ordinary reads and activity keepalives.
5. Gracefully stop the old ingest worker and wait for its current job to finish.
   Record its final state and the remaining jobs. Jobs completed before cutover
   retain the old policy; this release performs no blanket historical refunds.
   Do not force termination to shorten a preparation. If shutdown exceeds its
   grace period, retain the evidence and resolve publication uncertainty before
   assuming that any remaining attempted job failed.
6. Apply migration 035 as the application user while admission is frozen and
   the worker is stopped. Install matching API/worker source and matching client
   assets. Retain older hashed assets; publish manifest/index last. Start the
   compatible API with admission still frozen. The map worker, analytics,
   mail and other applications do not require a release restart.
7. Preview cutover adoption using the new code. This command performs no writes,
   including no environment-bootstrap write:

   ```bash
   # From server; private output path selected for this release
   node scripts/commercial-admin.js preparation-adoption > "$RELEASE_EVIDENCE/preparation-adoption.json"
   ```

   Review each candidate and preserve the preview. Automatic adoption accepts
   only a **never-claimed pending job** (`attempts=0`, no claim or publication)
   with one retained positive charged preparation request, the matching original
   account/period, and sufficient recorded original usage. Running or retried
   old jobs have `publication_uncertain`: before receipts existed, a worker
   could have published and then crashed. Their debit alone does not prove that
   publication never succeeded. Missing/ambiguous debit or publication evidence
   requires a separately reviewed decision and receives no automatic reversal.

   Apply only the reviewed eligible pairs:

   ```bash
   node scripts/commercial-admin.js preparation-adoption "$RELEASE_EVIDENCE/preparation-adoption.json" --apply
   ```

   Apply rechecks the exact job/request pair under locks and commits each adopted
   job separately. If a later candidate changed or became busy, earlier adopted
   jobs remain committed. Inspect the ledger and create a fresh preview before
   retrying; do not replay an obsolete batch. With no eligible candidates there
   is no backfill. Never hand-edit debits to manufacture eligibility.
8. Start the compatible single ingest daemon. Do not launch an additional
   `--once` or convenience queue worker. Verify process ownership, lock-owned
   recovery, preparation accounting and the API maintenance loop. Restore the
   captured admission configuration and remove only this release's temporary
   ingress guard. Record the exact source/deployed commits, UTC times and changes.

Live checkout remained disabled at this release. Its sandbox verification did
not activate live billing. The subsequent CA$9 launch has its own reviewed Stripe
price, signed webhook, portal, business/tax preflight and compatible rollback in
[Business live launch](business-nine-live.md). No cash-refund behavior is added
by the preparation-credit policy.

## Production acceptance and rollback

Production browser acceptance uses DNT/GPC, blocks non-GET/HEAD writes and blocks
stateful resource query/profile/export reads. Verify pricing/docs initial HTML,
key/account navigation, OpenAPI weights, credit examples, public metadata and
original-source links without admitting preparation. Use isolated fixtures for
account mutations, paid activation and table work. A production preparation
canary requires an explicitly bounded resource/account decision and must run
through the existing daemon; it is not required merely to take screenshots.

Read health/ops, both worker states, disk, accounting status and deployment
ownership after promotion. Confirm unrelated service process continuity. Check
that the reconciliation backlog clears for terminal/receipted jobs; investigate
missing jobs or repeated accounting exceptions without erasing history. Verify
configuration and cron hashes, allowing only the recorded release changes.

Rollback must preserve application migrations 001–035, analytics migration 25,
publication receipts, debit/outcome history and original-period reversals. Once
new or adopted charges exist, an unmodified previous worker/API is incompatible:
it cannot maintain the new success/refund boundary. Prefer a forward fix or
restore only the previous frontend while keeping compatible API/worker code.
A backend backout requires a reviewed compatibility build retaining admission
ledger writes, publication receipts, terminal settlement and reconciliation.
Freeze both admission routes and gracefully stop the worker before changing its
code; restart compatible services before reopening admission. Do not restore a
whole database, reverse migration 035, replay an older rollback helper, replace
newer configuration, lower storage safeguards or delete unresolved charges.

## Observe the first customer experiment

Use the owner's account page for current net usage, returned credits and the
bounded reversal history. The history identifies the original period: a returned
old-period credit will not increase today's remaining allowance. For private
operations, these commands are read-only and do not bootstrap billing:

```bash
# From server; output contains private account and billing references
node scripts/commercial-admin.js status
node scripts/commercial-admin.js inspect ACCOUNT_UUID
```

`status` reports unresolved/terminal charges, missing jobs and reversal totals
alongside existing mail/billing/lease health. `inspect` returns up to 24 periods,
100 preparation charges and 30 days of daily usage. Detailed requests last seven
days, daily usage thirteen months, resolved preparation records thirteen months
from resolution, and unresolved preparation records until resolved.

For a private, bounded investigation use `psql` with a real account UUID and the
correct installed database. These statements read no API keys, raw queries,
visitor addresses or publisher-row contents:

```sql
\set account_id 'ACCOUNT_UUID'
BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;
SET LOCAL statement_timeout = '30s';

-- Earliest retained successful data request: only the last seven days survive.
SELECT min(created_at) AS first_retained_success, count(*) AS successful_requests
FROM commercial.requests
WHERE account_id = :'account_id'::uuid AND state='charged'
  AND operation IN ('query','aggregate','export')
  AND created_at >= now()-interval '7 days';

-- Separate UTC usage days provide repeat-use evidence, not separate sessions.
SELECT day,operation,requests,credits AS gross_credits
FROM commercial.usage_daily
WHERE account_id = :'account_id'::uuid AND day >= current_date-30
  AND operation IN ('query','aggregate','export') AND requests>0
ORDER BY day,operation;

-- Keep the original charge period alongside each outcome or reversal.
SELECT c.job_id,c.credits,c.charged_at,c.outcome,c.resolved_at,
       p.starts_at,p.ends_at,j.status,j.attempts,j.published_at
FROM commercial.preparation_charges c
JOIN commercial.periods p ON p.id=c.period_id
LEFT JOIN ingest_jobs j ON j.id=c.job_id
WHERE c.account_id = :'account_id'::uuid
ORDER BY c.charged_at DESC LIMIT 100;

-- A paid invoice grant establishes activation, not completed customer work.
SELECT plan,starts_at,ends_at,invoice_id,allowance,used,revoked_at
FROM commercial.periods
WHERE account_id = :'account_id'::uuid AND plan<>'free'
ORDER BY starts_at DESC LIMIT 24;
COMMIT;
```

A successful request identifies a candidate useful query. Confirm with the
customer whether it produced their intended result. Request records cannot prove
that a report was completed, a dashboard was shipped or time was saved.

The founder still needs to find three to five people using comparable files,
observe their current workflow, demonstrate the same task, measure work removed
and remaining, offer the current Business plan where appropriate, and check whether
they use it again for real work. No outreach, interview, purchase or demand
validation is implied by the implementation or its test traffic. Keep those
outcomes explicitly uncompleted until real evidence exists.
