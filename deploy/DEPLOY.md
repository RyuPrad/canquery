# canquery - deployment guide

A generic single-server deployment. canquery is two parts - an Express API
(`server/`) and a built React SPA (`client/`) - plus a small set of background
jobs. In production the API process serves the built SPA itself, so the only
public-facing piece you need in front of it is a TLS-terminating reverse proxy.

Placeholders to substitute: `<your-domain>` (the public hostname), `<password>`
(a generated DB password), `<contact-email>` (a polite contact for the upstream
User-Agent).

Prerequisites: Node 20+, PostgreSQL 16 with PostGIS 3, and nftables on the target host.

## 1. App user + code

```bash
adduser --disabled-password --gecos 'canquery app' canquery
sudo -u canquery git clone <repo-url> /home/canquery/canquery
cd /home/canquery/canquery/server && sudo -u canquery npm install --omit=dev
mkdir -p /home/canquery/logs && chown canquery:canquery /home/canquery/logs
```

## 2. Database

```bash
# as a postgres superuser:
psql -c "CREATE ROLE canquery LOGIN PASSWORD '<password>'"
psql -c "CREATE DATABASE canquery OWNER canquery"
psql -d canquery -c "CREATE EXTENSION postgis"
```

Create `/home/canquery/canquery/server/.env` from `.env.example`:

```
NODE_ENV=production
PORT=3100
CANQUERY_DATABASE_URL=postgres://canquery:<password>@127.0.0.1:5432/canquery
CKAN_USER_AGENT=canquery/1.0 (<contact-email>)
CORS_ALLOWED_ORIGINS=https://<your-domain>
STORE_BUDGET_GB=15
# Required: an app-readable path on PostgreSQL's data filesystem.
# A readable mount anchor such as /var/lib is preferable when a Docker volume's
# data directory itself is 0700. Worker startup and ingests fail closed if this
# path cannot be checked or its emergency free-space floor would be crossed.
STORE_DATA_PATH=<readable-path-on-postgres-filesystem>
STORE_MIN_FREE_GB=2
TMP_MIN_FREE_MB=512
MAP_STORE_BUDGET_GB=20
MAP_MIN_FREE_GB=30
MAP_STORE_DATA_PATH=<readable-path-on-postgres-filesystem>
MAP_R2_BUDGET_GB=100
```

PMTiles uses two bucket-scoped S3 credentials. Copy the provided example files
to `/etc/canquery-map-read.env` and `/etc/canquery-map-write.env`, fill them
without shell history, set `root:<app-group>` ownership and mode `0640`, and
grant the API credential Object Read only. Grant the worker credential Object
Read & Write only. Keep the R2 bucket private: no public development URL,
custom domain, or browser CORS policy is required.

Never commit `.env` (it is gitignored). Apply migrations:

```bash
sudo -u canquery npm run migrate --prefix /home/canquery/canquery/server
```

## 3. Firewalls

The API listens on `:3100`. Keep it private - reachable only from loopback (and,
if your reverse proxy runs in Docker, that bridge network). Bind it to localhost
and/or add an nftables/ufw rule so `:3100` is not exposed publicly; only the
reverse proxy should reach it.

Catalogue resources are untrusted outbound input. The worker validates every
download URL and redirect, resolves every hostname, rejects non-public
addresses, and pins the validated address for the connection. Install the
nftables template as a required second layer so a future application regression
still cannot open new connections to private, loopback, link-local, metadata,
or special-purpose networks:

```bash
install -d -m 0755 /etc/canquery
cp deploy/canquery-egress.nft /etc/canquery/canquery-egress.nft
cp deploy/canquery-egress-firewall.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now canquery-egress-firewall
nft list table inet canquery_egress
```

The template matches Unix user `canquery`, permits established reverse-proxy
traffic, loopback DNS/PostgreSQL on ports 53 and 5432/5433, then rejects new
private-network destinations. If the deployment uses a different Unix user,
change both the systemd `User`/`Group` and nftables `meta skuid` value. If
PostgreSQL or the resolver lives at another private address, add only that exact
address and service port before the reject rules. Do not broadly allow the whole
Docker or RFC1918 subnet. The API and worker units require the firewall unit, and
firewall reloads replace the rules atomically.

## 4. systemd units

The repo ships templates in `deploy/`. They assume the app lives at
`/home/canquery/canquery` and runs as user `canquery`; adjust if yours differs.

```bash
cp deploy/canquery-api.service deploy/canquery-worker.service deploy/canquery-map-worker.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now canquery-api canquery-worker canquery-map-worker
curl -s http://127.0.0.1:3100/healthz   # expect {"ok":true,...}
```

`canquery-api` serves the API + SPA; `canquery-worker` drains the ingest queue;
`canquery-map-worker` builds bounded local PostGIS indexes and private-R2
PMTiles archives one at a time.
The worker unit applies a cgroup memory ceiling and gives an active ingest a
bounded grace period on SIGTERM. Excel conversion has a second, lower V8 heap
limit and timeout inside its child process.

For upgrades, run `npm run migrate` before restarting the worker. The worker
lease/heartbeat code requires migration `005_ingest_job_leases.sql`.

Confirm the configured filesystem anchor is readable by the app user before
starting the worker:

```bash
sudo -u canquery stat -f <readable-path-on-postgres-filesystem>
```

Calgary PMTiles additionally require Tippecanoe 2.79.0, pinned to immutable
commit `68ab8dcc229f95b8b25877697d5e8d66783af503`. Build it in a matching
AlmaLinux 10 environment, verify `tippecanoe --version`, then install the
read-only bundle under `/opt/canquery-tippecanoe/releases/2.79.0-68ab8dcc` and
point `/opt/canquery-tippecanoe/current` at that release. Do not install an
unversioned package at deploy time.

## 5. First harvest and place index

Dev-sized runs use `--limit`. The full catalogue harvest (~50k datasets, hours,
polite concurrency 2) should be run once under the app user (a tmux/screen
session is handy):

```bash
sudo -u canquery node /home/canquery/canquery/server/scripts/catalog-sync.js --limit 500   # warm-up
sudo -u canquery node /home/canquery/canquery/server/scripts/catalog-sync.js               # full run (resumable)

# Import the versioned Statistics Canada SGC hierarchy, then validate and sync
# every enabled municipal/source adapter.
sudo -u canquery npm run sync:places --prefix /home/canquery/canquery/server
sudo -u canquery npm run sync:municipal --prefix /home/canquery/canquery/server
sudo -u canquery npm run maps:drain --prefix /home/canquery/canquery/server
```

Use `npm run sync:source -- --source=<source-id> --dry-run` before enabling a new
source. Adapters retain publisher-specific licences and only publish resources
they can identify safely. Spatial ArcGIS leaf layers use bounded upstream
viewports; configured CKAN GeoJSON DataStore resources are queued for a bounded
local PostGIS index. Catalogued direct GeoJSON resources use the same queue and
are streamed, CRS-validated, and reprojected to WGS84 without loading a whole
file into memory. Opendatasoft sources reconstruct and validate their separate
CSV and GeoJSON export URLs from the configured catalogue identity; queued URLs
are never treated as arbitrary download targets. Socrata sources reconstruct
catalogue, CSV and paginated GeoJSON endpoints from their configured portal and
record id. Geometry tables within the row cap become immutable PMTiles in the
private object bucket; all other admitted CSVs remain discoverable and honestly
fall back to loadable or download-only according to row/column caps.
Shared CKAN portals may be configured with an exact organization filter and a
separate dataset base URL. Discovery pins the advertised count and fails closed
on count drift, duplicate or missing package ids, truncated pages, or records
outside the configured organization. Keep publisher and record-level licence
rules explicit for each municipal organization.

## 6. Cron jobs

Install a small wrapper that drops to the app user and logs to its home, then the
cron drop-in:

```bash
cat > /usr/local/sbin/canquery-run-job.sh <<'EOF'
#!/bin/sh
# usage: canquery-run-job.sh <script-basename-without-.js>
JOB="$1"
LOG="/home/canquery/logs/${JOB}.log"
touch "$LOG" && chown canquery:canquery "$LOG"
exec su -s /bin/sh canquery -c \
  "cd /home/canquery/canquery/server && node scripts/${JOB}.js >> $LOG 2>&1"
EOF
chmod +x /usr/local/sbin/canquery-run-job.sh
cat > /usr/local/sbin/canquery-run-map-job.sh <<'EOF'
#!/bin/sh
set -eu
set -a
. /etc/canquery-map-write.env
set +a
JOB="$1"
LOG="/home/canquery/logs/${JOB}.log"
touch "$LOG" && chown canquery:canquery "$LOG"
exec su -s /bin/sh canquery -c \
  "cd /home/canquery/canquery/server && node scripts/${JOB}.js >> $LOG 2>&1"
EOF
chmod 0750 /usr/local/sbin/canquery-run-map-job.sh
cp deploy/canquery.cron.d /etc/cron.d/canquery
```

Schedule (see `deploy/canquery.cron.d`): `catalog-sync` daily, `incremental-sync`
every 30 min, municipal sources daily, `evict-store` daily, and the Top 100 seed
daily. Unreferenced PMTiles objects are pruned daily after a 24-hour recovery
grace period. The versioned SGC place import runs during deployment (and again when its
configured vintage changes). The ingest worker is the systemd service from step
4, not cron. The map worker is also a systemd service; `maps:drain` is useful for
an initial source launch or controlled rebuild.

The two Search Console entries are intentionally commented out in the generic
cron template. Before enabling them, create a Google Desktop OAuth client owned
by the site operator, enable the Search Console API, and set the OAuth app to a
durable publishing status. External apps left in Testing receive seven-day
refresh tokens, which are not suitable for unattended cron jobs. Run the
authorization flow on an operator workstation so its loopback callback can open
in the same browser session, then copy only the resulting mode-0600 credential
file to the server path configured by `GSC_OAUTH_PATH`:

```bash
# On the operator workstation:
cd server
node scripts/authorize-search-console.js \
  --client-secret /private/path/desktop-oauth-client.json \
  --output /private/path/canquery-gsc-oauth.json

# Securely copy that output to GSC_OAUTH_PATH on the server, then run there:
sudo -u canquery npm run gsc:sync --prefix /home/canquery/canquery/server -- --days=90
sudo -u canquery npm run gsc:report --prefix /home/canquery/canquery/server
```

The client requests only `webmasters.readonly`. The first sync imports 90
finalized Pacific-time days; later runs replace a seven-day overlap. Serve the
file configured by `GSC_REPORT_PATH` only through an authenticated, noindex
operator route. Once the initial import and protected report are verified,
uncomment the 06:15 UTC sync and 06:30 UTC report entries.

Incremental sync advances its persisted checkpoint only after a complete
overlap-window traversal. Reaching its safety page cap records an incomplete run
and does not advance that checkpoint. A successful unlimited full sync also sweeps
upstream-deleted datasets, with a configurable maximum-delete-fraction guard.

## 7. Database backups

The local map feature cache and PMTiles archives are reproducible. To keep logical dumps compact,
exclude only its data while retaining its schema, queue, and map metadata:

```bash
pg_dump --format=custom --exclude-table-data=map_store.features canquery > canquery.dump
```

A restore destination needs the PostGIS package installed before migrations or
restore. At startup the map worker queues any metadata row whose feature data is
absent and any PMTiles row whose object is confirmed missing. R2 archives need
not be copied into the PostgreSQL dump; a restored catalogue can reuse intact
objects or rebuild missing ones from the configured Socrata source. This does
not replace an encrypted, tested off-server backup for the
catalogue and user-loaded tables.

## 8. Frontend build + reverse proxy

The API serves `client/dist` in production, so just build it next to the server:

```bash
cd /home/canquery/canquery/client && npm install && npm run build
# the API serves ../client/dist automatically; restart it after a client rebuild:
systemctl restart canquery-api
```

Then point your reverse proxy at the API. A Caddy example is in
`deploy/caddy-snippet.txt`; the equivalent in nginx is a simple `proxy_pass` to
`127.0.0.1:3100`. Terminate TLS at the proxy (e.g. Let's Encrypt).

## 9. Smoke test

```bash
curl -s https://<your-domain>/healthz
curl -s 'https://<your-domain>/api/v1/stats'
curl -s 'https://<your-domain>/api/v1/datasets?q=housing&limit=3'
curl -s 'https://<your-domain>/api/v1/places?featured=true'
curl -s 'https://<your-domain>/api/v1/places?q=Oshawa'
curl -s 'https://<your-domain>/api/v1/places?q=Toronto'
curl -s 'https://<your-domain>/api/v1/places?q=Ottawa'
curl -s 'https://<your-domain>/api/v1/places?q=Montr%C3%A9al'
curl -s 'https://<your-domain>/api/v1/places?q=Vancouver'
curl -s 'https://<your-domain>/api/v1/places?q=Calgary'
curl -s 'https://<your-domain>/api/v1/places?q=Halifax'
curl -s 'https://<your-domain>/api/v1/places?q=Hamilton'
curl -s 'https://<your-domain>/api/v1/places?q=Surrey'
curl -s 'https://<your-domain>/api/v1/places?q=Mississauga'
curl -s 'https://<your-domain>/api/v1/places?q=Brampton'
curl -s 'https://<your-domain>/api/v1/sources?place=clarington-on'
curl -s 'https://<your-domain>/api/v1/sources?place=caledon-on'
curl -s 'https://<your-domain>/api/v1/sources?place=ottawa-on'
curl -s 'https://<your-domain>/api/v1/sources?place=vancouver-bc'
curl -s 'https://<your-domain>/api/v1/sources?place=halifax-ns'
curl -s 'https://<your-domain>/api/v1/sources?place=hamilton-on'
curl -s 'https://<your-domain>/api/v1/sources?place=surrey-bc'
# UI: search by place, open a mapped dataset, pan/zoom the live Map tab, then load its table snapshot
```

## 10. Rollback

```bash
systemctl stop canquery-api canquery-worker canquery-map-worker
nft delete table inet canquery_egress
# remove the reverse-proxy block + reload the proxy; remove /etc/cron.d/canquery
```

The database can stay; it lives in its own role/db and is safe to leave in place.
