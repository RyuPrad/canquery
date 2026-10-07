# API indexing and catalogue discovery

This release keeps developer and website API responses crawlable for rendering
while returning `X-Robots-Tag: noindex`. An unprepared CSV export still returns
409; it does not enqueue preparation for a crawler. Browser CSV exports carry
`rel="nofollow"`. Public resource pages remain self-canonical and indexable.

Recognized English/French download boilerplate uses the parent dataset subject
in resource presentation, metadata, breadcrumbs and structured data. File
language, format and meaningful qualifiers remain visible; publisher metadata
is unchanged. Pricing and terms join the static sitemap. Existing Toronto and
Uxbridge guide editions and API documentation gain relevant reciprocal links;
guide publication dates and URLs stay stable.
Initial HTML wraps long inline examples and scrolls code blocks locally so
documentation remains usable on narrow screens with JavaScript disabled.

## Verification

Run the standard release verifier and all three CI jobs on the exact head and
merge commit. Check API headers on successful JSON/CSV, conditional responses,
authentication, rate, validation and unavailable-resource errors, including
accepted case/trailing-slash aliases. Validate contextual titles, canonical
URLs, original downloads and structured data without changing source records.

Use isolated HTTPS fixtures for Chromium/WebKit, English/French, narrow/wide
screens and no-JavaScript checks. Production browser acceptance enables DNT/GPC
and blocks non-GET/HEAD requests plus query/profile/export GETs that may renew
snapshots or record popularity. Inspect the affected public HTML and metadata,
not a successful production export or preparation flow.

## Promotion and recovery

Follow `DEPLOY.md` using a fresh clean reviewed main commit and exact staged
artifact. Capture installed commit, configuration hashes, service identities
and frontend assets privately. Verify capacity at the existing storage floors.
Take application and analytics backups under the established backup lock,
validate manifests and independently verify encrypted off-host copies before
promotion. Keep these receipts and Search Console data outside the repository.

No migrations, dependency changes, billing changes or worker restarts are
required. Preserve account/preparation ledgers, auth secret, live price and
Stripe settings. Publish matching assets while retaining previous hashed files,
with manifest and index last; restart only the API. Verify health, expected ops
state, configuration hashes and unrelated service continuity afterward.

Prefer a forward correction if acceptance fails. A scoped code/frontend
recovery may use the captured current CA$9-compatible baseline after checking
for intervening changes. Never restore the database or an older environment,
reverse migrations, clear queue failures, or replay historical billing helpers.

## Search Console follow-up

Inspect the exact reported URLs. Intentional redirects, alternate canonicals,
deleted-resource 404s and private-page exclusions do not need blanket
validation. Request indexing only for the selected changed public pages, not
the API export. Google must recrawl before reports can reflect this release;
submission does not establish indexing or a traffic improvement.

Retain a dated release annotation, pre-release inspections and finalized
28-day Search Console baseline privately. Keep URL-prefix and domain
properties distinct, and page/query breakdowns separate from property totals.
Preserve existing frozen cohorts. Compare a separate complete 28-day period
starting on the first full Pacific calendar day after deployment, once all
dates are finalized; account for other releases and recrawling lag.
