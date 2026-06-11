# opencanada - deployment runbook (<platform>-01)

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
- **Database**: default plan is a new database `opencanada` + role on the **existing
  warehouse Postgres instance** (the one the <crawler> uses) - NOT the <platform>
  Postgres. If the warehouse instance is unsuitable (RAM budget), the fallback is a
  dedicated `postgres:16-alpine` container with its own volume - ask first.
- Disk budget: DB + logs stay under ~20 GB total (`STORE_BUDGET_GB=15` plus catalog
  mirror + logs). The box has other tenants.

## 1. App user + code

```bash
adduser --disabled-password --gecos 'opencanada app' opencanada
sudo -u opencanada git clone <repo-url> /home/opencanada/opencanada
cd /home/opencanada/opencanada/server && sudo -u opencanada npm install --omit=dev
mkdir -p /home/opencanada/logs && chown opencanada:opencanada /home/opencanada/logs
```

## 2. Database (warehouse Postgres - requires approval)

```bash
# as the warehouse postgres superuser:
psql -c "CREATE ROLE opencanada LOGIN PASSWORD '<generated>'"
psql -c "CREATE DATABASE opencanada OWNER opencanada"
```

Then as the app user create `/home/opencanada/opencanada/server/.env` from
`.env.example`:

```
NODE_ENV=production
PORT=3100
OPENCANADA_DATABASE_URL=postgres://opencanada:<password>@127.0.0.1:5432/opencanada
CKAN_USER_AGENT=opencanada/1.0 (<redacted-email>)
CORS_ALLOWED_ORIGINS=https://DATA_DOMAIN
STORE_BUDGET_GB=15
```

Never commit `.env` (<host> `.gitignore` already excludes it). Run migrations:

```bash
sudo -u opencanada npm run migrate --prefix /home/opencanada/opencanada/server
```

## 3. Port check + firewall (requires approval)

:3100 must be free and must end up reachable only from loopback + the <platform>
Docker network (where Caddy lives) - same pattern as <other-project>'s :3000.

```bash
ss -tlnp | grep -E ':(3100)\s' || echo "3100 free"
# Clone the existing unit + script pair and adjust the port:
cp /etc/systemd/system/<other-project>-api-port3000-firewall.service \
   /etc/systemd/system/opencanada-api-port3100-firewall.service
cp /usr/local/sbin/<other-project>-api-port3000-firewall.sh \
   /usr/local/sbin/opencanada-api-port3100-firewall.sh
# edit both: 3000 → 3100, table name <other-project>_api_3000 → opencanada_api_3100
systemctl daemon-reload && systemctl enable --now opencanada-api-port3100-firewall
```

(The repo's `deploy/opencanada-api.service` already `After=`/`Wants=` this unit.)

## 4. systemd units (requires approval)

```bash
cp deploy/opencanada-api.service deploy/opencanada-worker.service /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now opencanada-api opencanada-worker
curl -s http://127.0.0.1:3100/healthz   # expect {"ok":true,...} (db may be true, upstream true)
```

## 5. First harvest (requires approval - full 50k crawl)

Dev-sized runs use `--limit`. The full harvest (~50k datasets, hours, polite
concurrency 2) should be run once under the app user, ideally in tmux:

```bash
sudo -u opencanada node /home/opencanada/opencanada/server/scripts/catalog-sync.js --limit 500   # warm-up sanity
sudo -u opencanada node /home/opencanada/opencanada/server/scripts/catalog-sync.js              # full run (resumable)
```

## 6. Cron (requires approval)

Install the wrapper (clone of `run-scheduled-job.sh`): drops to the `opencanada`
user, runs the named script, appends to `/home/opencanada/logs/<job>.log`:

```bash
cat > /usr/local/sbin/opencanada-run-job.sh <<'EOF'
#!/bin/sh
# usage: opencanada-run-job.sh <script-basename-without-.js>
JOB="$1"
LOG="/home/opencanada/logs/${JOB}.log"
touch "$LOG" && chown opencanada:opencanada "$LOG"
exec su -s /bin/sh opencanada -c \
  "cd /home/opencanada/opencanada/server && node scripts/${JOB}.js >> $LOG 2>&1"
EOF
chmod +x /usr/local/sbin/opencanada-run-job.sh
cp deploy/opencanada.cron.d /etc/cron.d/opencanada
```

Schedule (from `deploy/opencanada.cron.d`): catalog-sync 02:15 daily,
incremental-sync every 30 min, evict-store 03:45 daily. The ingest worker is the
systemd service from step 4, not cron.

## 7. Frontend build + Caddy (requires approval)

```bash
cd /home/opencanada/opencanada/client
npm install && VITE_API_BASE_URL= npm run build
mkdir -p /srv/opencanada && rsync -a --delete dist/ /srv/opencanada/
```

Mount `/srv/opencanada` into the `<platform>-caddy` container (compose overlay
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
`Mirror opencanada <desc>`. Never `git add -A` from `/`; never commit `.env`,
volumes, logs, or store data.

## 9. Smoke checklist (post-deploy)

```bash
curl -s https://DATA_DOMAIN/healthz
curl -s 'https://DATA_DOMAIN/api/v1/stats'
curl -s 'https://DATA_DOMAIN/api/v1/datasets?q=housing&limit=3'
# UI: open https://DATA_DOMAIN - search, open a dataset, explore a queryable resource
```

Rollback: `systemctl stop opencanada-api opencanada-worker`, remove the Caddy block
+ reload, remove `/etc/cron.d/opencanada`. The database can stay; it is isolated in
its own role/db.
