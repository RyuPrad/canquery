# CanQuery v36 source recovery and SEO release

This release restores eight drifted municipal source jobs, makes `/api/v1/ops`
fail immediately on the latest failed background-job attempt, and ships bounded,
capability-aware metadata with visible and structured breadcrumbs. It has no
schema migration, source addition, URL migration, or broad catalogue sweep.

## 1. Verify the reviewed release

Use a clean checkout of the reviewed commit based on current `origin/main`.

```bash
git status --short
npm ci --prefix server
npm ci --prefix client
npm --prefix server run verify
git diff --check
```

The normal verifier intentionally skips the PostGIS-only integration suite.
v36 does not change SQL migrations or spatial behavior.

## 2. Freeze the private SEO baseline

Before deployment, record the latest finalized 28-day Search Console summary
and the 20 highest-impression existing dataset/resource URLs. Keep the output in
the private production release log, not in this public repository.

```sql
WITH latest AS (
  SELECT max(data_date) AS d
  FROM search_console_daily WHERE search_type = 'web'
)
SELECT latest.d AS finalized_through,
       sum(clicks) AS clicks,
       sum(impressions) AS impressions,
       sum(clicks) / nullif(sum(impressions), 0) AS ctr,
       sum(position * impressions) / nullif(sum(impressions), 0) AS position
FROM search_console_daily, latest
WHERE search_type = 'web' AND data_date BETWEEN latest.d - 27 AND latest.d
GROUP BY latest.d;

WITH latest AS (
  SELECT max(data_date) AS d
  FROM search_console_daily WHERE search_type = 'web'
)
SELECT value AS page, sum(clicks) AS clicks, sum(impressions) AS impressions,
       sum(clicks) / nullif(sum(impressions), 0) AS ctr,
       sum(position * impressions) / nullif(sum(impressions), 0) AS position
FROM search_console_breakdowns, latest
WHERE search_type = 'web' AND dimension = 'page'
  AND data_date BETWEEN latest.d - 27 AND latest.d
  AND (value ~ '/datasets/[^/?#]+' OR value ~ '/resources/[^/?#]+')
GROUP BY value
ORDER BY impressions DESC, page
LIMIT 20;
```

## 3. Repeat source dry-runs

Run the eight affected sources plus Canmore and Cumberland controls from the
production host immediately before deployment. A dry-run performs upstream
reads and database comparisons only.

```bash
cd server
for source_id in \
  waterloo-region-hub fredericton-hub lethbridge-hub medicine-hat-hub \
  airdrie-hub penticton-hub langley-city-hub huron-hub \
  canmore-hub cumberland-hub
do
  npm run sync:source -- --source="$source_id" --dry-run
done
```

Require nonzero admission, zero enrichment failures, expected publisher,
licence, and place attribution, and `catalogue_diff.would_delete == 0`. Treat the fresh
dry-run counts as the deployment contract because the live ArcGIS feeds may
change between releases.

## 4. Production preflight and backups

Do not begin during another catalogue sync. Keep the predeployment SHA for
rollback and do not alter an unclean checkout.

```bash
set -euo pipefail
cd /home/opencanada/opencanada
CANQUERY_PREDEPLOY_SHA="$(git rev-parse HEAD)"
git status --short
pgrep -af 'catalog-sync|incremental-sync|sync-(municipal-sources|source)' || true
sudo systemctl status opencanada-api opencanada-worker opencanada-map-worker --no-pager
df -h / /var/lib/postgresql

flock -n /run/lock/canquery-backup.lock /usr/local/sbin/canquery-backup.sh
latest_catalogue="$(find /var/backups/canquery -maxdepth 1 -name 'opencanada-*.dump' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)"
latest_analytics="$(find /var/backups/canquery -maxdepth 1 -name 'canquery-analytics-*.dump' -printf '%T@ %p\n' | sort -nr | head -1 | cut -d' ' -f2-)"
sudo -u postgres pg_restore --list "$latest_catalogue" >/dev/null
sudo -u postgres pg_restore --list "$latest_analytics" >/dev/null
```

Complete the normal encrypted off-host copy and hash verification before the
checkout changes.

## 5. Deploy code and run source-scoped writes

```bash
git fetch origin
git merge --ff-only <reviewed-main-commit>
npm ci --prefix server
npm ci --prefix client
npm --prefix server run verify

sudo systemctl stop opencanada-map-worker
sudo systemctl restart opencanada-api opencanada-worker
sudo systemctl is-active --quiet opencanada-api
sudo systemctl is-active --quiet opencanada-worker
sudo systemctl is-inactive --quiet opencanada-map-worker
curl -fsS https://canquery.com/healthz | jq -e '.ok == true'
```

Run only the eight affected sources and retain every JSON summary.

```bash
cd /home/opencanada/opencanada/server
CANQUERY_RELEASE_LOG_DIR="/var/backups/canquery/v36-$(date -u +%Y%m%dT%H%M%SZ)"
sudo install -d -o opencanada -g opencanada -m 0700 "$CANQUERY_RELEASE_LOG_DIR"

run_v36_source() {
  local source_id="$1"
  local summary_path="$CANQUERY_RELEASE_LOG_DIR/$source_id.json"
  node scripts/sync-source.js --source="$source_id" | tee "$summary_path"
  jq -e --arg source_id "$source_id" '
    .source_id == $source_id
    and .failed == 0
    and .included > 0
    and (.sweep.datasetsDeleted // 0) == 0
    and (.sweep.resourcesDeleted // 0) == 0
    and (.map_sweep.removed // 0) == 0
  ' "$summary_path"
}

for source_id in \
  waterloo-region-hub fredericton-hub lethbridge-hub medicine-hat-hub \
  airdrie-hub penticton-hub langley-city-hub huron-hub
do
  run_v36_source "$source_id"
done
```

Stop at the first mismatch. Do not use the broad `sync:municipal` job during
this rollout.

## 6. Resume maps and verify the public release

```bash
sudo systemctl start opencanada-map-worker
sudo systemctl is-active --quiet opencanada-map-worker

curl -fsS https://canquery.com/healthz | jq -e '.ok == true'
curl -fsS https://canquery.com/api/v1/ops | jq -e '
  .data.ok == true
  and ([.data.jobs | keys[] | select(startswith("source:"))] | length) == 82
  and ([.data.jobs[] | select(.status == "failed" or .status == "stale")] | length) == 0
  and .data.maps.pending == 0
  and .data.maps.running == 0
  and .data.maps.failed == 0
'
```

Verify Waterloo, Huron, Fredericton, and Airdrie catalogue pages. On a long
dataset title, a generic-name resource, a mapped resource, and a download-only
resource, check that the rendered title is at most 80 characters, the
description is at most 160, the canonical is unchanged, and the page contains a
valid `BreadcrumbList`. Validate representative markup with Google Rich Results
Test.

Rebuild the private Search Console report and inspect its new high-impression,
low-CTR page table:

```bash
sudo -u opencanada npm --prefix /home/opencanada/opencanada/server run gsc:report
```

Once both health endpoints are green, create private five-minute UptimeRobot
HTTP monitors for `https://canquery.com/healthz` and
`https://canquery.com/api/v1/ops`, with down and recovery email alerts to
`ryuprad@gmail.com`. Do not publish a status page.

## 7. Measurement and rollback

Resubmit the sitemap and request inspection of representative cohort pages.
Allow seven days for recrawling, then compare the next 28 finalized days with
the frozen cohort. The target is at least 25% relative cohort CTR improvement,
at least 80% of baseline impressions, and weighted average position within two
positions.

Source, ops, and SEO changes are separate commits. Revert the affected commit
and redeploy if code rollback is required. Successful source additions remain
compatible with an SEO or ops rollback. Stop catalogue writes at the first
count discrepancy; use the existing map-only rollback boundary for indexing
regressions. Accurate metadata is not automatically rolled back for a neutral
CTR result.
