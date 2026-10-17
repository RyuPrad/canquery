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

## Crawl focus (October 2026)

The resource sitemaps list only data-bearing resource pages: a live DataStore
table, a prepared copy, a map, or a CSV/XLSX/XLS file CanQuery can prepare
within its configured caps (`dataBearingResource` in
`server/db/catalogSqlFragments.js`, sharing its caps with the capability
classifier through `ingestLimits()`). Every dataset page remains listed. A
download-only resource page carries `noindex, follow`: it repeats its dataset
page with one link added, so the dataset page offers that download directly and
stays the indexed landing page. Pages with a table or a map remain indexable.
The index and the catalogue hub pages carry `<lastmod>` (the newest catalogue
record change, read once an hour with the two counts; the newest guide update
for the blog file); documentation pages carry none. A crawl file that cannot be
built answers 503 with `Retry-After: 60`. Every snapshot opens with a section
nav that reaches both guide indexes, `/insights` lists the Top 100 before
JavaScript runs, internal links use the canonical dataset slug, `/organizations`
omits publishers without datasets, a disabled place is noindex, and
`/index.html` redirects to `/`.

After promotion, resubmit `https://canquery.com/sitemap.xml` once. The Search
Console "Excluded by noindex" count grows by design; "Discovered – currently
not indexed" should fall as the submitted set shrinks from about 329,000 to
about 115,000 URLs. Do not validate the noindex exclusions, and compare the
indexed count only against the new submitted total.

## Console review fixes (October 2026)

Search Console reported 954 resource pages as duplicates of other resource
pages and 34% of the 58,593 indexable resource pages shared their `<title>`
with another page ("Data dictionary (English, French, CSV table)" alone on 220
pages). A resource `<title>` now leads with its dataset's title when the file
name does not carry it ("Building Permits — Data dictionary (CSV live table)"),
using the whole dataset title or its first clause, never a fragment; when both
cannot fit it adds the dataset's year, and a short name still shared across
publishers ("Parks") gets the publisher. File-name style titles are cut at
their underscores or hyphens instead of ending in a mid-word ellipsis. The page
`<h1>`, breadcrumbs and API presentation titles are unchanged. On production
rows this lowers the share of indexable resource pages with a shared title from
34.4% to 29.3% and the titles ending in "…" from 1,133 to 217.

Crawl stats showed 73% of Googlebot's requests were JSON fetched while
rendering pages. `robots.txt` now also disallows the analytics beacon
(`/api/send`) and the footer's GitHub star count (`/web-api/v1/repo`,
`/api/v1/repo`); the reads a page renders from stay crawlable.
