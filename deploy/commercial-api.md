# Developer API accounts and billing

The website uses `/web-api/v1` without an account. Developer integrations use
`/api/v1` and `Authorization: Bearer $CANQUERY_API_KEY`. The public website is
not a scraping prevention boundary. `/healthz`, `/api/v1/ops`, and
`/api/v1/openapi.json` remain public. Resource query, file admission, storage,
export, and map ceilings still apply to every plan.

| Plan | Credits | General requests/min | Keys | Concurrent expensive requests |
| --- | --- | --- | --- | --- |
| Free | 1,000 per UTC calendar month | 30 | 1 | 1 |
| Business | 100,000 per paid billing cycle; CA$49/month plus applicable taxes | 300 | 5 | 2 |
| Enterprise | Finite negotiated paid service period | Reviewed, initially at most 300 | At most 100 | Initially at most 2 |

The global commercial expensive-request ceiling is four. This is an admission
bound, not a throughput or availability guarantee. Existing lower endpoint
limits still apply: profiles 20/min, exports 10/min, aggregates 30/min, map
viewports 60/min, tiles 240/min, and legacy ingestion 5/hour. New automatic
preparations have a durable 20/account/hour limit and the existing shared queue
ceiling. Failed credential attempts also have a process-local IP abuse limit.

Metadata, rows and tiles cost one credit; aggregation, profiles, map viewports
and featured previews cost ten; CSV exports cost 25. A newly admitted
preparation costs 100, committed atomically with its job. Joining an existing
job, a current copy, job polling and activity cost zero. A successfully admitted
job keeps its charge even if later publisher preparation fails. HTTP failures
and interrupted non-preparation responses refund reservations. There is no
automatic overage charge or rollover. Responses expose allowance, remaining
and reset headers; remaining is the admission-time balance including held
reservations. The account page shows current usage.

## Components and lifecycle

Migration 034 creates `canquery_auth` for Better Auth and `commercial` for
accounts, hashed keys, immutable billing periods, usage reservations, short
rate windows, daily usage, durable webhook identities and encrypted mail.
Better Auth 1.7.7 runs through an isolated ESM module in the CommonJS server.
Email verification is required; signup records accepted terms and time.
Password resets expire in 30 minutes, are single-use and revoke sessions.
Sessions last seven days. PostgreSQL stores HMAC IP buckets for auth throttling,
not raw IP/user-agent values. Account pages omit analytics and heatmap bootstrap.

Keys contain 32 random bytes. Only their SHA-256 digest and a short display
prefix are saved. Creation returns the secret once; neither browser storage nor
account metadata retains it. Revocation is immediate for new admissions.
Downgrades keep the oldest eligible keys enabled and retain the other keys
disabled until the allowance changes or the owner revokes them.

Each keyed request reserves credits in PostgreSQL under a short transaction
lock. Expensive reservations also enforce account/global concurrency. The lock
is released before upstream requests or response streaming. Five-minute leases
and a four-minute response deadline bound crashed requests; normal completions
settle once. Maintenance runs serially every five seconds, recovers expired
leases, sends queued mail and reconciles billing. Detailed request records last
seven days, daily aggregates thirteen months, rate buckets at most two days and
processed webhook identities ninety days. Billing period/Stripe references
remain for account reconciliation. No query contents are recorded by this meter.

Mail links are AES-256-GCM encrypted with a key derived from the auth secret.
Messages are deleted on SMTP acceptance, expire after one day and stop after
five bounded retries. The outbox's user reference is application-managed:
Better Auth can invoke it before its separate user transaction commits, so a
cross-connection foreign key would deadlock signup. Account deletion removes
unsent mail explicitly. [Mail operations](mail/README.md) covers the sender.

## Stripe configuration

Use a separate database for each mode. Startup pins the database to `sandbox`
or `live` and refuses a mode mismatch. Pin the Stripe SDK and API version in
`billingService.js`; test API behavior against the installed version before an
upgrade. A Business price must be active CAD 4,900 cents, recurring monthly.

Use hosted subscription Checkout with flexible billing and dynamic payment
methods. The integration explicitly selects standard Stripe Billing with
`managed_payments.enabled=false`; Managed Payments merchant-of-record setup
requires a separate eligibility and commercial decision. Checkout reuses open
sessions, binds customers to owner accounts, uses idempotency keys and refuses
duplicate active/past-due subscriptions. The portal configuration enables
invoice history, payment/address updates and cancellation at period end. Keep
self-service price/quantity changes disabled for the single Business plan.

Configure the signed endpoint `/api/stripe/webhook` for `invoice.paid`,
`invoice.payment_failed`, `customer.subscription.created/updated/deleted`,
`checkout.session.completed`, and `checkout.session.async_payment_succeeded`.
Save its signing secret privately. The raw-body route validates signatures and
mode before persisting event identity; it never stores complete event payloads.
Processing reads current paid invoices from Stripe. Only the matching recurring
line grants its dated period; duplicate/reordered events cannot reset usage.
The success redirect grants nothing. A periodic reconciliation repairs missed
events. Past-due/cancelled accounts fall back to their current Free allowance
when already-paid periods end. Refunds and disputes need a reviewed support
decision; they do not silently erase paid-period history.

For local testing, use a capture SMTP server, HTTPS preview and Stripe CLI
forwarding. Keep sandbox keys and the CLI signing secret in an ignored/private
environment. Never run destructive integration fixtures against the preview's
customer database or production. Test Checkout payment, signed webhook delivery,
duplicate events, failed payment, portal cancellation, quota renewal/fallback,
and account deletion. Billing and Invoicing are used here; Terminal, Identity
and Issuing are not needed for this online API subscription.

## Verification and operations

Run `npm --prefix server run verify`. Separately migrate a disposable PostgreSQL
16/PostGIS 3.5 database, set `CANQUERY_DATABASE_URL`,
`SPATIAL_TEST_DATABASE_URL` and `COMMERCIAL_TEST_DATABASE_URL` to that same
database, and run `node --test integration/*.test.cjs` from `server`, plus the
five database suites in CI. Never combine fixture cleanup with a sandbox
preview that is actively exercising real Stripe objects.

`node scripts/commercial-admin.js status` reports delayed mail, billing retries
and expired request leases without customer details. `inspect ACCOUNT_UUID`
shows private account/period state. Monitor this along with API logs and SMTP
queue/service status. A healthy catalogue endpoint alone does not establish
email or billing health.

`customer`, `suspend`, `resume`, `delete-account` and `grant` preview by default. Add
`--apply` only within an authorized, reviewed account operation. Deletion first
suspends access, expires open Checkout sessions and cancels subscriptions;
only then does it remove auth credentials/sessions and revoke keys. Stripe
failure leaves the identity intact and suspended for a safe retry. Retain
financial references under the applicable retention policy.

For Enterprise, create/reuse the account's Stripe customer with
`node scripts/commercial-admin.js customer ACCOUNT_UUID --apply`, then issue a
negotiated invoice to that customer.
Once it is paid, supply a private JSON file with `invoice`, ISO `start`/`end`,
integer `credits`, `keys`, `rate`, and `concurrency`:

```sh
node scripts/commercial-admin.js grant ACCOUNT_UUID PRIVATE_GRANT.json
node scripts/commercial-admin.js grant ACCOUNT_UUID PRIVATE_GRANT.json --apply
```

The command verifies paid status, currency, mode and customer ownership, and
refuses changing a previously granted invoice. Grants are finite (at most one
year). Raising the initial capacity envelope requires a reviewed code change
and representative load verification.

## Release and rollback boundary

Confirm production's commit/configuration and preserve existing work. Follow
the project's release process: fresh locked application/analytics backups,
validated encrypted off-host copies, exact staged source/build verification,
disposable DB checks and Chromium/WebKit acceptance. Stage as the application
user. Apply 034 before enabling accounts; keep the database mode and private
secrets separate from source. Install matching server/client assets with old
hashed assets retained and index published last.

Keep `COMMERCIAL_API_ENABLED=false` until auth, mail, operations and pricing are
ready. Live checkout additionally requires `STRIPE_LIVE_READY=true` and
`STRIPE_TAX_REVIEWED=true`. Only enable Stripe Tax after confirming the actual
business registration facts and active Stripe Tax registrations; toggling
automatic tax alone does not establish collection obligations or readiness.

For a Free-account launch, set `COMMERCIAL_API_ENABLED=true`, `STRIPE_MODE=live`
and the production HTTPS `SITE_URL`, with a new private auth secret and working
authenticated SMTP. Keep `STRIPE_LIVE_READY=false`, `STRIPE_TAX_REVIEWED=false`
and the tax collection/confirmation flags false. Leave the Stripe secret,
Business price, portal configuration and webhook signing secret unset until the
paid launch is reviewed. Free accounts do not require Stripe credentials;
billing maintenance skips remote work without them. Pricing shows Business as
coming soon, and checkout must return `BILLING_UNAVAILABLE` without creating
Stripe objects. Preserve the live database mode when enabling billing later.

Do not set `API_KEY_REQUIRED_AT` until an actual 30-day migration notice begins.
Use its UTC end timestamp; old anonymous integrations receive Deprecation/Sunset
headers during the window. The website continues using `/web-api/v1` afterwards.

For rollback, first disable new checkout/admission as appropriate and drain
request reservations. Keep migration 034, all account/billing/usage data,
signing secrets and the previous environment separately. Do not restore an old
whole database or bypass an already-announced authentication requirement with
old server code. Roll back a compatible application build, preserving billing
webhook processing or a reviewed reconciliation path and paid access. A code
backout cannot undo paid subscriptions; cancel those only through a separately
authorized customer/billing action. Existing data-storage safeguards, source
jobs, maps and unrelated services retain their established boundaries.
