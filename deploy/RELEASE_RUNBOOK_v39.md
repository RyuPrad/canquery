# v39: local discovery and resident guides

This release adds English/French topic matching, literal-match ranking, bounded
spelling suggestions, search-result descriptions and resource links, local guide
cards, and three paired resident guides. It introduces no database migration,
source registry change, catalogue write, or worker change.

## Verify

- Preserve existing work and use an isolated checkout from current main.
- Run `npm ci` in both packages, then `npm run verify --prefix server`.
- Use disposable PostgreSQL 16/PostGIS 3.5 with migrations applied. Run the
  spatial, Search Console, and local-search integration suites with the
  established test database environment variables.
- Compare representative old/new catalogue searches inside a read-only database
  transaction. Check local relevance, bilingual equivalence, filter retention,
  and latency for both common queries and unfiltered browsing.
- Check both blog indexes and all six article editions with JavaScript enabled
  and disabled. Verify full article content, a single h1/canonical, language,
  alternate URLs, JSON-LD, mobile layout, navigation and Back, and article 404s.
- Follow all three guide workflows. Confirm each resource still has the
  advertised capability and that official source links remain correct.
- Review the diff and merge after all CI jobs pass. Keep operational evidence,
  raw catalogue snapshots, and analytics reports outside the public repository.

## Deploy

Require a clean production checkout, service-user ownership, healthy public
health/ops endpoints, and active API/worker services. Create fresh catalogue and
analytics custom-format backups under the existing backup lock; validate both
with `pg_restore --list`, encrypt off-host copies with the established credential,
and verify ciphertext and decrypted-plaintext hashes before changing the checkout.

As the service user, fetch and fast-forward to the reviewed merge, install both
locked dependency sets, and run the release verifier. Restart the API after its
client build succeeds. Existing workers continue under their systemd owners.
Confirm checkout cleanliness, ownership, service states and public health.

Validate `/sitemap-blog.xml` (two indexes and six article editions) and its entry
in `/sitemap.xml`. Repeat public bilingual searches and browser acceptance.
Rebuild the private Search Console report with the existing read-only grant.
Record the release commit, backup manifests, test results and public observations.

## Rollback and follow-up

For an application regression, return to the recorded previous release,
reinstall its locked dependencies, rebuild the client and restart the API.
Retain catalogue data, schema, ingestion state and map data.

Compare the first seven finalized post-release days and the first full 28-day
cohort. Group both blog locales as Local guides in Search Console reporting.
Measure guide-to-resource clicks and subsequent intentional map/table use with
existing analytics opt-outs. Publication does not establish an SEO outcome.
Sitemap submission remains an owner-authenticated Search Console action with
the existing read-only OAuth grant.
