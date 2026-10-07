# API developer experience

This release clarifies the Free, Business (CA$49/month) and Custom & Enterprise
offers for recurring reports and dashboards. It improves pricing, account and
authentication layouts and replaces the abbreviated API documentation with
executable quickstarts, a Toronto reporting workflow, capability guidance and
a searchable OpenAPI reference. Initial HTML includes pricing and API guidance.

Existing quotas, credit costs, account authentication, query behavior and Stripe
contracts remain authoritative. Business provides email guidance. Custom work
and contractual commitments require a separate scope. This release adds no
chart-rendering service, SDK, dependencies, migrations or billing activation.
Checkout continues to follow the installed live-readiness flags.

## Verification

Run `npm --prefix server run verify` serially; bound client concurrency with
`VITEST_MAX_WORKERS=2` on a shared host. Confirm all CI jobs on the exact reviewed
head and deployable merge, including disposable PostgreSQL/PostGIS and commercial
integration suites. Retain initial failures and distinguish harness corrections
from application fixes.

Check Chromium and WebKit in English/French, light/dark, narrow/wide layouts.
Review screenshots of pricing, docs, account and authentication routes. Exercise
copy/manual-copy feedback, docs search and anchors, examples, reference retry,
password visibility, missing/expired links, key creation and revocation focus.
Use isolated account fixtures and intercept all auth/key writes. Verify emitted
curl, Python standard-library and server-side JavaScript examples against a local
HTTP fixture; never put a real key into screenshot fixtures.

Verify meaningful pricing/docs initial HTML without JavaScript. For production
browser acceptance, enable DNT/GPC and block non-GET/HEAD methods and stateful
resource query/profile/export reads. Metadata examples require an explicit click;
page visits must not prepare a file or consume developer credits. Public OpenAPI
responses use `no-store` and match the installed anonymous compatibility/cutoff.

## Promotion

Follow the private operating guide's current release procedure. Confirm clean
production and remote commits, configuration hashes, process identities and
sufficient disk headroom. Preserve storage floors and current rollback material.
Capture fresh application/analytics backups under the existing backup lock,
validate manifests and independently verify encrypted off-host copies twice.

Stage the exact deployable merge as the application user. Install locked
dependencies, run the full verifier and compare every built file with the
browser-tested artifact. Retain source, build and verification receipts. Promote
source and matching assets, retain older hashed assets, and publish the manifest
and `index.html` last. Restart only the API because it caches the SPA template and
loads server documentation/presentation code at startup.

Preserve installed account/auth secrets, migration 034 and analytics migration
25, Stripe mode/readiness flags, workers, schedules, mail services, source state,
storage budgets/floors and unrelated applications. Record existing operational
failures separately; this release performs no source or queue recovery.

Check health, ops, public documentation, account navigation, ownership and
unrelated-service continuity after promotion. Keep exact commits, dates, backup
receipts, screenshots and command logs in private evidence. Update affected
current sections of the private Google Doc and add one concise history entry.

## Rollback

Use a release-specific guarded helper with the expected clean deployed commit,
captured configuration hashes and prior source/build. Restore compatible prior
source and frontend as the application user, retain both generations of hashed
assets, publish `index.html` last, then restart only the API. Verify the same
public flows and service continuity. No database restore, migration reversal,
environment restoration or worker restart is required. Do not replay an older
whole-release rollback script against a newer deployment.
