# canquery - deployment runbook (<platform>-01)

> **Production note (2026-06-13):** the live box still runs under the legacy Unix user
> `opencanada`, paths `/home/opencanada/opencanada`, and systemd units `opencanada-api` /
> `opencanada-worker` until an operator migrates them. This runbook uses the canonical
> `canquery` names for greenfield installs. `pool.js` still accepts `OPENCANADA_DATABASE_URL`
> in `.env` during the transition.

Target: the existing Netcup box `<platform>-01` (<redacted-ip>, Debian 13) that already
runs <other-project> (:3000), <self-hosted services> (Docker), <other-project> (:3456), <other-service>
(:3457), and Caddy-in-Docker as the only public ingress. The whole server is a git
working tree rooted at `/` (repo `<host>`).

**Nothing below is automated. Every step is run by an operator, in order. Steps
touching systemd, Caddy, cron, or the warehouse Postgres require explicit owner
approval first (house guardrail).**

## 0. Decisions to confirm before starting

- **Domain**: `DATA_DOMAIN` placeholder throughout (suggestion: `data.<other-project>.com`).
  Confirm with the owner; add DNS A record → <redacted-ip> before the Caddy step.
- **Database**: default plan is a new database `canquery` + role on the **existing
  warehouse Postgres instance** (the one the <crawler> uses) - NOT the <platform>
  Postgres. If the warehouse instance is unsuitable (RAM budget), the fallback is a
  dedicated `postgres:16-alpine` container with its own volume - ask first.
- Disk budget: DB + logs stay under ~20 GB total (`STORE_BUDGET_GB=15` plus catalog
  mirror + logs). The box has other tenants.

## 1. App user + code

```bash
adduser --disabled-password --gecos 'canquery app' canquery
sudo -u canquery git clone <repo-url> /home/canquery/canquery
cd /home/canquery/canquery/server && sudo -u canquery npm install --omit=dev
mkdir -p /home/canquery/logs && chown canquery:canquery /home/canquery/logs
```

## 2. Database (warehouse Postgres - requires approval)

```bash
# as the warehouse postgres superuser:
psql -c "CREATE ROLE canquery LOGIN PASSWORD '<generated>'"
psql -c "CREATE DATABASE canquery OWNER canquery"
```

Then as the app user create `/home/canquery/canquery/server/.env` from
`.env.example`:

```
NODE_ENV=production
PORT=3100
CANQUERY_DATABASE_URL=postgres://canquery:<password>@127.0.0.1:5432/canquery
CKAN_USER_AGENT=canquery/1.0 (<redacted-email>)
CORS_ALLOWED_ORIGINS=https://DATA_DOMAIN
STORE_BUDGET_GB=15
```

Never commit `.env` (<host> `.gitignore` already excludes it). Run migrations:

```bash
sudo -u canquery npm run migrate --prefix /home/canquery/canquery/server
```

## 3. Port check + firewall (requires approval)

:3100 must be free and must end up reachable only from loopback + the <platform>
Docker network (where Caddy lives) - same pattern as <other-project>'s :3000.

```bash
ss -tlnp | grep -E ':(3100)\s' || echo "3100 free"
# Clone the existing unit + script pair and adjust the port:
cp /etc/systemd/system/<other-project>-api-port3000-firewall.service \
   /etc/systemd/system/canquery-api-port3100-firewall.service
cp /usr/local/sbin/<other-project>-api-port3000-firewall.sh \
   /usr/local/sbin/canquery-api-port3100-firewall.sh
# edit both: 3000 → 3100, table name <other-project>_api_3000 → canquery_api_3100
systemctl daemon-reload && systemctl enable --now canquery-api-port3100-firewall
```

(The repo's `deploy/canquery-api.service` already `After=`/`Wants=` this unit.)

## 4. systemd units (requires approval)

```bash
cp deploy/canquery-api.service deploy/canquery-worker.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now canquery-api canquery-worker
curl -s http://127.0.0.1:3100/healthz   # expect {"ok":true,...} (db may be true, upstream true)
```

## 5. First harvest (requires approval - full 50k crawl)

Dev-sized runs use `--limit`. The full harvest (~50k datasets, hours, polite
concurrency 2) should be run once under the app user, ideally in tmux:

```bash
sudo -u canquery node /home/canquery/canquery/server/scripts/catalog-sync.js --limit 500   # warm-up sanity
sudo -u canquery node /home/canquery/canquery/server/scripts/catalog-sync.js              # full run (resumable)
```

## 6. Cron (requires approval)

Install the wrapper (clone of `run-scheduled-job.sh`): drops to the `canquery`
user, runs the named script, appends to `/home/canquery/logs/<job>.log`:

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

Schedule (from `deploy/canquery.cron.d`): catalog-sync 02:15 daily,
incremental-sync every 30 min, evict-store 03:45 daily. The ingest worker is the
systemd service from step 4, not cron.

## 7. Frontend build + Caddy (requires approval)

```bash
cd /home/canquery/canquery/client
npm install && VITE_API_BASE_URL= npm run build
mkdir -p /srv/canquery && rsync -a --delete dist/ /srv/canquery/
```

Mount `/srv/canquery` into the `<platform>-caddy` container (compose overlay
volume), then add the `deploy/caddy-snippet.txt` block (with the real domain) to
the **live** `opt/<platform>-project/volumes/proxy/caddy/Caddyfile` and reload:

```bash
docker exec <platform>-caddy caddy reload --config /etc/caddy/Caddyfile
```

House rule: after editing the live Caddyfile, re-sync the sanitized snapshot under
`deploy/caddy/` in the <host> repo and commit.

## 8. <host> repo bookkeeping

Track in the `<host>` repo: the two unit files, the firewall unit + script, the
cron drop-in, the run wrapper, and the sanitized Caddy snippet. Commit as
`Mirror canquery <desc>`. Never `git add -A` from `/`; never commit `.env`,
volumes, logs, or store data.

## 9. Smoke checklist (post-deploy)

```bash
curl -s https://DATA_DOMAIN/healthz
curl -s 'https://DATA_DOMAIN/api/v1/stats'
curl -s 'https://DATA_DOMAIN/api/v1/datasets?q=housing&limit=3'
# UI: open https://DATA_DOMAIN - search, open a dataset, explore a queryable resource
```

Rollback: `systemctl stop canquery-api canquery-worker`, remove the Caddy block
+ reload, remove `/etc/cron.d/canquery`. The database can stay; it is isolated in
its own role/db.
