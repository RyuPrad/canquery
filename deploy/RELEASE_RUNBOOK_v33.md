# CanQuery v33 Production Deployment Runbook

**Target Server:** `canquery-prod-01` (dedicated VPS at Little Creek Hosting)  
**Host IP:** `38.45.71.90`  
**User:** `canquery` / `root`  
**Public URL:** https://canquery.com  

---

## 1. Preflight Checks

Log in via key-only SSH:
```bash
ssh -i ~/.ssh/canquery_deploy canquery@38.45.71.90
```

Verify service status, database connectivity, and disk space:
```bash
df -h / /var/lib/postgresql
sudo systemctl status opencanada-api opencanada-worker opencanada-map-worker
psql -d opencanada -c "SELECT postgis_full_version();"
```

---

## 2. Pull Code & Verify Dependencies

```bash
cd /home/canquery/canquery
git fetch origin
git checkout main
git pull origin main

# Verify clean commit
git log -n 1 --oneline
```

Install server production dependencies and build client:
```bash
cd /home/canquery/canquery/server
npm ci --omit=dev

cd /home/canquery/canquery/client
npm ci
npm run build
```

---

## 3. Database Migration (027)

Apply migration 027 for the Quebec and Atlantic Canada expansion:
```bash
cd /home/canquery/canquery/server
npm run migrate
```

Verify migration status in PostgreSQL:
```bash
psql -d opencanada -c "SELECT id, name, applied_at FROM schema_migrations ORDER BY id DESC LIMIT 5;"
```

---

## 4. Synchronize Canonical SGC Places

Refresh the 2021 Statistics Canada SGC place hierarchy:
```bash
npm run sync:places
```

Verify place counts in database:
```bash
psql -d opencanada -c "SELECT COUNT(*) AS places_count FROM places WHERE enabled = true;"
psql -d opencanada -c "SELECT COUNT(*) AS featured_count FROM places WHERE featured = true;"
```

---

## 5. Harvest & Sync v33 Catalog Sources

Sync each of the 10 new v33 portals:
```bash
# Données Québec CKAN Portals (9 municipalities)
npm run sync:source -- --source=gatineau-open-data
npm run sync:source -- --source=trois-rivieres-open-data
npm run sync:source -- --source=repentigny-open-data
npm run sync:source -- --source=longueuil-open-data
npm run sync:source -- --source=saguenay-open-data
npm run sync:source -- --source=rimouski-open-data
npm run sync:source -- --source=shawinigan-open-data
npm run sync:source -- --source=levis-open-data
npm run sync:source -- --source=sherbrooke-open-data

# Saint John ArcGIS Hub Portal
npm run sync:source -- --source=saint-john-hub
```

Or sync all enabled municipal sources:
```bash
npm run sync:municipal
```

---

## 6. Restart Production Systemd Services

```bash
sudo systemctl restart opencanada-api opencanada-worker opencanada-map-worker
sudo systemctl status opencanada-api opencanada-worker opencanada-map-worker --no-pager
```

---

## 7. Production Health & Telemetry Verification

Verify API health, stats, and search endpoints:
```bash
curl -f https://canquery.com/healthz
curl -s https://canquery.com/api/v1/stats | jq .
curl -s "https://canquery.com/api/v1/places?featured=true" | jq '.data | length'
curl -s "https://canquery.com/api/v1/datasets?place=gatineau-qc&limit=1" | jq .
curl -s "https://canquery.com/api/v1/datasets?place=saint-john-nb&limit=1" | jq .
```

Verify TLS and security headers:
```bash
curl -I https://canquery.com/
```
