# canquery - deployment guide

A generic single-server deployment. canquery is two parts - an Express API
(`server/`) and a built React SPA (`client/`) - plus a small set of background
jobs. In production the API process serves the built SPA itself, so the only
public-facing piece you need in front of it is a TLS-terminating reverse proxy.

Placeholders to substitute: `<your-domain>` (the public hostname), `<password>`
(a generated DB password), `<contact-email>` (a polite contact for the upstream
User-Agent).

Prerequisites: Node 20+ and PostgreSQL 16 on the target host.

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
```

Create `/home/canquery/canquery/server/.env` from `.env.example`:

```
NODE_ENV=production
PORT=3100
CANQUERY_DATABASE_URL=postgres://canquery:<password>@127.0.0.1:5432/canquery
CKAN_USER_AGENT=canquery/1.0 (<contact-email>)
CORS_ALLOWED_ORIGINS=https://<your-domain>
STORE_BUDGET_GB=15
```

Never commit `.env` (it is gitignored). Apply migrations:

```bash
sudo -u canquery npm run migrate --prefix /home/canquery/canquery/server
```

## 3. Firewall (recommended)

The API listens on `:3100`. Keep it private - reachable only from loopback (and,
if your reverse proxy runs in Docker, that bridge network). Bind it to localhost
and/or add an nftables/ufw rule so `:3100` is not exposed publicly; only the
reverse proxy should reach it.

## 4. systemd units

The repo ships templates in `deploy/`. They assume the app lives at
`/home/canquery/canquery` and runs as user `canquery`; adjust if yours differs.

```bash
cp deploy/canquery-api.service deploy/canquery-worker.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now canquery-api canquery-worker
curl -s http://127.0.0.1:3100/healthz   # expect {"ok":true,...}
```

`canquery-api` serves the API + SPA; `canquery-worker` drains the ingest queue.

## 5. First harvest

Dev-sized runs use `--limit`. The full catalogue harvest (~50k datasets, hours,
polite concurrency 2) should be run once under the app user (a tmux/screen
session is handy):

```bash
sudo -u canquery node /home/canquery/canquery/server/scripts/catalog-sync.js --limit 500   # warm-up
sudo -u canquery node /home/canquery/canquery/server/scripts/catalog-sync.js               # full run (resumable)
```

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
cp deploy/canquery.cron.d /etc/cron.d/canquery
```

Schedule (see `deploy/canquery.cron.d`): `catalog-sync` daily, `incremental-sync`
every 30 min, `evict-store` daily. The ingest worker is the systemd service from
step 4, not cron.

## 7. Frontend build + reverse proxy

The API serves `client/dist` in production, so just build it next to the server:

```bash
cd /home/canquery/canquery/client && npm install && npm run build
# the API serves ../client/dist automatically; restart it after a client rebuild:
systemctl restart canquery-api
```

Then point your reverse proxy at the API. A Caddy example is in
`deploy/caddy-snippet.txt`; the equivalent in nginx is a simple `proxy_pass` to
`127.0.0.1:3100`. Terminate TLS at the proxy (e.g. Let's Encrypt).

## 8. Smoke test

```bash
curl -s https://<your-domain>/healthz
curl -s 'https://<your-domain>/api/v1/stats'
curl -s 'https://<your-domain>/api/v1/datasets?q=housing&limit=3'
# UI: open https://<your-domain> - search, open a dataset, explore a resource, view Insights
```

## 9. Rollback

```bash
systemctl stop canquery-api canquery-worker
# remove the reverse-proxy block + reload the proxy; remove /etc/cron.d/canquery
```

The database can stay; it lives in its own role/db and is safe to leave in place.
