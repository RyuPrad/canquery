# API indexing and catalogue discovery

This release keeps developer and website API responses crawlable for rendering
while returning `X-Robots-Tag: noindex`. An unprepared CSV export still returns
409; it does not enqueue preparation for a crawler. Browser CSV exports carry
`rel="nofollow"`. Public resource pages remain self-canonical and indexable.
(Since November 2026 only resource and dataset pages with a table are
indexable: see "Index policy" below, which replaces what this section and
"Crawl focus" say about which pages are indexed and listed.)

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

Which pages are indexable and listed changed again in November 2026; see
"Index policy" below. At this release, the resource sitemaps listed only
data-bearing resource pages: a live DataStore
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

## Index policy (November 2026)

Google's November 2026 core update lowered the whole site in its results,
guides and hubs included. Until then about 123,000 catalogue pages were
indexable (every dataset page and every data-bearing resource page), and over
three months fewer than 300 of them had brought a visitor from search. Most
repeat the publisher's record with a download link. The catalogue pages a
search engine may index are now only those where CanQuery has a table a reader
can query on the page:

- **A resource page** is indexable when it has a live DataStore table, or a
  prepared copy that is pinned. An unpinned copy appears when a visitor opens a
  file and is evicted after a day without use, so it never counts: pages would
  move in and out of the index.
- **A dataset page** is indexable when at least one of its files is, or when a
  published guide (`datasetId` in `content/blog/index.json`) or a hub
  (`server/utils/datasetHubs.js`) is about it.
- **Later pages of a list** (`?page=2` and up, on `/datasets`, `/places`,
  `/organizations` and on dataset, place and organization pages) are
  `noindex, follow` with their self-canonical kept.

Every other catalogue page keeps working, keeps its structured data and its
links, and carries `noindex, follow`. The rule is written twice and tests keep
the two in step: `server/services/indexPolicy.js` for the pages, and
`INDEXABLE_RESOURCE` and `indexableDataset` in
`server/db/catalogSqlFragments.js` for the sitemaps and IndexNow. Place and
organization pages keep their own rule.

The regular sitemaps (`/sitemap-datasets-N.xml`, `/sitemap-resources-N.xml`)
list only indexable pages, and so does the daily IndexNow submission unless
the policy speaks to Google alone (see "Which search engines the policy speaks
to" below). An entry is dated
by its record's change, or by the pinned copy that made the page indexable when
that is newer, so a page a new pin brings into the index is fetched again. A
noindex tag
takes effect only when a crawler fetches the page again, so for 90 days from
the policy's date every page it turned noindex is listed in recrawl files,
dated by the change: `/sitemap-noindex-datasets-N.xml` and
`/sitemap-noindex-resources-N.xml`, 25,000 URLs each, built from one read per
family an hour and linked from the index while they have entries. After the 90
days those files answer 404 and the older rule covers these pages too:
`/sitemap-noindex-resources.xml` and `/sitemap-noindex-datasets.xml` list the
noindex pages Google showed in the latest 28 days of imported Search Console
data.

The policy's date is `POLICY_SINCE` in `server/services/indexPolicy.js`, or
`INDEX_POLICY_SINCE` in the API environment (a UTC time such as
`2026-11-16T07:59:59Z`; a malformed value stops startup). It must not be
earlier than the release that carries the policy. While it is still ahead, the
recrawl files date their pages by the time they are built; once it has passed
they carry it. A release that goes out after the built-in date sets the
variable to its promotion time, and so does another deployment adopting the
policy.

Known limits. A page that stops being indexable after the policy's date (a
publisher withdraws its live table, a pin is removed) is listed in the recrawl
files dated by the policy, which can be older than a crawler's last visit: it
is dropped at that crawler's next visit of its own. When a guide is published
for a dataset without a table, its dataset page turns indexable with its old
date: request indexing for it by hand. Only the API reads pins for a page
(`getResourceById(id, db, { pinned: true })`); the map worker's role cannot
read `pinned_resources`, so the shared read never names it unasked.

After promotion, resubmit `https://canquery.com/sitemap.xml` once and submit
none of the noindex files. In Search Console, "Excluded by noindex" and
"Submitted URL marked noindex" grow by about 115,000 by design: do not
validate them. The indexed count should fall toward the roughly 8,000 pages in
the regular sitemaps over the following weeks, as the recrawl files are read.
Sitemap chunk numbers above the new totals (`sitemap-datasets-2.xml`,
`sitemap-resources-2.xml` and up) answer 404.

The row sampler no longer reads CSV files that are not prepared, whose pages
are noindex: set `ROW_SAMPLE_FILES=true` in the scheduled jobs' environment to
sample them again, for example when `INDEX_POLICY_ENGINES=google` leaves those
pages to the other engines. Samples already stored stay on those pages.

### Which search engines the policy speaks to

The policy answers a ranking change at Google. Bing was not part of it: from
October 12 to November 13, 2026 it kept sending about two visitors a day, and
27 of the 65 clicks it reported by page had landed on pages the policy then
turned noindex (24 of them dataset pages without a table). A robots tag can
name one crawler, so `INDEX_POLICY_ENGINES` says who the policy's tag is
written for:

- `all`, the default: `<meta name="robots" content="noindex, follow">`, read by
  every search engine. Nothing changes from the rule above.
- `google`: the dataset pages and data-bearing file pages the policy turned
  noindex carry `<meta name="googlebot" content="noindex, follow">` instead.
  Google documents `googlebot` as the name that addresses its crawler alone
  and applies the rule as it applies the general tag. The other engines
  document `robots` and their own crawler's name (`bingbot`, `yandex`), so
  they find no tag addressed to them and may index the page.

Three kinds of page keep the general tag whatever the setting: a file page that
is only a download (it repeats its dataset page for every engine and has been
noindex since October 2026), later pages of a list, and pages that are noindex
for another reason (not found, empty hubs, employer pages). So with `google`,
engines other than Google get back the tags they had before the policy on
every dataset page and every data-bearing file page. Later pages of a list,
which the policy also turned noindex, stay noindex for everyone.

The sitemaps do not change, and they stay Google's: the regular files list the
pages Google may index, and the recrawl files list the others for 90 days,
which the other engines read as ordinary entries. After those 90 days an
engine other than Google learns of a page the policy keeps from Google only
through links and IndexNow.

IndexNow reaches Bing, Yandex, Seznam and Naver and never Google, so with
`google` the daily job sends what those engines may index: every dataset page
and every data-bearing file page whose record changed
(`listChangedCataloguePages`), as it did before the policy. The job reads the
setting from its own environment, so set it in the API environment and in the
scheduled jobs' environment; a value other than `all` or `google` stops the
API at startup and fails the job's run. The job's log line and its
`--dry-run` line name the list that was read: after setting the variable, run
`node scripts/indexnow-submit.js --dry-run` in the jobs' environment and check
that it says `list: catalogue` (`list: policy` with `all`). The API's side
shows on any dataset page without a table, whose tag is then named
`googlebot`.

Switching announces nothing by itself. Both lists share one watermark, so the
first run after the switch sends only the records changed in the last day or
two. A page another engine fetched while it carried the general tag comes back
at that engine's next visit of its own, or when its record next changes; for
the pages that matter, submit their addresses by hand (URL Submission in Bing
Webmaster Tools).

`server/services/indexPolicy.js` holds the rule (`policyEngines`,
`resourceRobots`, `datasetRobots`). The JavaScript rule decides a page's tag
and the SQL list decides what the job sends; `catalogDiscoveryIntegration.test.js`
compares the two on PostgreSQL file by file, maps, archives and the size and
count caps included. They can part only on values no source adapter writes: a
count written as `1e9`, as a decimal or with spaces, a file address that is not
an absolute `http(s)` one, or text after `.zip`. Such a page would be sent
while noindex, or indexable for those engines and never sent; no file in the
catalogue had one on November 15, 2026. A count too long for its integer type
is over any cap and cannot fail the read. To go back, remove the variable from
both environments and restart the API: every engine reads the tag again at its
next visit.

Whether an engine honours a tag addressed to another crawler is its own
choice. Bing and Yandex document only `robots` and their own names. Apple says
Applebot follows Googlebot's instructions when none mention it (it says so of
`robots.txt`; for the meta tag it names `robots` and `applebot`), and Brave
Search does not crawl what Googlebot may not, so either may treat the
`googlebot` tag as its own. After enabling, inspect one tagged page with URL
Inspection in Bing Webmaster Tools and confirm Bing may index it.

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

## Page indexing review, October 2026

Search Console's Page indexing report (update of October 22) listed 59K indexed
and 122K not indexed pages. Most reasons are by design: `/?keyword=` links and
`?highlight=`/`?view=` variants redirect or name their canonical, www and http
redirect to the apex, download-only resource pages carry `noindex`, and the
404s are resources and datasets that publishers removed.

Two reasons pointed at the site:

- **CSV exports were crawled.** Googlebot followed the `query.csv` export
  links despite `rel=nofollow`. They made up all 33 server errors (a live
  table's export asks the publisher's API, which timed out or answered 502),
  two of the three other 4xx errors and 272 of the 906 crawled-but-not-indexed
  examples. `robots.txt` now disallows `/web-api/v1/resources/*/query.csv` and
  `/api/v1/resources/*/query.csv`; no page renders from them.
- **Same-named yearly files looked like duplicates.** 2,897 pages were
  "Duplicate, Google chose different canonical than user". In the samples,
  each pair was two files of one dataset with the same name, format and
  language, such as Ontario public library statistics' "Key ratios" for 2022,
  2023, 2024 and 2025: their titles, headings and descriptions were identical.
  The resource and dataset queries now count such siblings
  (`same_name_siblings`), and a sibling's title, heading and description add
  the year or fiscal year from its file name when the name has none ("Key
  ratios 2023 — Government of Ontario (French, XLSX table)"). About 1,070
  files change; a file alone in its dataset keeps its title.
