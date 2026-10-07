# CA$9 Business live launch

This release changes Business to **CA$9 per month**, billed monthly by Stripe.
Its 100,000 operation credits, five API keys, 300 general requests per minute
and two concurrent expensive requests remain unchanged. Free keeps 1,000 credits
per UTC calendar month, one key, 30 general requests per minute and one concurrent
expensive request. Existing resource, preparation, export and map limits continue.
Operation weights and the 2-credit ready query, 103-credit new preparation example
and 1-credit direct reuse come from `commercialConfig.js` without price-specific
copies. There is no automatic overage charge or credit rollover.

The plan renews monthly until cancelled. The billing portal cancels at the end of
the paid period; earned Business access continues to its end, then falls back to
the current Free allowance. A Checkout return URL cannot activate access. Only a
verified matching paid invoice grants its service period. Account-credit returns
for failed preparation remain independent of subscription payments and invoices.

This is an API/frontend/environment release. No dependency, database migration,
worker, preparation admission, Caddy, mail, cron or storage-policy change is
required. Restart only the API. Preserve application migrations 001–035, analytics
migration 25, preparation publication receipts, original-period reversals,
existing paid periods and all storage safeguards. The prior release's worker
drain and temporary admission guard do not apply to this price launch.

## Review Stripe and the private environment

Before opening Checkout, establish the exact deployable commit and inspect the
current live database mode, customer references and paid periods. The first-live
launch procedure requires zero Stripe customer references, paid periods and
unprocessed Stripe events. If these conditions change, review their existing
prices and events instead of reusing the initial-launch assumptions. A previous
open Checkout session must match the current price, quantity, subscription mode
and automatic-tax setting before it can be reused. An incompatible open session
requires a scoped support review; do not create a competing session.

In the intended live Stripe account, verify all of the following:

- Payments and payouts are enabled and the required business details are submitted.
- One active Business product has the reviewed active live **CAD 900-cent** price,
  recurring monthly with interval count one. Create a new price when changing an
  immutable Stripe price; do not alter existing subscriptions without a separate
  customer decision.
- The selected live portal configuration allows invoice history, payment method
  and billing-address updates and cancellation at period end. Keep subscription price/quantity
  updates disabled.
- The enabled signed endpoint is `https://canquery.com/api/stripe/webhook`, using
  the pinned API version in `billingService.js`, and subscribes to `invoice.paid`,
  `invoice.payment_failed`, `customer.subscription.created`,
  `customer.subscription.updated`, `customer.subscription.deleted`,
  `checkout.session.completed` and `checkout.session.async_payment_succeeded`.
- The operator has reviewed the tax configuration. For this authorized launch,
  `STRIPE_TAX_ENABLED=false`; preserve the owner's existing registration scheduled
  for January 1, 2028. Do not activate, delete or reschedule it as part of release.
  A readiness flag records an operational review; it does not establish a tax
  obligation or substitute for the owner's registration decision.

Keep the secret key and endpoint signing secret outside chat, Git, screenshots
and command arguments. Hosted Checkout does not require a browser publishable
key. Prepare a private complete replacement environment file from the captured
current file, changing only these six settings:

```dotenv
STRIPE_SECRET_KEY=LIVE_SERVER_CREDENTIAL
STRIPE_BUSINESS_PRICE_ID=REVIEWED_LIVE_PRICE_ID
STRIPE_PORTAL_CONFIGURATION_ID=REVIEWED_LIVE_PORTAL_ID
STRIPE_WEBHOOK_SECRET=REVIEWED_ENDPOINT_SIGNING_SECRET
STRIPE_LIVE_READY=true
STRIPE_TAX_REVIEWED=true
```

Use actual private values, not these placeholders. Keep `STRIPE_MODE=live`,
`COMMERCIAL_API_ENABLED=true`, `STRIPE_TAX_ENABLED=false`, the existing tax
registration-confirmation flag, auth/mail secrets, database URL, source/storage
settings and anonymous API policy unchanged. Restrict the file to its owner.
Do not install it until the reviewed price and webhook are ready and the exact
new application is staged. Save only redacted readback and private hash evidence.

## Exact release and production acceptance

Use the established strict-host-key SSH access and release lock. Keep application
Git, npm, builds and generated assets owned by the application user. The private
release helpers require an explicit `--apply`; their default previews do not
create locks or evidence files.

1. Capture the clean previous commit, frontend, environment, unrelated
   configuration hashes and process identities. Check physical free space before
   creating release captures or backups. Reserve the 35 GiB floor plus the larger
   of 256 MiB or 1.25 times the latest scheduled dump for each database, plus
   capture space. If capacity is insufficient, stop and review a separate scoped
   remedy; do not lower floors or remove PostgreSQL files.
2. Run the complete verifier serially in an isolated exact-commit worktree as the
   application user. Match every built asset to the locally verified artifact.
   Retain exact-head/merge CI, disposable database tests and local HTTPS/CSP
   Chromium/WebKit checks. The ordinary verifier uses no production database.
3. Create fresh application and analytics dumps under the existing backup lock.
   Validate both manifests and complete two independent encrypted off-host
   ciphertext/decrypted-plaintext checks before promotion. Retain current release
   dumps and receipts. These hash checks are distinct from a restore drill.
4. Recheck the live Stripe objects against the private environment and reviewed
   source. Record the exact source commit, environment hash, price, portal,
   webhook, preserved tax registration and time. A stale preflight must be repeated.
5. Preview the guarded promotion. It requires the exact clean previous release,
   matching configuration/assets, fresh backup proofs, successful exact-commit CI
   and stage, sufficient capacity and an unchanged first-live billing inventory.
6. Promote source, publish new hashed assets while retaining old assets, and
   publish manifest and `index.html` last. Atomically install the reviewed
   application-owned private environment, then restart only the API. The brief
   restart is the only intended availability interruption. Workers, source jobs,
   mail, analytics, PostgreSQL, Caddy and Mochi continue with the same processes.
7. Verify health, ops, ownership, every new asset, retained old assets, unchanged
   unrelated configuration/process identities, and public plans reporting live
   mode, enabled Checkout, CAD 900/month and 100,000 Business credits. Verify
   pricing, signup, account and terms in both languages, narrow/wide screens,
   light/dark themes and both browsers. Account pages must retain tracking opt-outs.
8. Use isolated test accounts and Stripe test mode for payment, duplicate/reordered
   webhook, renewal, failed payment and cancellation/access tests. A production
   hosted Checkout inspection may verify the final live offer without paying.
   Any real charge, subscription cancellation, invoice refund or customer outreach
   needs its own authorization. Record paid activation as unverified until an
   actual matching paid invoice is observed; do not infer it from Checkout loading.

The private promotion helper records source/assets/environment checks without
printing credentials. It neither creates Stripe objects nor modifies registration
settings. Signed event delivery and invoice processing remain independently
observable through `node scripts/commercial-admin.js status` and the existing
private per-account `inspect` command. Record any delivery/reconciliation retry
instead of clearing it for appearance.

## Safe containment after Checkout can open

Closing **new Checkout creation** is the supported immediate backout. With exact
source/configuration guards, set only `STRIPE_LIVE_READY=false` and restart the
API. Retain the CA$9-compatible source, live price identity, secret key, webhook
signing secret, portal configuration, tax state, accounts, paid periods, usage,
preparation ledger and billing reconciler. Verify `/api/account/plans` reports
`checkout=false` while account access, portal and webhook processing remain.

Already-issued Stripe-hosted Checkout sessions can still complete after this
flag changes. Continue processing their invoices. Expiring a specific open
session, cancelling a subscription or refunding a payment requires a separately
reviewed action. Closing Checkout does not refund or cancel existing payments.

Do not restore the old whole environment or select the previous CA$49 backend
once a CA$9 payment is possible. That could disconnect the matching invoice
price and withhold earned access. A frontend or application regression needs a
compatible forward fix that preserves the CA$9 invoice processor; keep Checkout
closed during that repair. Preserve both generations of hashed assets. The
private `rollback-release.py` enforces this containment policy and never resets
Git or restores a database. Partial promotions and configuration drift must be
reviewed using their durable receipts before any recovery write.

## Founder validation remains open

The lower price is an offer to test, not evidence of customer demand or time
saved. Use the [existing preparation reporting](preparation-value.md) to observe
successful useful queries, preparation outcomes/returns, paid invoice activation
and use on separate days. A successful request does not prove report completion.

Find three to five people who already work with comparable files; observe their
process; demonstrate the same supported task; measure work removed and remaining;
offer the existing CA$9 plan where it fits; and check whether they return for real
work. Keep onboarding bounded to one supported resource and one working query.
Interviews, outreach, purchasing and measured benefits remain uncompleted until
there is real customer evidence.
