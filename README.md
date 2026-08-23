# canquery

One consistent query API + web UI across Canadian federal and local open data.

**Live:** https://canquery.com

[open.canada.ca](https://open.canada.ca/data/) catalogues ~50,000 datasets, but only
~1,000 resources are loaded into CKAN's DataStore and therefore queryable through the
official `datastore_search` API. The other ~98% are bare file downloads. **canquery**
makes the whole catalogue feel queryable through one endpoint:

| Tier | When | What happens |
|---|---|---|
| 1 - proxy | resource has `datastore_active: true` | upstream `datastore_search` is proxied and cached (5 min TTL) |
| 2 - ingest | it's a CSV/XLSX/XLS under the caps | `POST /ingest` streams it into our Postgres `store` schema; the same `/query` endpoint then serves it locally - **identical response shape** |
| 3 - honest fallback | anything else | metadata + the download link, labeled `file-only` (422 on `/query`) |

The catalogue combines the federal CKAN portal with source adapters for local
publishers. Dataset provenance and licensing stay attached per source. A
versioned Statistics Canada SGC hierarchy powers place-first discovery, and
spatial resources can be explored through bounded maps before their CSV snapshot
is loaded. Toronto's official CKAN catalogue is included as one canonical city,
with its GeoJSON DataStore layers rebuilt into a local PostGIS viewport index.
The featured local directory also covers Durham Region
and all eight lower-tier municipalities, with direct feeds from Durham, Ajax,
Oshawa, Pickering and the explicitly open-licensed subset of Whitby.
Clarington is represented through Durham’s regional coverage only: its current
public web-map terms are personal/non-commercial, so no direct adapter is enabled.
Peel Region is included alongside direct Mississauga and Brampton feeds; Caledon
is represented honestly through Peel's regional coverage. Each portal is gated
to its recognized open licences, so generic website terms, blank licence records
where no portal-wide grant applies, and non-commercial data stay excluded.

## Layout

```
server/   Express 5 API + pipelines (routes → controllers → services → db, no ORM)
client/   React 19 + Vite + Tailwind 4 + daisyUI SPA
deploy/   systemd units, cron drop-in, Caddy snippet, DEPLOY.md guide
```

## Local setup

Prereqs: Node 20+, PostgreSQL 16, PostGIS 3.

```bash
# 1. Database
sudo -u postgres psql -c "CREATE ROLE canquery LOGIN PASSWORD 'canquery_dev'" \
                      -c "CREATE DATABASE canquery OWNER canquery"
sudo -u postgres psql -d canquery -c "CREATE EXTENSION postgis"

# 2. Server
cd server
cp .env.example .env          # fill in CANQUERY_DATABASE_URL etc.
npm install
npm run migrate               # idempotent, applies sql/migrations/*.sql
node scripts/catalog-sync.js --limit 200   # small real harvest (~2 min, polite)
npm run sync:places                       # Statistics Canada SGC hierarchy
npm run sync:source -- --source=durham-hub --dry-run
npm run sync:source -- --source=peel-hub --dry-run
npm run sync:municipal                    # sync every enabled local source
npm run maps:drain                        # build all queued local map indexes
npm run dev                   # API on :3100

# 3. Client (separate terminal)
cd client
npm install
npm run dev                   # Vite on :5173, proxies /api → :3100
```

## API (`/api/v1`, anonymous)

Every response uses `{ data, pagination: { nextCursor }, meta }`. Catalogue,
query, profile and map responses expose source-specific provenance and licensing;
mixed collection responses never claim one publisher's licence for every item.

```bash
# search the mirrored catalogue (tsvector, EN+FR)
curl 'http://localhost:3100/api/v1/datasets?q=housing&place=oshawa-on&format=CSV&limit=5'

# browse featured regions/cities (or search every SGC place with q)
curl 'http://localhost:3100/api/v1/places?featured=true'
curl 'http://localhost:3100/api/v1/places?q=Oshawa'
curl 'http://localhost:3100/api/v1/places?q=Mississauga'

# place-filtered sources are authoritative; counts expose total + authoritative
curl 'http://localhost:3100/api/v1/sources?place=clarington-on'
curl 'http://localhost:3100/api/v1/sources?place=mississauga-on'

# dataset detail - resources tagged datastore | ingested | ingestable | file-only
curl 'http://localhost:3100/api/v1/datasets/<idOrName>'

# the unified query endpoint (same shape for proxied and ingested data)
curl 'http://localhost:3100/api/v1/resources/<id>/query?limit=10'
curl 'http://localhost:3100/api/v1/resources/<id>/query?filters={"year":{"op":"gte","value":2020}}&sort=year%20desc'

# bounded GeoJSON for an upstream ArcGIS or locally indexed CKAN resource
curl 'http://localhost:3100/api/v1/resources/<id>/map?bbox=-79,43.8,-78.7,44&zoom=11&limit=1000'

# load a tabular file (idempotent; 5/hour/IP), then poll a newly-enqueued job.
# A resource already loaded returns 200 with already_loaded: true and no job id.
curl -X POST 'http://localhost:3100/api/v1/resources/<id>/ingest'
curl 'http://localhost:3100/api/v1/jobs/<jobId>'

curl 'http://localhost:3100/api/v1/organizations?limit=10'
curl 'http://localhost:3100/api/v1/stats'

# the live Top 100 Downloaded Datasets leaderboard (period + ranked items)
curl 'http://localhost:3100/api/v1/insights/top-downloads'

curl 'http://localhost:3100/healthz'
```

Filter grammar: `{ "column": value }` or
`{ "column": { "op": "eq|lt|gt|lte|gte|contains", "value": ... } }`.
Column names are validated against the stored column list; values only ever travel
as SQL placeholders. Operator filters work on ingested resources; the upstream
datastore proxy supports equality only (400 otherwise).
Search text is capped at 200 characters and local query offsets at 10,000;
expensive profile, aggregation, and export routes have dedicated rate limits.

## Pipelines

| Script | Purpose |
|---|---|
| `scripts/catalog-sync.js` | full harvest: `package_list` → batched `package_show` (chunks of 50, concurrency 2), resumable via `sync_progress`; `--limit N`, `--dry-run` |
| `scripts/incremental-sync.js` | upserts through a persisted, overlapping `metadata_modified` watermark with deterministic `id` tie ordering; page-cap runs are marked incomplete without advancing it |
| `scripts/sync-places.js` | imports the EN/FR Statistics Canada SGC hierarchy with stable internal place ids |
| `scripts/sync-source.js` | validates or syncs one configured source adapter; `--source`, `--limit`, `--dry-run` |
| `scripts/sync-municipal-sources.js` | refreshes every enabled non-federal source independently so one failure cannot suppress the others |
| `scripts/ingest-worker.js` | exclusively owns the queue with a PostgreSQL advisory lock, heartbeats active-job leases, streams files into `store.r_*` via `COPY`, and recovers crash orphans immediately; `--once` for a single drain |
| `scripts/map-worker.js` | exclusively owns the versioned map queue, streams official CKAN CSV dumps into PostGIS under row/vertex/file/disk budgets, and self-heals excluded map data after restore; `--once` or `--drain` |
| `scripts/evict-store.js` | serializes with ingestion, rechecks pins/state under lock, and drops least-recently-accessed tables until under `STORE_BUDGET_GB` |
| `scripts/seed-top100.js` | rebuilds the **Top 100** leaderboard: ranks the latest analytics snapshot, ingests + pins one latest-period resource per top dataset, upserts `top_downloads`; daily cron, `--dry-run` |

Every script writes a run-log row (`sync_runs` / `ingest_runs`) in a `finally` block
and exits non-zero on failure.

Safety rails (env-tunable): `MAX_FILE_MB=50`, `MAX_ROWS=1000000`, `MAX_COLS=120`,
`STORE_BUDGET_GB=15`. Downloads accept only public HTTP(S) destinations, validate
and DNS-pin every redirect hop, stream to disk, and abort mid-stream past the cap.
Excel archives are preflighted for expansion bombs and converted in a
memory/time-limited child process. Ingest reserves capacity, checks the exact
PostgreSQL relation size before commit, enforces the budget after commit, and can
fail closed on a real-filesystem free-space floor (`STORE_DATA_PATH` is required
for the production worker).
Type inference (1,000-row sample → INTEGER/NUMERIC/DATE/TIMESTAMPTZ/TEXT) falls back
to TEXT per column when a later cast fails.

Local maps have separate defaults: 1,000,000 rows and 10,000,000 vertices per
resource, a 1 GB download cap, a 20 GB logical map-store budget, and a 30 GB
filesystem free-space floor. `map_store.features` is a reproducible cache and may
be excluded from backups; the queue reindexes missing feature data after restore.

## Web UI

The SPA (`client/`) starts with a search plus an optional remembered place
(All Canada remains the default). Its grouped selector shows featured regions,
their municipalities, and standalone featured cities such as Toronto;
search on `/places` still reaches the complete Canadian SGC hierarchy. Place
pages combine directly local datasets with records whose parent jurisdiction
explicitly covers that place, and label regional-only coverage instead of
implying a municipal feed exists. Source filters remain secondary, and every
dataset/resource shows its publisher and licence. The resource explorer has a
sortable/filterable table, CSV export, and
a lazy Map tab for spatial resources; the map follows its own viewport and does
not imply that table filters are spatial filters. Unlocked resources also get an
auto **Insights** dashboard that profiles the table and renders KPIs + charts
(donuts, bars, time-series) with zero configuration. The **`/insights`** section
is a live **Top 100 Downloaded Datasets** leaderboard: the most-downloaded
datasets on open.canada.ca for the latest month, each ingested and visualized,
shown as a top-3 chart podium over a ranked list with download-history
sparklines. English/French throughout.

## Tests & lint

```bash
cd server && npm test && npm run lint
cd client && npm test && npm run lint && npm run build
```

Coverage includes source adapters, place hierarchy and APIs, bounded map
queries, publisher-specific provenance, the four `/query` modes, filter-grammar injection attempts,
SSRF/redirect/DNS-pinning checks, bounded caches, spreadsheet-safe streaming CSV
exports, Excel archive caps, lease recovery, lossless incremental sync, strict
eviction budget honoring, the stable envelope shape, the column-profile endpoint,
and the auto-insights column classifier. The server
suite mocks the database, so it runs without Postgres (this is what CI runs).

## Deployment

See [`deploy/DEPLOY.md`](deploy/DEPLOY.md) for a generic single-server setup:
Postgres, `.env`, systemd units, the cron schedule, and a reverse-proxy (Caddy)
example. In production the API process serves the built SPA, so the only
public-facing piece is a TLS-terminating reverse proxy in front of `:3100`.

## Contributing

Contributions are welcome - see [CONTRIBUTING.md](CONTRIBUTING.md) for setup and
the PR checklist, and [SECURITY.md](SECURITY.md) to report vulnerabilities
privately.

## License & attribution

Code: **MIT** - see [LICENSE](LICENSE). Data remains under each publisher's
licence; canquery exposes that licence and attribution on the corresponding
dataset/resource. Federal records use the
[Open Government Licence - Canada](https://open.canada.ca/en/open-government-licence-canada).
This project is independent and is not affiliated with any government publisher.

Built by [@RyuPrad](https://github.com/RyuPrad) ·
[github.com/RyuPrad/canquery](https://github.com/RyuPrad/canquery)
