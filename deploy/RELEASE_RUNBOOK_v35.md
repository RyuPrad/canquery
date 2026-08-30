# CanQuery v35 recovery and high-volume source runbook

Status: v35 deployed and publicly verified on August 30, 2026 at
https://canquery.com. Production is running merged commit
`d04803e893e45524d375778fc8eb7e022d3d78c4` (PRs #31 and #32). The final
telemetry and backup record is in Section 40.5 of the private technical
documentation.

This release repairs the incomplete v34 implementation, activates the live v33
and v34 catalogues that can still be verified, adds ten v35 sources, applies
migrations `029_recovery_and_high_volume_places.sql` and
`030_map_queue_resilience.sql`, and hardens local map retries. The source registry contains
85 local definitions: 82 enabled and three retained but disabled fail-closed.
Including the federal mirror, the application exposes 83 active catalogue
sources. `/api/v1/ops` registers 82 `source:*` jobs; the federal mirror is
tracked through its separate full and incremental jobs.

## 1. Validated release snapshot

The following are live upstream dry-run observations, not permanent count
assertions. Repeat the dry-runs immediately before deployment because upstream
catalogues can change.

| Wave | Active sources | Discovered | Admitted | Excluded | Mappable (raw dry-run) | Failed |
|---|---:|---:|---:|---:|---:|---:|
| v33 Quebec and Saint John | 10 | 869 | 647 | 222 | 532 | 0 |
| v34 currently available catalogues | 7 | 2,566 | 2,438 | 128 | 841 | 0 |
| v35 NWT, BC, and Quebec | 10 | 1,420 | 1,276 | 144 | 707 | 0 |
| Total | 27 | 4,855 | 4,361 | 494 | 2,080 | 0 |

The raw mappable total includes the 19 Shawinigan and 26 Saint-Hyacinthe
GeoJSON candidates that are deliberately fail-closed in the production
source configuration; the production queue must therefore exclude those 45
candidates until a reviewed probe confirms recovery.

The v35 source-level snapshot is:

| Source id | Discovered | Admitted | Excluded | Mappable |
|---|---:|---:|---:|---:|
| `northwest-territories-open-data` | 341 | 340 | 1 | 0 |
| `coquitlam-hub` | 259 | 240 | 19 | 162 |
| `prince-george-hub` | 185 | 181 | 4 | 159 |
| `new-westminster-hub` | 169 | 109 | 60 | 81 |
| `port-moody-hub` | 160 | 118 | 42 | 83 |
| `squamish-hub` | 120 | 108 | 12 | 77 |
| `maple-ridge-hub` | 67 | 64 | 3 | 48 |
| `port-coquitlam-hub` | 62 | 59 | 3 | 41 |
| `sherbrooke-geomatics-open-data` | 30 | 30 | 0 | 30 |
| `saint-hyacinthe-open-data` | 27 | 27 | 0 | 0 (fail-closed) |

`whitehorse-hub`, `st-johns-hub`, and `charlottetown-hub` are intentionally
disabled. Their documented ArcGIS feeds are unavailable, and no equivalent
machine-readable municipal catalogue with verified open-data terms was found.
Do not enable them merely to make the configured count match an older release
document.

Shawinigan and Saint-Hyacinthe remain catalogue-enabled, but direct-file map
admission is fail-closed because their advertised map hosts timed out from the
production VPS during the v35 closeout. Their datasets and resources remain
available as download-only records until a reviewed probe confirms recovery.

Abbotsford intentionally excludes 28 records whose advertised service URLs are
under the inaccessible `maps.abbotsford.ca/arcgis/rest/services/GeocortexExt/`
family and one record with restricted third-party terms. Its validated result is
186 discovered, 157 admitted, 29 excluded, 148 mappable, and zero failures.

## 2. Local release gate

Run from a clean release checkout with the lockfiles installed:

```bash
git status --short
npm ci --prefix server
npm ci --prefix client
npm --prefix server run verify
git diff --check
```

The August 30 release candidate passed 59 server suites (482 tests), 27 client
suites (109 tests), both ESLint passes, and the Vite production build. The normal
Jest run skips the PostGIS integration suite unless a database is supplied, so
also validate all migrations against a disposable PostgreSQL 16/PostGIS 3.5
database:

```bash
CANQUERY_DATABASE_URL=<disposable-postgis-url> npm --prefix server run migrate
SPATIAL_TEST_DATABASE_URL=<disposable-postgis-url> \
  npm --prefix server test -- --runInBand __tests__/spatialIntegration.test.js
```

Migrations `029` and `030` are additive and idempotent. Migration `029` repairs partial v33/v34 place
state and damaged Unicode, then adds the v35 ancestry, identifiers, aliases, and
featured municipalities. Migration `030` adds durable map retry scheduling and
typed source-failure state. Do not rewrite already-applied migrations `001`–`029`.

## 3. Repeat upstream dry-runs

Run each new or recovered source independently. A dry-run performs discovery and
normalization but does not write catalogue rows.

```bash
cd server

for source_id in \
  gatineau-open-data trois-rivieres-open-data repentigny-open-data \
  longueuil-open-data saguenay-open-data rimouski-open-data \
  shawinigan-open-data levis-open-data sherbrooke-open-data saint-john-hub \
  regina-hub windsor-hub kingston-hub red-deer-hub kamloops-hub \
  nanaimo-hub abbotsford-hub northwest-territories-open-data \
  coquitlam-hub prince-george-hub new-westminster-hub port-moody-hub \
  squamish-hub maple-ridge-hub port-coquitlam-hub \
  sherbrooke-geomatics-open-data saint-hyacinthe-open-data
do
  npm run sync:source -- --source="$source_id" --dry-run
done
```

Stop if a source has any unexplained failures, admits zero records, crosses its
metadata failure threshold, changes publisher/licence evidence, or reports a
suspicious count change. Expected licence and third-party exclusions are not
failures.

## 4. Production preflight

Administrative SSH is key-only. Use an authorized operator key; this repository
does not contain one and assumes no particular local key filename.

```bash
ssh -i <authorized-key> <admin-user>@38.45.71.90
cd <production-checkout>

set -euo pipefail
CANQUERY_PREDEPLOY_SHA="$(git rev-parse HEAD)"
printf '%s\n' "$CANQUERY_PREDEPLOY_SHA"
git status --short
git branch --show-current
git remote -v
date -u
df -h / /var/lib/postgresql
sudo systemctl status \
  opencanada-api opencanada-worker opencanada-map-worker --no-pager
psql -d opencanada -c "SELECT postgis_full_version();"
pgrep -af 'catalog-sync|incremental-sync|sync-(municipal-sources|source)' || true
```

Take and verify the normal encrypted off-server database backup before changing
the checkout or schema. Confirm that the target commit is reviewed and reachable
from the production remote. Do not discard an unclean production worktree.

Keep the same administrative shell open so `CANQUERY_PREDEPLOY_SHA` remains
available for rollback. Schedule the release outside the `06:30 UTC`
`sync-municipal-sources` cron window and do not begin while any catalogue sync is
running. Re-run the `pgrep` immediately before the first source write. If the
server uses a different clock or cron configuration, inspect
`/etc/cron.d/canquery` and use its actual municipal-sync time.

## 5. Install, verify, migrate, and refresh places

From the production checkout:

```bash
git fetch origin
git merge --ff-only <reviewed-release-commit>
git rev-parse HEAD

npm ci --prefix server
npm ci --prefix client
npm --prefix server run verify

npm --prefix server run migrate
psql -d opencanada -c \
  "SELECT filename, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 5;"

npm --prefix server run sync:places
```

Verify the place repair before harvesting sources:

```bash
psql -d opencanada <<'SQL'
SELECT count(*) AS replacement_characters
FROM places
WHERE name_en LIKE '%' || U&'\FFFD' || '%'
   OR name_fr LIKE '%' || U&'\FFFD' || '%';

SELECT id, slug, parent_id, featured
FROM places
WHERE id IN (
  'sgc-csd-5915034', 'sgc-csd-5953023', 'sgc-csd-5915029',
  'sgc-csd-5915043', 'sgc-csd-5931006', 'sgc-csd-5915075',
  'sgc-csd-5915039', 'sgc-csd-2454048'
)
ORDER BY id;
SQL
```

The damaged-character query must return zero. The eight listed municipalities
must have canonical slugs, parents, and `featured = true`.

## 6. Activate the release code before catalogue writes

The API and ingest worker must run the reviewed release before any new source
records are written. Keep the map worker stopped so it cannot claim candidates
while the catalogue canaries are in progress.

```bash
sudo systemctl stop opencanada-map-worker
sudo systemctl restart opencanada-api opencanada-worker
sudo systemctl status opencanada-api opencanada-worker --no-pager
sudo systemctl is-inactive --quiet opencanada-map-worker

curl -fsS https://canquery.com/healthz | jq -e '.ok == true'
curl -fsS https://canquery.com/api/v1/ops | tee /tmp/canquery-v35-ops.json | jq -e '
  .data.jobs as $jobs
  | ([ $jobs | keys[] | select(startswith("source:")) ] | length) == 82
    and $jobs["source:whitehorse-hub"] == null
    and $jobs["source:st-johns-hub"] == null
    and $jobs["source:charlottetown-hub"] == null
'
```

Stop here if either service is unhealthy, `/healthz` is not 200, `/ops` cannot
be constructed, the enabled-source count differs from 82, or a disabled source
appears. No v35 catalogue rows have been written yet, so use the pre-source
rollback in section 10.

## 7. Source-scoped catalogue canaries

Run one source at a time and retain its machine-readable summary. The four
canaries deliberately cover the shared Données Québec CKAN path, the custom Red
Deer adapter, ArcGIS Hub, and the GNWT CKAN catalogue.

```bash
cd <production-checkout>/server
CANQUERY_RELEASE_LOG_DIR="$(mktemp -d /tmp/canquery-v35-release.XXXXXX)"

run_v35_source() {
  local source_id="$1"
  local summary_path="$CANQUERY_RELEASE_LOG_DIR/$source_id.json"
  node scripts/sync-source.js --source="$source_id" | tee "$summary_path"
  jq -e --arg source_id "$source_id" '
    .source_id == $source_id
    and .failed == 0
    and .included > 0
    and (.sweep.datasetsDeleted // 0) == 0
    and (.sweep.resourcesDeleted // 0) == 0
  ' "$summary_path"
}

if pgrep -af 'catalog-sync|incremental-sync|sync-(municipal-sources|source)'; then
  printf '%s\n' 'A catalogue sync is already running; stop this rollout.' >&2
  exit 1
fi

run_v35_source saint-hyacinthe-open-data
curl -fsS 'https://canquery.com/api/v1/datasets?place=saint-hyacinthe-qc&limit=1' \
  | jq -e '.data | length > 0'

run_v35_source red-deer-hub
curl -fsS 'https://canquery.com/api/v1/datasets?place=red-deer-ab&limit=1' \
  | jq -e '.data | length > 0'

run_v35_source port-coquitlam-hub
curl -fsS 'https://canquery.com/api/v1/datasets?place=port-coquitlam-bc&limit=1' \
  | jq -e '.data | length > 0'

run_v35_source northwest-territories-open-data
curl -fsS 'https://canquery.com/api/v1/datasets?place=northwest-territories&limit=1' \
  | jq -e '.data | length > 0'
```

Each command must exit zero. Each summary must report zero failed records, at
least one included record, and zero swept datasets/resources. Also inspect the
full counts, exclusion reasons, licence URLs, and map modes against the dry-run
snapshot; the `jq` assertions do not replace operator review. Verify `/healthz`
and `/api/v1/ops` again after all four canaries. On any discrepancy, do not run
the remaining sources; follow the canary rollback boundary in section 10.

## 8. Remaining source-scoped catalogue writes

After all canaries pass, use the `run_v35_source` function from section 7 for
the remaining 23 sources, in this order:

```bash
for source_id in \
  gatineau-open-data trois-rivieres-open-data repentigny-open-data \
  longueuil-open-data saguenay-open-data rimouski-open-data \
  shawinigan-open-data levis-open-data sherbrooke-open-data saint-john-hub \
  regina-hub windsor-hub kingston-hub kamloops-hub nanaimo-hub \
  abbotsford-hub coquitlam-hub prince-george-hub new-westminster-hub \
  port-moody-hub squamish-hub maple-ridge-hub \
  sherbrooke-geomatics-open-data
do
  run_v35_source "$source_id"
done
```

For every source, inspect the retained JSON summary and require zero unexplained
failures or deletions. A deletion must have a separately reviewed upstream
explanation before the assertion is relaxed. The per-source transaction and 10%
maximum-delete guard are additional safety rails, not substitutes for reviewing
the summary.

Do not run the broad `sync:municipal` command for this release rollout. Keeping
the writes source-scoped makes a regression attributable and limits rollback
scope.

## 9. Resume map processing and verify production

The systemd map worker owns the advisory queue lock. Do not run `maps:drain`
concurrently with it. After all 27 catalogue writes pass, start the service and
let that single owner drain the queue:

```bash
sudo systemctl start opencanada-map-worker
sudo systemctl status opencanada-map-worker --no-pager
sudo journalctl -u opencanada-map-worker --since '10 minutes ago' --no-pager

psql -d opencanada -c \
  "SELECT status, count(*) AS jobs, coalesce(sum(feature_count), 0) AS features,
          count(*) FILTER (WHERE status = 'pending' AND next_attempt_at > now()) AS deferred
   FROM map_index_jobs GROUP BY status ORDER BY status;"
```

Continue monitoring the service journal, local disk, PostgreSQL, private-R2
budget, and the queue counts until `pending` and `running` reach zero. A
temporary export response (`202`) is retried with bounded job-local backoff;
if it remains pending at the five-attempt limit it becomes a retryable
`skipped` job (inspect and requeue it with `maps:retry-source --apply` after a
probe). Source connectivity failures defer only that source while unrelated
sources continue. Review every new `failed` or unexpected `skipped` job. If map
processing regresses,
follow the map-only rollback boundary in section 10; the catalogue and API can
remain live.

Run the final public checks while the queue drains and once more when it settles:

```bash
sudo systemctl status \
  opencanada-api opencanada-worker opencanada-map-worker --no-pager

curl -fsS https://canquery.com/healthz | jq -e '.ok == true'
curl -fsS https://canquery.com/api/v1/ops | jq -e \
  '([.data.jobs | keys[] | select(startswith("source:"))] | length) == 82'
curl -fsS https://canquery.com/api/v1/stats | jq .
curl -fsS 'https://canquery.com/api/v1/places?featured=true&limit=100' \
  | tee /tmp/canquery-v35-featured-1.json \
  | jq -e '(.data | length) == 100 and .pagination.nextCursor == "100"'
curl -fsS 'https://canquery.com/api/v1/places?featured=true&limit=100&cursor=100' \
  | jq -e '(.data | length) == 16 and .pagination.nextCursor == null'
curl -fsS 'https://canquery.com/api/v1/datasets?place=coquitlam-bc&limit=1' | jq .
curl -fsS 'https://canquery.com/api/v1/datasets?place=saint-hyacinthe-qc&limit=1' | jq .
curl -fsS 'https://canquery.com/api/v1/datasets?place=regina-sk&limit=1' | jq .
```

`/healthz` must return 200. `/api/v1/ops` must no longer fail while constructing
configured source jobs, must expose 82 `source:*` jobs, and must omit the three
disabled v34 identities. A newly launched source can be `pending` until its
first successful write; it must not be silently absent.

Finally verify that scheduled jobs use the production legacy unit names, review
the map queue for unexpected `failed` rows, and record the actual post-deployment
catalogue/resource/place/map totals in the private technical document. Do not
copy the dry-run counts above into production telemetry without querying the
deployed database.

## 10. Rollback boundaries

Migrations `029` and `030` are additive and compatible with the pre-release
application, so leave them applied during any code rollback. Never reverse them
with ad hoc SQL.

### Before the first source write

If the release-code smoke test in section 6 fails, no source rows have changed.
From the clean production checkout, detach at the captured commit, restore that
commit's dependencies/build, and restart the three services:

```bash
cd <production-checkout>
git status --short
git switch --detach "$CANQUERY_PREDEPLOY_SHA"
npm ci --prefix server
npm ci --prefix client
npm --prefix client run build
sudo systemctl restart \
  opencanada-api opencanada-worker opencanada-map-worker
curl -fsS https://canquery.com/healthz | jq .
```

Do not perform this switch with an unclean checkout. The reviewed branch remains
unchanged; after diagnosis, an operator can return the checkout to the repaired
release commit explicitly.

### During canaries or remaining catalogue writes

Stop immediately and do not invoke any later source. Keep
`opencanada-map-worker` stopped. A failed source transaction rolls back its own
catalogue changes; successful earlier source-scoped writes are additive and
should remain in place. Do not delete them as a blanket rollback. Preserve the
JSON summaries and service logs, diagnose the offending source, and resume only
after a reviewed fix and a fresh dry-run.

### During map processing

Stop only the map worker:

```bash
sudo systemctl stop opencanada-map-worker
sudo systemctl status opencanada-api opencanada-worker --no-pager
psql -d opencanada -c \
  "SELECT status, count(*) FROM map_index_jobs GROUP BY status ORDER BY status;"
```

Keep the API and successfully written catalogue live. The queue is durable; fix
the map regression, review `running`, `pending`, `failed`, and `skipped` rows,
then restart exactly one systemd map worker. Do not launch `maps:drain` alongside
the service.

When an upstream source has recovered, inspect its failed map rows before using
the explicit recovery command. The command is read-only unless `--apply` is
present:

```bash
npm run maps:retry-source -- --source=<source-id>
npm run maps:retry-source -- --source=<source-id> --apply
```
