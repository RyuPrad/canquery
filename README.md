# canquery

A fast, unified query API and web interface over Canada's federal and municipal open data catalogues.

https://canquery.com

## How it works

Canada's open data catalogues are fragmented: some resources are loaded into
upstream APIs (such as CKAN's DataStore or Socrata), while most are published as static CSV, Excel, or GeoJSON files.
`canquery` unifies these into three access tiers:

| Tier | When | What happens |
|---|---|---|
| 1 - proxy | upstream API active | transparently proxy `/query` to the upstream API (cached 5 min) |
| 2 - load | tabular file <= 50 MB | streams into local PostgreSQL on demand; same `/query` response shape |
| 3 - honest fallback | anything else | metadata + the download link, labeled `file-only` (422 on `/query`) |

The catalogue combines the federal CKAN portal with source adapters for local
publishers across sixty-five municipal and regional portals (sixty-six total catalogue sources)
spanning all ten Canadian provinces and the Northwest Territories. Dataset provenance and
licensing stay attached per source. A versioned Statistics Canada SGC hierarchy powers
place-first discovery across seventy-three canonical featured jurisdictions, and
spatial resources can be explored through bounded maps before their CSV snapshot
is loaded.

Technology adapters preserve per-portal provenance and licensing:
- **Shared & Municipal CKAN**: Toronto, Montréal, and the centralized Données Québec CKAN
  engine serving Québec City, Laval, Gatineau, Trois-Rivières, Repentigny, Longueuil,
  Saguenay, Rimouski, Shawinigan, Lévis, and Sherbrooke with French-first metadata and
  record-explicit CC BY 4.0 terms.
- **Opendatasoft**: City of Vancouver with English-first metadata, record-explicit Open
  Government Licence – Vancouver terms, and validated GeoJSON exports in the local PostGIS index.
- **Socrata**: Calgary, Edmonton, and Winnipeg with config-driven publisher/licence admission
  and private Cloudflare R2 PMTiles vector-tile pipelines built by pinned Tippecanoe.
- **ArcGIS Hub**: Ottawa, Halifax, Hamilton, Surrey, Victoria, London, Kelowna, Fredericton,
  Greater Sudbury, Burnaby, Saskatoon, Moncton, Guelph, Saanich, Belleville, Yellowknife (NT),
  Barrie, Thunder Bay, Chatham-Kent, Kawartha Lakes, Summerland, Norfolk County, Haldimand County,
  Lethbridge, Medicine Hat, Airdrie, Canmore, Penticton, Langley City, Huron County, Cumberland County,
  Saint John (NB), and the Durham, Peel, Halton, York, Niagara, and Waterloo regional clusters
  with bounded live ArcGIS map viewports and strict publisher-scoped open licences.

Each portal is gated to its recognized open licences, so generic website terms, blank licence
records where no portal-wide grant applies, and non-commercial data stay excluded.

## Layout

```
canquery/
├── server/     # Node.js + Express API, harvest pipelines, workers, PostgreSQL
└── client/     # React SPA (Vite + Tailwind CSS + DaisyUI)
```

## Quickstart

Requirements: Node 20+, PostgreSQL 16 with PostGIS 3.5.

```bash
# 1. Database
createdb canquery
psql canquery -c "CREATE EXTENSION IF NOT EXISTS postgis;"
psql canquery -c "CREATE EXTENSION IF NOT EXISTS unaccent;"

# 2. Server
cd server
npm install
cp .env.example .env              # set DATABASE_URL (and optional S3_* for PMTiles)
npm run migrate                   # apply migrations (runs 001..028)
npm run sync:places               # populate the 2021 SGC hierarchy

# sync the federal catalogue (batched harvest, chunks of 50)
npm run sync                      # full harvest (~50k datasets)
# or test against a small sample:
npm run sync -- --limit=100

# or harvest a standalone municipal/regional source (dry-run or real)
npm run sync:source -- --source=toronto-open-data --dry-run
npm run sync:source -- --source=montreal-open-data --dry-run
npm run sync:source -- --source=quebec-city-open-data --dry-run
npm run sync:source -- --source=laval-open-data --dry-run
npm run sync:source -- --source=ottawa-hub --dry-run
npm run sync:source -- --source=vancouver-open-data --dry-run
npm run sync:source -- --source=calgary-open-data --dry-run
npm run sync:source -- --source=halifax-hub --dry-run
npm run sync:source -- --source=hamilton-hub --dry-run
npm run sync:source -- --source=surrey-hub --dry-run
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
curl 'http://localhost:3100/api/v1/places?q=Montr%C3%A9al'
curl 'http://localhost:3100/api/v1/places?q=Qu%C3%A9bec'
curl 'http://localhost:3100/api/v1/places?q=Laval'
curl 'http://localhost:3100/api/v1/places?q=Vancouver'
curl 'http://localhost:3100/api/v1/places?q=Calgary'
curl 'http://localhost:3100/api/v1/places?q=Edmonton'
curl 'http://localhost:3100/api/v1/places?q=Winnipeg'
curl 'http://localhost:3100/api/v1/places?q=Halifax'
curl 'http://localhost:3100/api/v1/places?q=Hamilton'
curl 'http://localhost:3100/api/v1/places?q=Surrey'

# place-filtered sources are authoritative; counts expose total + authoritative
curl 'http://localhost:3100/api/v1/sources?place=clarington-on'
curl 'http://localhost:3100/api/v1/sources?place=mississauga-on'
curl 'http://localhost:3100/api/v1/sources?place=vancouver-bc'
curl 'http://localhost:3100/api/v1/sources?place=calgary-ab'
curl 'http://localhost:3100/api/v1/sources?place=edmonton-ab'
curl 'http://localhost:3100/api/v1/sources?place=winnipeg-mb'
curl 'http://localhost:3100/api/v1/sources?place=halifax-ns'
curl 'http://localhost:3100/api/v1/sources?place=hamilton-on'
curl 'http://localhost:3100/api/v1/sources?place=surrey-bc'
curl 'http://localhost:3100/api/v1/sources?place=quebec-qc'
curl 'http://localhost:3100/api/v1/sources?place=laval-qc'

# dataset detail - resources tagged datastore | ingested | ingestable | file-only
curl 'http://localhost:3100/api/v1/datasets/<idOrName>'

# the unified query endpoint (same shape for proxied and ingested data)
curl 'http://localhost:3100/api/v1/resources/<id>/query?limit=10'
curl 'http://localhost:3100/api/v1/resources/<id>/query?filters={"year":{"op":"gte","value":2020}}&sort=year%20desc'

# bounded GeoJSON compatibility view for ArcGIS, PostGIS, or PMTiles resources
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
| `scripts/sync-places.js` | imports the Windows-1252 EN/FR Statistics Canada SGC hierarchy with stable internal ids and alias-safe canonical slug repair |
| `scripts/sync-source.js` | validates or syncs one configured source adapter; `--source`, `--limit`, `--dry-run` |
| `scripts/sync-municipal-sources.js` | refreshes every enabled non-federal source independently so one failure cannot suppress the others |
| `scripts/ingest-worker.js` | exclusively owns the queue with a PostgreSQL advisory lock, heartbeats active-job leases, streams files into `store.r_*` via `COPY`, and recovers crash orphans immediately; `--once` for a single drain |
| `scripts/map-worker.js` | exclusively owns the versioned map queue; keeps CKAN/Opendatasoft maps in PostGIS and builds bounded Socrata GeoJSON into immutable private-R2 PMTiles; validates source identity, versions, geometry, object integrity and budgets; `--once`, `--drain`, or `--resource=<id>` |
| `scripts/prune-map-objects.js` | removes private PMTiles objects that have been unreferenced for at least 24 hours; bounded daily cleanup, `--dry-run` |
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

Local maps have separate defaults: 1,000,000 rows, 1,000,000 vertices per feature,
and 10,000,000 vertices per resource, plus a 1 GB download cap, a 20 GB logical
map-store budget, and a 30 GB
filesystem free-space floor. Direct GeoJSON supports absent/WGS84, CRS84, and
named PostGIS EPSG definitions; unsupported or malformed CRS declarations fail
closed for that resource. Known upstream record counts above `MAX_ROWS` keep a
CSV discoverable as `file-only` without enqueueing an ingest that cannot finish.
`map_store.features` is a reproducible cache and may
be excluded from backups; the queue reindexes missing feature data after restore.
Admitted Calgary, Edmonton and Winnipeg Socrata geometry tables use a hybrid
path instead: sequential
portal-local GeoJSON pages are reduced to 20 scalar popup fields, passed to a
pinned Tippecanoe build, and uploaded as immutable PMTiles to a private R2 bucket.
The browser receives only a same-origin versioned vector-tile URL. R2 keys and
credentials never appear in public metadata. Archives use z0-z16, a 500,000-byte
compressed tile ceiling, a 2 GB per-archive cap, a 30-minute build timeout and a
100 GB logical bucket budget. Existing Toronto, Montréal and Vancouver local maps
remain in PostGIS.

## Web UI

The SPA (`client/`) starts with a search plus an optional remembered place
(All Canada remains the default). Its grouped selector shows seventy-three canonical
featured jurisdictions, including standalone cities (Calgary, Edmonton, Fredericton, Gatineau,
Greater Sudbury, Guelph, Halifax, Hamilton, Kelowna, Laval, Lévis, London, Longueuil, Moncton,
Montréal, Ottawa, Québec City, Repentigny, Rimouski, Saanich, Saguenay, Saint John, Saskatoon,
Shawinigan, Sherbrooke, Surrey, Toronto, Trois-Rivières, Vancouver, Victoria, Winnipeg, Yellowknife,
and more), regional clusters (Durham, Halton, Niagara, Peel, Waterloo Region, and York Region),
and their lower-tier municipalities; search on `/places` reaches the complete Canadian SGC hierarchy. Place
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

Coverage includes CKAN, ArcGIS Hub, Opendatasoft and Socrata source adapters, place hierarchy and APIs, streaming direct
GeoJSON plus projected-CRS map conversion, private-R2 PMTiles generation/range reads, bounded map
queries, publisher-specific provenance, the four `/query` modes, filter-grammar injection attempts,
concurrent job-lease heartbeats, store/map-budget eviction, and client UI routing, tables, and charts.

## Deployment

Dedicated VPS `canquery-prod-01` at Little Creek Hosting (IPv4 `38.45.71.90`).
Deployed through `git pull` on `main` under user `canquery`; managed as systemd
services `canquery-api.service`, `canquery-worker.service`, and `canquery-map-worker.service`
behind a Caddy reverse proxy that terminates TLS with automatic Let's Encrypt certificates.
See `deploy/DEPLOY.md` for runbooks.
