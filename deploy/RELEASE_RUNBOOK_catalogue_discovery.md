# Catalogue discovery release

This release exposes all existing public dataset and resource detail pages in
the sitemaps, including download-only files. It adds `/datasets` and 50-item
pagination to catalogue, publisher, place and dataset resource lists. Existing
detail URLs remain canonical; page continuations use `?page=N` and their own
canonical URLs. Page one redirects to the base URL. Invalid and out-of-range
pages return 404 with noindex; catalogue failures retain retryable 503 responses.

The organizations API accepts optional `q` for literal, case-insensitive search
across publisher names and English/French titles. Existing `limit`/`cursor`
interfaces and response envelopes remain compatible. Local search filters use
buttons for pagination and do not add filter links to the crawl graph.

Resource titles always link to their details, original-file links appear before
JavaScript runs, and resource overviews include recorded parent descriptions.
Date-only titles include the dataset subject while retaining the file period,
language and format. These changes neither ingest files nor merge language
editions. There are no dependency, schema, source-admission or analytics changes.

## Verification

- Run `npm run verify` in `server/` and all four integration suites in CI against
  disposable PostgreSQL 16/PostGIS 3.5. The discovery integration suite covers
  file-only records, metadata-only datasets, orphan exclusion, directory search
  and complete traversal across tied ordering values.
- Check initial HTML and the interactive app in Chromium and WebKit, including
  narrow English/French layouts, keyboard navigation, Back, direct page-two
  links, filter buttons and a resource highlight beyond the first page.
- Compare sitemap counts and distinct URLs with the catalogue in a stable
  observation window. Each chunk remains bounded to 25,000 URLs. Query variants
  and removed records must not enter the sitemap. Check the last chunk and the
  first nonexistent chunk of each family.

## Deployment and rollback

Use a clean worktree and the application account for Git/build operations.
Freeze private indexing counts and representative URL inspections separately
from existing SEO baselines. Complete fresh validated catalogue and analytics
backups, including the established encrypted, hash-verified off-host copies.

Install and verify the reviewed commit in an isolated release directory. Match
its built assets against the browser-verified build. Preserve the previous
commit and frontend, promote assets with `index.html` last, retain older hashed
assets and restart only the API service. Verify public health, operations,
representative catalogue pages, sitemap families and ownership. Confirm other
services retained their process IDs.

Rollback by selecting the preserved compatible commit as the application user,
restoring its matching frontend with the index last, and restarting the API.
No database restore is required for this code rollback.

## Search Console follow-up

Submit the updated sitemap once after successful verification and inspect a
small representative set of URLs. Do not validate intentional redirect,
duplicate or removed-page exclusions as defects. Compare the frozen indexing
cohort weekly and at 7/28 days when reports have caught up. Preserve existing
SEO cohorts and annotate this release separately using Search Console's Pacific
dates and the exact UTC deployment timestamp.

Broader discovery may initially increase the not-indexed count. Assess indexed
canonical pages, inspected cohort transitions, crawl response times and host
errors together; successful deployment does not establish indexing gains.
