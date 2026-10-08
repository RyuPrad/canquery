# Independent component observations

`/readyz` checks API/database availability independently of publishers. It is
public, unmetered and no-store. `/healthz` and `/api/v1/ops` retain their existing
meaning and failure history. A single failed map still degrades `/ops`.

`GET /api/v1/ops/components/{component}` (also under `/web-api/v1`) exposes the
bounded sanitized host observation for `availability`, `preparation`, `maps`,
`sources`, `commercial`, `backups` or `storage`. HTTP 200 means that component's
observed checks passed; HTTP 503 means degraded, unavailable or older than
180 seconds. Unknown components return 404. Supplied keys are not authenticated
or charged, matching existing public operational routes. Set `OPS_STATUS_PATH`
to `/run/canquery/ops-status.json` in the API's private environment.

Install `observe-components.py` as a root-owned, mode-0755 file at
`/usr/local/lib/canquery/observe-components.py`. Copy the observer systemd service
and timer to `/etc/systemd/system` as root-owned files. Create a root-owned,
mode-0600 `/etc/canquery/observer.json` from `observer.example.json`, using the
actual installed service names, deployment path/user and local database user.
The example names are generic: inspect the existing host before adapting them.
The root observer executes the application status script with `runuser` as the
deployment identity, never as root. It parses only the database connection
setting from the private deployment environment as data, without sourcing a
shell file. Database queue inspection uses a read-only transaction and a
five-second PostgreSQL statement timeout. It runs no source sync, query,
preparation, billing change, retry or history reset.

The timer runs every minute. The service atomically replaces its root-owned
mode-0644 aggregate status file in a root-owned directory. No credentials,
resource/account IDs, command diagnostics or raw errors reach that file or the
public response. Missing commands, invalid observations and stale output fail
closed rather than displaying a healthy placeholder.

Thresholds are explicit: active services; running-job heartbeat no older than
90 seconds; eligible pending jobs no older than 30 minutes; fewer than three
persisted capacity failures in the last hour; current source-job observations;
no delayed (>15 minute) mail/billing backlog or accounting exceptions; and at
least 43 GiB filesystem availability above the existing 35 GiB emergency floor.
The 43 GiB value is the operating threshold, not 43 GiB additional headroom.
Capacity counts represent recorded job failures, not unpersisted admission
refusals. Deferred jobs are excluded from eligible queue age. Existing failed
map/resource history is retained and belongs to the maps component.

The backup runner supplies root-private `/var/lib/canquery-backup/status.json`
with `last_verified_at`, `last_attempt_at` (timezone-qualified ISO timestamps)
and boolean `last_attempt_ok`. Missing, failed or more than 25-hour-old verified
remote backups degrade the backup component. The observer does not upload,
delete, decrypt or validate archives itself.

After reviewed installation, enable the timer and inspect a fresh observation.
Configure external monitors separately for readiness and critical components;
avoid interpreting the existing map failure as an API outage. Prove notification
delivery with a controlled synthetic observer fault and missing-backup status,
then restore the original inputs. Preserve those private receipts. A running
timer or HTTP response alone is not proof that an alert reached its recipient.

Validation: `python3 -B deploy/test_observe_components.py` exercises mocked
commands, independent failures, stale/failed backup thresholds and output
sanitization; server tests cover no-store/unmetered route aliases, missing/stale
observations, bounds, invalid keys and database-only readiness.
