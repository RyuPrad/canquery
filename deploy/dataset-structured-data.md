# Dataset structured data repair

Resource pages reference their canonical parent dataset URL through
`DataDownload.isPartOf`. They no longer declare a nested Dataset containing only
a name and URL, which Google reports as missing its required description and
recommended creator and licence. Complete Dataset markup remains on dataset
landing pages. Dataset creators use Google's supported `Organization` type and
retain the recorded organization name.

## Verification

Run the full release verifier and all three CI jobs on the exact head and merge.
Check server HTML and client navigation/Back in Chromium and WebKit: resource
pages retain WebPage, DataDownload, breadcrumbs, their canonical URL and original
download; dataset pages retain their complete descriptions, creator and source
licence. Include French metadata, encoded parent identities, missing parents,
map query parameters and existing unavailable-resource 404s.

Recheck the reported Search Console examples and their available parent pages.
Use isolated HTTPS fixtures for interactive resource checks. Production browser
checks enable DNT/GPC and block preparation/activity writes and resource
query/profile/export reads. Validate representative live resource and dataset
pages with Google's Rich Results Test before starting Search Console validation.
Resource pages are still indexable, but will no longer contribute incomplete
Dataset items to the enhancement report. Removed resources remain 404/noindex.

## Release and follow-up

Follow `DEPLOY.md` and the current private operations guide: capture the installed
commit, configuration hashes, service identities and frontend; verify headroom
at the existing storage floors; take fresh application and analytics backups
under the existing lock and verify encrypted off-host copies. Verify the exact
release in an isolated stage as the application user.

This server-only change needs no migration, dependency change, frontend
promotion or worker restart. Verify the client build matches the installed
artifact, promote the reviewed source, and restart only the API. Check health,
the existing ops state, ownership, configuration and unrelated service continuity.
A scoped source recovery can use the captured compatible baseline after checking
for intervening changes; preserve the current environment, databases and ledgers.

After live acceptance, start validation for missing Dataset description and the
related creator/type/licence warnings. Retain dated private examples, validation
receipts and a release annotation. Google recrawling determines when the report
changes; deployment or validation acceptance does not establish indexing or a
traffic improvement. Keep existing frozen SEO cohorts unchanged.
