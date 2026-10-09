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
boolean `last_attempt_ok`, and `last_attempt_status` (`running`, `failed`, or
`succeeded`). A running attempt is allowed two hours while the previous verified
recovery point remains at most 25 hours old. A failed attempt degrades immediately;
legacy status files without attempt state require `last_attempt_ok=true`. Missing,
failed or more than 25-hour-old verified remote backups degrade the backup component. The observer does not upload,
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

## Optional capacity history

This extension is opt-in. The existing 60-second timer,
public status contract, 43 GiB total-available warning and 35 GiB emergency
threshold remain unchanged. Other storage floors and budgets remain owned by
application configuration. Collection runs no ingestion, synchronization, backup,
eviction, PostgreSQL vacuum, or restore commands.

The optional `history_path` enables a root-private SQLite file. The example JSON
is an additive fragment; the optional service drop-in permits its private state
directory. Installation requires an independent observer operations promotion.
The private schema is version 2. The earlier undeployed proposal's incompatible
SQLite files are refused, not overwritten or silently reinterpreted; preserve
such files and select a new history file. No production migration is required.

### Public publication and private sampling

The original public queue query and component observation function are unchanged.
Public health is atomically published before any private job-history query,
backup-state read, filesystem sample, or history persistence begins. Private
failures cannot alter that published document. Private collection failures log
only a generic `capacity_history_failed` event, without command diagnostics.

A separate read-only private query has a two-second statement timeout, 100 ms
lock timeout, three-second subprocess deadline and bounded output. It returns
at most 101 job rows; more than 100 makes job state unknown rather than presenting
a truncated list as complete. Reported types are tabular ingestion, local maps,
PMTiles, source sync and other scheduled jobs. Identities are opaque hashes.
No resource IDs, account records, URLs, raw SQL errors or environment values
enter the history.

Private job state, backup status and filesystem availability are read consecutively
before the daily size query. Samples record the interval start/end, each read's
observation time, monotonic elapsed duration, filesystem device and available
bytes (`f_bavail`, excluding root-reserved space). The copied public component
states retain their separate public-generation timestamp. Failed reads remain
unknown. Legacy backup status without an explicit attempt state is unknown.

Combinations mean **activity reported during the same observation interval**.
Running rows or a backup status file can be stale; these records do not prove
actual overlap. First/last samples do not establish job start/finish times or
causal allocations. Manual release staging, unrelated applications and PostgreSQL
background work are not attributed. A 60-second sample can miss short jobs and
lower free-space troughs; sampled minima are upper bounds on the true minimum.

### One daily size-query attempt

Before invoking PostgreSQL, commit a UTC-day reservation under a short SQLite
write transaction with FULL synchronization. Only a successfully committed new
reservation permits a query, with no SQLite write transaction held across it.
A permanent last-reserved-day marker also prevents reattempts after clock rollback.
If reservation or its commit fails, skip the query. If the day changes before
the query starts, retain the reservation without querying.

The query retains its two-second statement and 100 ms lock bounds, plus a
three-second subprocess deadline. It reads application database bytes, schema
relation totals, prepared/retired metadata, local-map recorded estimates and
referenced PMTiles bytes. It scans no feature rows. Relation totals count
indexes/TOAST once, excluding separate TOAST and shared relations. Recorded map
sizes and referenced PMTiles bytes remain distinct from physical relation size
and remote bucket inventory.

Update the reservation to `ok` or `unavailable` in a separate transaction. A
result-write/commit failure or process interruption leaves `reserved`, meaning
**outcome unknown; no same-day retry**, even if the query never started. The next
UTC day permits a new attempt. Trimming never removes the reservation high-water
mark. Database-directory allocation minus listed relations is not a reclaimable
space calculation. The separately audited PostgreSQL files remain **unmapped;
reclaimability unestablished**.

### Bounded retention and footprint

Only this private telemetry has a 30-day retention target. The database ceiling
is 16,384 pages of 4,096 bytes: 64 MiB. Before appending, remove expired samples
or, below 512 KiB of usable page headroom, the oldest samples. Work is limited to
four batches of at most 256 samples per invocation, including a single retry
following SQLITE_FULL. Pages are reused; no vacuum or database replacement runs.
After a long outage, expired-row backlog is drained over bounded invocations;
reports still use the requested calendar window. If the bounded work cannot
permit insertion, the invocation reports a private failure and the next timer
run can continue. No application data, backup, release or cache is removed.

Every trimming transaction records the count, removed time range and reason,
plus per-day losses and the cumulative shortened coverage. The current daily
reservation and permanent control state remain protected. Reports distinguish
trimmed coverage from days on which no sample was recorded.

**64 MiB is the database cap, not the total footprint.** DELETE journaling and
bounded transactions retain crash recovery; cache spilling is disabled and SQL
temporary work uses memory. Allow a conservative **130 MiB of local working
space** for the database, a journal approaching database size, page-record/header
overhead and allocation rounding. This is a planning estimate, not a filesystem
quota. `journal_size_limit` does not cap a live transaction's journal. See
[SQLite's journal-size documentation](https://www.sqlite.org/pragma.html#pragma_journal_size_limit).

The observer samples database, journal and any SQLite sidecar logical/allocated
bytes before commits and retains observed high-water values. These are observed
footprints, not exact continuous peaks. Disposable cap tests additionally inspect
active journal size and continued writes. Journal removal is SQLite's normal
transaction completion/recovery, not application cleanup. The history directory
must be mode 0700 and files 0600, with existing ownership/symlink/hardlink guards
and a 200 ms SQLite busy timeout.

### Private daily reports and verification

`daily_capacity` and `daily_components` cover all 30 UTC dates ending today,
including the partial current day. Missing days have zero sample counts and null
extrema; they never imply healthy or unavailable component observations. Capacity
rows distinguish before-collection, no-sample, observed and shortened-retention
coverage, retaining device identity. Gap statistics include the beginning and
end of each day, clipped to the report time; they are within-day gaps, not inferred
exact outages. Test/report SQL can bind an explicit `:as_of` timestamp.

`history_status` reports latest-sample time/age, missing or stale history, clock
rollback, retained duration, trimming totals and observed footprint maxima.
Freshness becomes stale after 180 seconds; this is a private reporting label and
does not change public component thresholds. `job_minima` groups by reported
attempt/device. `activity_minima` groups complete samples by reported combination,
not proven simultaneous activity. Queries in `capacity-history-queries.sql` use a
read-only connection or retained copy. No missing measurements are backfilled.

Run the observer tests and deployment Python suite with ResourceWarning treated
as an error on Python 3.12.11 / SQLite 3.46.1 (production versions) and Python
3.14.4 / SQLite 3.46.1. Verify independent private-query failure/timeouts, durable
reservation failures/interruption/concurrency, next-day behavior, near-cap
continued collection, active journal footprint, missing days and freshness.
Tests use local disposable files and mocked external observations. They establish
implementation behavior, not actual production peaks or a storage purchase need.

### Observer-only promotion and recovery

An observer-only release does not change the application release or backup runner.
After all exact-commit CI jobs pass, verify the trusted artifact checksum and its
per-file manifest. Extract only the reviewed observer, private-report SQL and
reference files into a new root-owned immutable observer release beneath
`/opt/canquery-operations/observer-releases/<commit>`. Record the artifact,
commit, source-file hashes and exact predecessor. Do not replace backup binaries,
cron targets, runtime environments or `/opt/canquery/current`.

Capture the current observer entrypoint, unit/drop-ins and private configuration,
and verify a current complete scheduled backup receipt. Pause only the observer
timer and let any running observation finish before atomically promoting the
verified entrypoint. Add `history_path` to the existing configuration without
replacing other keys, and install the narrow state-directory drop-in. Include
that drop-in directory in the existing recovery-configuration inventory. Preserve
all backup settings and the independently pinned backup runner. Reload systemd,
resume the unchanged timer, and observe its normal invocations.

Acceptance requires successful public publication, unchanged public component
semantics, private ownership, multiple naturally scheduled samples, the durable
daily attempt and filesystem identity, plus unchanged application/worker PIDs and
storage thresholds. Confirm the following scheduled sample does not issue another
daily size query. Do not induce production failures, start work to obtain an
overlap, or describe sampled combinations as proven simultaneous execution.

Compatible recovery pauses/drains only the observer, verifies the installed
release/configuration against the captured predecessor guards, restores the
previous observer entrypoint and only the changed configuration/drop-in fields,
then resumes its timer. Preserve the SQLite history and original receipts. Keep
the recovery inventory accurate for retained configuration; remove no databases,
application data or telemetry during recovery. A restore drill is separate from
this observer-only promotion.
