# canquery

One consistent query API + web UI over the whole of Canada's open data portal.

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

The catalogue itself (bilingual titles, notes, keywords, organizations) is mirrored
into Postgres by sync scripts and searched with a generated tsvector (English + French).

## Layout

```
server/   Express 5 API + pipelines (routes → controllers → services → db, no ORM)
client/   React 19 + Vite + Tailwind 4 + daisyUI SPA
deploy/   systemd units, cron drop-in, Caddy snippet, DEPLOY.md guide
```

## Local setup

Prereqs: Node 20+, PostgreSQL 16.

```bash
# 1. Database
sudo -u postgres psql -c "CREATE ROLE canquery LOGIN PASSWORD 'canquery_dev'" \
                      -c "CREATE DATABASE canquery OWNER canquery"

# 2. Server
cd server
cp .env.example .env          # fill in CANQUERY_DATABASE_URL etc.
npm install
npm run migrate               # idempotent, applies sql/migrations/*.sql
node scripts/catalog-sync.js --limit 200   # small real harvest (~2 min, polite)
npm run dev                   # API on :3100

# 3. Client (separate terminal)
cd client
npm install
npm run dev                   # Vite on :5173, proxies /api → :3100
```

## API (`/api/v1`, anonymous)

Every response: `{ data, pagination: { nextCursor }, meta }` - `meta` always carries
the Open Government Licence – Canada attribution and `upstream: 'open.canada.ca'`.

```bash
# search the mirrored catalogue (tsvector, EN+FR)
curl 'http://localhost:3100/api/v1/datasets?q=housing&format=CSV&limit=5'

# dataset detail - resources tagged datastore | ingested | ingestable | file-only
curl 'http://localhost:3100/api/v1/datasets/<idOrName>'

# the unified query endpoint (same shape for proxied and ingested data)
curl 'http://localhost:3100/api/v1/resources/<id>/query?limit=10'
curl 'http://localhost:3100/api/v1/resources/<id>/query?filters={"year":{"op":"gte","value":2020}}&sort=year%20desc'

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
| `scripts/ingest-worker.js` | exclusively owns the queue with a PostgreSQL advisory lock, heartbeats active-job leases, streams files into `store.r_*` via `COPY`, and recovers crash orphans immediately; `--once` for a single drain |
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

## Web UI

The SPA (`client/`) is search → dataset → resource explorer, with a
sortable/filterable data grid and CSV export. Unlocked resources also get an
auto **Insights** dashboard that profiles the table and renders KPIs + charts
(donuts, bars, time-series) with zero configuration. The **`/insights`** section
is a live **Top 100 Downloaded Datasets** leaderboard: the most-downloaded
datasets on open.canada.ca for the latest month, each ingested and visualized,
shown as a top-3 chart podium over a ranked list with download-history
sparklines. English/French throughout.

## Tests & lint

```bash
cd server && npm test && npm run lint   # Jest + Supertest (276 tests)
cd client && npm test && npm run lint   # Vitest (82 tests)
```

Coverage includes the four `/query` modes, filter-grammar injection attempts,
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

Code: **MIT** - see [LICENSE](LICENSE). Data: contains information licensed under
the [Open Government Licence – Canada](https://open.canada.ca/en/open-government-licence-canada).
This project is independent and not affiliated with the Government of Canada.

Built by [@RyuPrad](https://github.com/RyuPrad) ·
[github.com/RyuPrad/canquery](https://github.com/RyuPrad/canquery)
