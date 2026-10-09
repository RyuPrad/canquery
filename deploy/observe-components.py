#!/usr/bin/env python3
"""Root-owned, read-only host observations; never publish command output/errors."""
import argparse
from contextlib import contextmanager
import hashlib
import datetime as dt
import json
import math
import os
from pathlib import Path
import re
import shlex
import signal
import sqlite3
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

COMPONENTS = ("availability", "preparation", "maps", "sources", "commercial", "backups", "storage")
COMMERCIAL_METRICS = ("expired_reservations", "billing_retries", "delayed_billing_events",
                      "failed_mail", "delayed_mail", "terminal_preparation_charges", "missing_preparation_jobs")
QUEUE_SQL = """
BEGIN READ ONLY;
SET LOCAL statement_timeout='5s';
SELECT json_build_object(
 'preparation', (SELECT json_build_object(
   'eligible_pending',count(*) FILTER(WHERE status='pending' AND next_attempt_at<=now()),
   'running',count(*) FILTER(WHERE status='running'),
   'stale_running',count(*) FILTER(WHERE status='running' AND coalesce(heartbeat_at,claimed_at,created_at)<now()-interval '90 seconds'),
   'oldest_pending_seconds',coalesce(max(extract(epoch FROM now()-created_at)) FILTER(WHERE status='pending' AND next_attempt_at<=now()),0),
   'capacity_failures_last_hour',count(*) FILTER(WHERE failure_code='CAPACITY' AND finished_at>=now()-interval '1 hour')
 ) FROM public.ingest_jobs),
 'maps', (SELECT json_build_object(
   'eligible_pending',count(*) FILTER(WHERE status='pending' AND next_attempt_at<=now()),
   'running',count(*) FILTER(WHERE status='running'),
   'stale_running',count(*) FILTER(WHERE status='running' AND coalesce(heartbeat_at,claimed_at,created_at)<now()-interval '90 seconds'),
   'oldest_pending_seconds',coalesce(max(extract(epoch FROM now()-created_at)) FILTER(WHERE status='pending' AND next_attempt_at<=now()),0),
   'failed_resources',count(*) FILTER(WHERE status='failed')
 ) FROM public.map_index_jobs));
COMMIT;
"""

# Independent private read, invoked only after public health publication.
HISTORY_JOBS_SQL = """
BEGIN READ ONLY;
SET LOCAL statement_timeout='2s';
SET LOCAL lock_timeout='100ms';
SELECT coalesce(json_agg(j),'[]'::json) FROM (
 SELECT 'tabular' AS type, md5('ingest:' || id::text || ':' || coalesce(claimed_at::text,'')) AS attempt
 FROM public.ingest_jobs WHERE status='running'
 UNION ALL
 SELECT CASE WHEN candidate->>'mode'='socrata-geojson-pmtiles' THEN 'pmtiles' ELSE 'local_map' END,
 md5('map:' || resource_id || ':' || coalesce(claimed_at::text,''))
 FROM public.map_index_jobs WHERE status='running'
 UNION ALL
 SELECT CASE WHEN source_id IS NOT NULL THEN 'source_sync' ELSE 'scheduled_job' END,
 md5('sync:' || id::text) FROM public.sync_runs WHERE finished_at IS NULL
 LIMIT 101
) j;
COMMIT;
"""
CAPACITY_SQL = """
BEGIN READ ONLY;
SET LOCAL statement_timeout='2s';
SET LOCAL lock_timeout='100ms';
SELECT json_build_object(
 'application_database_bytes',pg_database_size(current_database()),
 'schema_relation_bytes',(SELECT json_object_agg(schema,bytes) FROM (
   SELECT n.nspname AS schema,sum(pg_total_relation_size(c.oid))::bigint AS bytes
   FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE c.relkind IN ('r','m') AND NOT c.relisshared AND n.nspname<>'pg_toast'
   GROUP BY n.nspname) s),
 'prepared_recorded_bytes',(SELECT coalesce(sum(byte_size),0) FROM public.ingested_resources WHERE status='ready'),
 'retired_recorded_bytes',(SELECT coalesce(sum(byte_size),0) FROM public.retired_ingest_tables),
 'local_map_recorded_bytes',(SELECT coalesce(sum(byte_size),0) FROM public.resource_maps WHERE provider='canquery'),
 'pmtiles_referenced_bytes',(SELECT coalesce(sum(byte_size),0) FROM public.resource_maps WHERE provider='pmtiles'));
COMMIT;
"""
JOB_TYPES = frozenset(('tabular', 'local_map', 'pmtiles', 'source_sync', 'scheduled_job', 'backup'))
HISTORY_VERSION = 2
HISTORY_MAX_PAGES = 16384  # 64 MiB database, excluding transient journals.
HISTORY_HEADROOM_PAGES = 128
HISTORY_TRIM_BATCH = 256
HISTORY_TRIM_BATCHES = 4
HISTORY_FRESH_SECONDS = 180
REPORT_DAYS = """
WITH RECURSIVE days(day) AS (
 SELECT date(:as_of,'unixepoch','-29 days')
 UNION ALL SELECT date(day,'+1 day') FROM days WHERE day<date(:as_of,'unixepoch')
)
"""
DAILY_CAPACITY_SQL = REPORT_DAYS + """
, intervals AS (
 SELECT *,at-lag(at) OVER (PARTITION BY date(at,'unixepoch'),device ORDER BY at) AS gap
 FROM samples WHERE at<=:as_of
), totals AS (
 SELECT date(at,'unixepoch') AS day,device,count(*) AS samples,count(free_bytes) AS free_samples,
 min(at) AS first_at,max(at) AS last_at,min(free_bytes) AS minimum_available_bytes,
 max(free_bytes) AS maximum_available_bytes,coalesce(max(gap),0) AS internal_gap,
 coalesce(sum(gap>90),0) AS internal_gaps,sum(jobs_complete=0) AS incomplete_job_samples
 FROM intervals GROUP BY day,device
)
SELECT d.day,t.device,coalesce(t.samples,0) AS samples,coalesce(t.free_samples,0) AS free_samples,
 t.first_at,t.last_at,t.minimum_available_bytes,t.maximum_available_bytes,
 max(coalesce(t.internal_gap,0),
     coalesce(t.first_at, min(:as_of,unixepoch(d.day,'+1 day')))-unixepoch(d.day),
     min(:as_of,unixepoch(d.day,'+1 day'))-coalesce(t.last_at,unixepoch(d.day))) AS maximum_within_day_gap_seconds,
 coalesce(t.internal_gaps,0) + CASE WHEN t.samples IS NULL THEN
     (min(:as_of,unixepoch(d.day,'+1 day'))-unixepoch(d.day)>90)
 ELSE (t.first_at-unixepoch(d.day)>90) +
      (min(:as_of,unixepoch(d.day,'+1 day'))-t.last_at>90) END AS gaps_over_90_seconds,
 coalesce(t.incomplete_job_samples,0) AS incomplete_job_samples,
 coalesce(r.dropped_samples,0) AS dropped_samples,
 CASE WHEN r.dropped_samples>0 THEN 'shortened_retention'
      WHEN unixepoch(d.day,'+1 day')<=h.initialized_at THEN 'before_collection'
      WHEN t.samples IS NULL THEN 'no_samples' ELSE 'observed' END AS coverage_status
FROM days d LEFT JOIN totals t ON t.day=d.day
LEFT JOIN retention_days r ON r.day=d.day CROSS JOIN history_state h
"""
DAILY_COMPONENTS_SQL = REPORT_DAYS + """
, names(component) AS (VALUES ('availability'),('preparation'),('maps'),('sources'),('commercial'),('backups'),('storage')),
 totals AS (
 SELECT date(at,'unixepoch') AS day,c.key AS component,count(*) AS samples,
 sum(c.value='ok') AS ok_samples,sum(c.value='degraded') AS degraded_samples,
 sum(c.value='unavailable') AS unavailable_samples
 FROM samples,json_each(samples.components) c WHERE at<=:as_of GROUP BY day,component
)
SELECT d.day,n.component,coalesce(t.samples,0) AS samples,coalesce(t.ok_samples,0) AS ok_samples,
 coalesce(t.degraded_samples,0) AS degraded_samples,coalesce(t.unavailable_samples,0) AS unavailable_samples
FROM days d CROSS JOIN names n LEFT JOIN totals t ON t.day=d.day AND t.component=n.component
"""
HISTORY_STATUS_SQL = """
SELECT h.*,s.first_sample_at,s.latest_sample_at,
 CASE WHEN s.latest_sample_at IS NOT NULL THEN :as_of-s.latest_sample_at END AS latest_sample_age_seconds,
 CASE WHEN s.latest_sample_at IS NULL THEN 'missing'
      WHEN s.latest_sample_at>:as_of THEN 'clock_error'
      WHEN :as_of-s.latest_sample_at>180 THEN 'stale' ELSE 'fresh' END AS freshness,
 CASE WHEN s.first_sample_at IS NOT NULL THEN max(0,:as_of-s.first_sample_at) END AS retained_window_seconds
FROM history_state h CROSS JOIN (
 SELECT min(at) AS first_sample_at,max(at) AS latest_sample_at FROM samples
) s
"""
HISTORY_SCHEMA = """
CREATE TABLE samples (
 at INTEGER PRIMARY KEY, device INTEGER, free_bytes INTEGER, jobs TEXT,
 jobs_complete INTEGER NOT NULL, activity TEXT NOT NULL, components TEXT NOT NULL,
 observation_seconds REAL NOT NULL,interval_started_at REAL NOT NULL,interval_finished_at REAL NOT NULL,
 jobs_observed_at REAL NOT NULL,backup_observed_at REAL NOT NULL,filesystem_observed_at REAL NOT NULL,
 public_generated_at REAL NOT NULL
);
CREATE TABLE component_sizes (
 day TEXT PRIMARY KEY,at INTEGER NOT NULL,status TEXT NOT NULL,measurements TEXT,
 completed_at INTEGER
);
CREATE TABLE history_state (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),initialized_at INTEGER NOT NULL,
 last_reserved_day TEXT,removed_samples INTEGER NOT NULL DEFAULT 0,last_trim_at INTEGER,
 trimmed_through INTEGER,write_sequence INTEGER NOT NULL DEFAULT 0,
 peak_database_bytes INTEGER NOT NULL DEFAULT 0,peak_journal_bytes INTEGER NOT NULL DEFAULT 0,
 peak_total_bytes INTEGER NOT NULL DEFAULT 0,peak_allocated_bytes INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE retention_days (
 day TEXT PRIMARY KEY,dropped_samples INTEGER NOT NULL,first_removed_at INTEGER NOT NULL,
 last_removed_at INTEGER NOT NULL,last_reason TEXT NOT NULL
);
CREATE VIEW job_minima AS
 SELECT device,json_extract(j.value,'$.type') AS job_type,
 json_extract(j.value,'$.attempt') AS attempt,count(*) AS observed_samples,
 min(at) AS first_observed_at,max(at) AS last_observed_at,min(free_bytes) AS minimum_available_bytes
 FROM samples,json_each(samples.jobs) j GROUP BY device,job_type,attempt;
CREATE VIEW activity_minima AS
 SELECT date(at,'unixepoch') AS day,device,activity,count(*) AS observed_samples,
 min(free_bytes) AS minimum_available_bytes
 FROM samples WHERE jobs_complete=1 GROUP BY day,device,activity;
"""
for _name, _query in (('daily_capacity', DAILY_CAPACITY_SQL),
                      ('daily_components', DAILY_COMPONENTS_SQL),('history_status', HISTORY_STATUS_SQL)):
    HISTORY_SCHEMA += 'CREATE VIEW ' + _name + ' AS ' + _query.replace(':as_of', "unixepoch('now')") + ';\n'


def command(args, *, cwd=None, env=None):
    result = subprocess.run(args, cwd=cwd, env=env, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, check=True, timeout=12, text=True)
    if len(result.stdout) > 1_048_576:
        raise ValueError("Observation exceeded its output bound")
    return result.stdout


def json_http(url):
    try:
        response = urllib.request.urlopen(url, timeout=5)
    except urllib.error.HTTPError as error:
        if error.code != 503:
            raise
        response = error
    with response:
        content = response.read(131073)
        if len(content) > 131072:
            raise ValueError("HTTP observation exceeded its output bound")
        return json.loads(content)


def healthy(ok, checks):
    return {"ok": bool(ok), "status": "ok" if ok else "degraded", "checks": checks}


def unavailable():
    return {"ok": False, "status": "unavailable", "checks": {}}


def numbers(values, names):
    result = {}
    for name in names:
        value = values[name]
        if isinstance(value, bool):
            raise ValueError("Expected numeric aggregate")
        value = float(value)
        if not math.isfinite(value) or value < 0:
            raise ValueError("Invalid numeric aggregate")
        result[name] = int(value) if value.is_integer() else value
    return result


def service_states(text):
    states = {}
    for block in text.strip().split("\n\n"):
        fields = dict(line.split("=", 1) for line in block.splitlines() if "=" in line)
        if fields.get("Id"):
            states[fields["Id"]] = fields.get("ActiveState") == "active"
    return states


def database_environment(filename):
    # Parse data, never source shell code. Only the database setting is needed
    # by the read-only commercial status command, which runs as deployment.
    env = {"PATH": "/usr/local/bin:/usr/bin:/bin", "NODE_ENV": "production"}
    if filename:
        for line in Path(filename).read_text().splitlines():
            if "=" not in line or line.lstrip().startswith("#"):
                continue
            key, raw = line.split("=", 1)
            if key.strip() not in ("CANQUERY_DATABASE_URL", "OPENCANADA_DATABASE_URL"):
                continue
            values = shlex.split(raw, comments=True)
            if len(values) != 1:
                raise ValueError("Database environment requires one quoted or unquoted value")
            env[key.strip()] = values[0]
    return env


def age_seconds(timestamp, now):
    parsed = dt.datetime.fromisoformat(timestamp.replace("Z", "+00:00"))
    if parsed.tzinfo is None:
        raise ValueError("Observation timestamps require timezone")
    age = (now - parsed).total_seconds()
    if age < -30:
        raise ValueError("Observation timestamp is in the future")
    return max(0, age)


def observe(config, run=command, fetch=json_http, now=None, statfs=os.statvfs, read_json=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    read_json = read_json or (lambda filename: json.loads(Path(filename).read_text()))
    output = {name: unavailable() for name in COMPONENTS}
    services = config["services"]
    try:
        states = service_states(run(["/usr/bin/systemctl", "show", "--no-pager", "--property=Id",
                                     "--property=ActiveState", *services.values()]))
    except Exception:
        states = {}
    active = lambda name: states.get(services.get(name), False)
    try:
        ready = fetch("http://127.0.0.1:" + str(config.get("api_port", 3100)) + "/readyz")
        output["availability"] = healthy(active("api") and ready.get("db") is True,
                                          {"service_active": active("api"), "database_ready": ready.get("db") is True})
    except Exception:
        pass
    try:
        queues = json.loads(run(["/usr/sbin/runuser", "-u", config["database_os_user"], "--",
                                 config.get("psql", "/usr/bin/psql"), "-XAtq", "-v", "ON_ERROR_STOP=1",
                                 "--dbname", config["database"], "-c", QUEUE_SQL]))
        for name in ("preparation", "maps"):
            names = ["eligible_pending", "running", "stale_running", "oldest_pending_seconds"]
            names += ["capacity_failures_last_hour"] if name == "preparation" else ["failed_resources"]
            checks = {**numbers(queues[name], names), "service_active": active(name)}
            ok = checks["service_active"] and checks["stale_running"] == 0 and checks["oldest_pending_seconds"] <= 1800
            ok = ok and (checks.get("capacity_failures_last_hour", 0) < 3) and checks.get("failed_resources", 0) == 0
            output[name] = healthy(ok, checks)
    except Exception:
        pass
    try:
        ops = fetch("http://127.0.0.1:" + str(config.get("api_port", 3100)) + "/api/v1/ops")
        jobs = ops["data"]["jobs"]
        if not isinstance(jobs, dict) or not jobs:
            raise ValueError("Missing source observations")
        checks = {"failed_jobs": sum(job["status"] == "failed" for job in jobs.values()),
                  "stale_jobs": sum(job["status"] in ("stale", "pending") for job in jobs.values())}
        output["sources"] = healthy(not any(checks.values()), checks)
    except Exception:
        pass
    try:
        app_dir = config["app_dir"]
        status = json.loads(run(["/usr/sbin/runuser", "-u", config["deploy_user"], "--",
                                 config.get("node", "/usr/bin/node"), str(Path(app_dir) / "server/scripts/commercial-admin.js"), "status"],
                                cwd=str(Path(app_dir) / "server"), env=database_environment(config.get("deployment_environment"))))
        checks = numbers(status, COMMERCIAL_METRICS)
        checks["service_active"] = active("api")
        checks["mail_services_active"] = all(active(name) for name in ("mail_auth", "mail_dkim", "mail_certificate"))
        output["commercial"] = healthy(not any(checks[name] for name in COMMERCIAL_METRICS) and checks["service_active"] and checks["mail_services_active"], checks)
    except Exception:
        pass
    try:
        backup = read_json(config.get("backup_status", "/var/lib/canquery-backup/status.json"))
        age = age_seconds(backup["last_verified_at"], now)
        attempt_age = age_seconds(backup["last_attempt_at"], now)
        status = backup.get("last_attempt_status")
        if status not in (None, "running", "failed", "succeeded"):
            raise ValueError("Unknown backup attempt state")
        running = status == "running"
        # A scheduled upload is not a failure while it is making its bounded
        # attempt. Freshness still comes from the previous verified recovery point.
        attempt_healthy = attempt_age <= 2 * 3600 if running else (
            status != "failed" and backup["last_attempt_ok"] is True)
        output["backups"] = healthy(attempt_healthy and age <= 25 * 3600,
                                     {"last_attempt_ok": backup["last_attempt_ok"] is True,
                                      "attempt_in_progress": running, "last_attempt_age_seconds": attempt_age,
                                      "latest_success_age_seconds": age})
    except Exception:
        pass
    try:
        filesystem = statfs(config.get("storage_path", "/var/lib"))
        free = filesystem.f_bavail * filesystem.f_frsize
        operating = 43 * 1024 ** 3
        floor = 35 * 1024 ** 3
        output["storage"] = healthy(free >= operating, {"free_bytes": free,
            "operating_margin_bytes": operating, "emergency_floor_bytes": floor})
    except Exception:
        pass
    return {"version": 1, "generated_at": now.isoformat().replace("+00:00", "Z"), "components": output}


def validate_jobs(jobs):
    if not isinstance(jobs, list) or len(jobs) > 100:
        raise ValueError('Invalid or truncated private job observation')
    result = []
    for job in jobs:
        if job.get('type') not in JOB_TYPES or not re.fullmatch(r'[0-9a-f]{32}', job.get('attempt', '')):
            raise ValueError('Invalid private job identity')
        result.append({'type': job['type'], 'attempt': job['attempt']})
    return sorted(result, key=lambda item: (item['type'], item['attempt']))


def history_path(filename, owner=0):
    target = Path(filename)
    if not target.is_absolute() or target.parent.resolve() != target.parent:
        raise ValueError('History requires an absolute directory without symlinks')
    for parent in (target.parent, *target.parent.parents):
        metadata = parent.stat()
        if metadata.st_uid not in (0, owner) or metadata.st_mode & 0o022:
            raise ValueError('History ancestors must be protected and owned by the operator')
    if stat.S_IMODE(target.parent.stat().st_mode) != 0o700:
        raise ValueError('History directory must be private mode-0700')
    for suffix in ('', '-journal', '-wal', '-shm'):
        path = Path(str(target) + suffix)
        if path.exists() or path.is_symlink():
            metadata = path.lstat()
            if (not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or
                    metadata.st_uid != owner or stat.S_IMODE(metadata.st_mode) != 0o600):
                raise ValueError('History files must be private regular files with one link')
    return target


def private_command(args, *, timeout=3):
    # Kill the entire runuser/psql group on timeout, including inherited pipes.
    with subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          start_new_session=True, text=True,
                          env={'PATH': '/usr/bin:/bin', 'PGCONNECT_TIMEOUT': '2'}) as process:
        try:
            output, _ = process.communicate(timeout=timeout)
        except BaseException:
            try:
                os.killpg(process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            process.communicate()
            raise
        if process.returncode or len(output) > 1_048_576:
            raise ValueError('Private observation failed or exceeded its bound')
        return output


def private_query(config, sql, run=private_command):
    return json.loads(run(['/usr/sbin/runuser', '-u', config['database_os_user'], '--',
        config.get('psql', '/usr/bin/psql'), '-XAtq', '-v', 'ON_ERROR_STOP=1',
        '--dbname', config['database'], '-c', sql], timeout=3))


def read_private_json(filename):
    with open(filename, 'rb') as stream:
        content = stream.read(131073)
    if len(content) > 131072:
        raise ValueError('Private observation exceeded its bound')
    return json.loads(content)


def collect_private_sample(config, *, run=private_command, read_json=read_private_json,
                           statfs=os.statvfs, statpath=os.stat, clock=time.time,
                           monotonic=time.monotonic):
    """Consecutive reads report an interval, not proof of simultaneous execution."""
    started = monotonic()
    sample = {'interval_started_at': clock(), 'backup_known': False,
              'device': None, 'free_bytes': None}
    try:
        sample['jobs'] = validate_jobs(private_query(config, HISTORY_JOBS_SQL, run))
    except Exception:
        pass
    sample['jobs_observed_at'] = clock()
    try:
        backup = read_json(config.get('backup_status', '/var/lib/canquery-backup/status.json'))
        status = backup.get('last_attempt_status')
        if status not in ('running', 'failed', 'succeeded'):
            raise ValueError('Unknown backup state')
        age_seconds(backup['last_attempt_at'], dt.datetime.fromtimestamp(clock(), dt.timezone.utc))
        sample['backup_known'] = True
        if status == 'running':
            sample['backup_job'] = {'type': 'backup', 'attempt': hashlib.sha256(
                backup['last_attempt_at'].encode()).hexdigest()[:32]}
    except Exception:
        pass
    sample['backup_observed_at'] = clock()
    try:
        path = config.get('storage_path', '/var/lib')
        filesystem = statfs(path)
        sample['device'] = statpath(path).st_dev
        sample['free_bytes'] = filesystem.f_bavail * filesystem.f_frsize
    except Exception:
        pass
    sample['filesystem_observed_at'] = clock()
    sample['interval_finished_at'] = clock()
    sample['observation_seconds'] = monotonic() - started
    return sample


def history_footprint(target):
    sizes = {}; allocated = 0
    for suffix in ('', '-journal', '-wal', '-shm'):
        try:
            metadata = Path(str(target) + suffix).stat()
        except FileNotFoundError:
            continue
        sizes[suffix] = metadata.st_size
        allocated += metadata.st_blocks * 512
    return {'database_bytes': sizes.get('', 0), 'journal_bytes': sizes.get('-journal', 0),
            'total_bytes': sum(sizes.values()), 'allocated_bytes': allocated}


def commit_history(connection, target):
    # Dirty the fixed control row first so its journal page is included below.
    connection.execute('UPDATE history_state SET write_sequence=write_sequence+1')
    footprint = history_footprint(target)
    connection.execute('''UPDATE history_state SET
        peak_database_bytes=max(peak_database_bytes,?),peak_journal_bytes=max(peak_journal_bytes,?),
        peak_total_bytes=max(peak_total_bytes,?),peak_allocated_bytes=max(peak_allocated_bytes,?)''',
        tuple(footprint[key] for key in ('database_bytes','journal_bytes','total_bytes','allocated_bytes')))
    connection.execute('COMMIT')


@contextmanager
def history_transaction(connection, target):
    connection.execute('BEGIN IMMEDIATE')
    try:
        yield
        commit_history(connection, target)
    except BaseException:
        if connection.in_transaction:
            connection.execute('ROLLBACK')
        raise


def open_history(target, at):
    mask = os.umask(0o077)
    try:
        connection = sqlite3.connect(target, timeout=0.2, isolation_level=None)
    finally:
        os.umask(mask)
    try:
        version = connection.execute('PRAGMA user_version').fetchone()[0]
        if version != HISTORY_VERSION and (version or connection.execute(
                "SELECT 1 FROM sqlite_master WHERE type='table' LIMIT 1").fetchone()):
            raise ValueError('Incompatible private history; preserve it and use a new file')
        if connection.execute('PRAGMA journal_mode=DELETE').fetchone()[0] != 'delete':
            raise ValueError('History requires rollback journaling')
        connection.execute('PRAGMA synchronous=FULL')
        # Each bounded transaction journals a page only once; avoid spill headers.
        connection.execute('PRAGMA cache_spill=OFF')
        connection.execute('PRAGMA temp_store=MEMORY')
        if connection.execute('PRAGMA page_size').fetchone()[0] != 4096:
            raise ValueError('Unexpected history page size')
        if connection.execute('PRAGMA max_page_count=' + str(HISTORY_MAX_PAGES)).fetchone()[0] != HISTORY_MAX_PAGES:
            raise ValueError('History database exceeds its size ceiling')
        if version != HISTORY_VERSION:
            connection.executescript('BEGIN IMMEDIATE;\n' + HISTORY_SCHEMA)
            connection.execute('INSERT INTO history_state(singleton,initialized_at) VALUES(1,?)', (at,))
            connection.execute('PRAGMA user_version=' + str(HISTORY_VERSION))
            commit_history(connection, target)
        return connection
    except BaseException:
        connection.close()
        raise


def available_history_pages(connection):
    pages = connection.execute('PRAGMA page_count').fetchone()[0]
    free = connection.execute('PRAGMA freelist_count').fetchone()[0]
    return HISTORY_MAX_PAGES - pages + free


def trim_history(connection, target, at, budget, *, force=False):
    """At most four 256-row batches across one collection, including retries."""
    cutoff = at - 30 * 86400
    while budget[0] > 0:
        with history_transaction(connection, target):
            oldest = connection.execute('SELECT min(at) FROM samples').fetchone()[0]
            expired = oldest is not None and oldest < cutoff
            pressure = force or available_history_pages(connection) < HISTORY_HEADROOM_PAGES
            if not expired and not pressure:
                return
            if oldest is None:
                return
            rows = connection.execute('SELECT at FROM samples WHERE at < ? ORDER BY at LIMIT ?',
                (cutoff if expired else at, HISTORY_TRIM_BATCH)).fetchall()
            if not rows:
                return
            reason = 'age' if expired else 'capacity'
            connection.execute('DELETE FROM samples WHERE at IN (' + ','.join('?' for _ in rows) + ')',
                               [row[0] for row in rows])
            days = {}
            for (timestamp,) in rows:
                day = dt.datetime.fromtimestamp(timestamp, dt.timezone.utc).date().isoformat()
                days.setdefault(day, []).append(timestamp)
            for day, times in days.items():
                connection.execute('''INSERT INTO retention_days VALUES(?,?,?,?,?) ON CONFLICT(day) DO UPDATE SET
                    dropped_samples=dropped_samples+excluded.dropped_samples,
                    first_removed_at=min(first_removed_at,excluded.first_removed_at),
                    last_removed_at=max(last_removed_at,excluded.last_removed_at),last_reason=excluded.last_reason''',
                    (day, len(times), min(times), max(times), reason))
            connection.execute('''UPDATE history_state SET removed_samples=removed_samples+?,
                last_trim_at=?,trimmed_through=max(coalesce(trimmed_through,0),?)''',
                (len(rows), at, rows[-1][0]))
        budget[0] -= 1
        force = False


def reserve_daily_attempt(connection, target, at):
    day = dt.datetime.fromtimestamp(at, dt.timezone.utc).date().isoformat()
    with history_transaction(connection, target):
        previous = connection.execute('SELECT last_reserved_day FROM history_state').fetchone()[0]
        if previous is not None and day <= previous:
            return None
        connection.execute('INSERT INTO component_sizes(day,at,status) VALUES(?,?,?)', (day, at, 'reserved'))
        connection.execute('UPDATE history_state SET last_reserved_day=?', (day,))
    return day


def collect_daily_sizes(connection, target, daily_sizes, clock):
    day = reserve_daily_attempt(connection, target, int(clock()))
    if day is None:
        return
    # Crossing midnight after reservation consumes that reservation without a query.
    if dt.datetime.fromtimestamp(clock(), dt.timezone.utc).date().isoformat() != day:
        return
    status, sizes = 'unavailable', None
    try:
        sizes = validate_sizes(daily_sizes())
        status = 'ok'
    except Exception:
        pass
    # A failed UPDATE/COMMIT must never undo the separately committed reservation.
    with history_transaction(connection, target):
        connection.execute('''UPDATE component_sizes SET status=?,measurements=?,completed_at=?
            WHERE day=? AND status='reserved' ''', (status, json.dumps(sizes), int(clock()), day))


def save_history(filename, sample, output, *, daily_sizes, owner=0, daily_clock=None):
    """Private sampled minima only; no production tables or policies change."""
    target = history_path(filename, owner)
    timing_names = ('interval_started_at', 'jobs_observed_at', 'backup_observed_at',
                    'filesystem_observed_at', 'interval_finished_at')
    times = [sample[name] for name in timing_names]
    duration = sample['observation_seconds']
    if any(isinstance(value, bool) or not isinstance(value, (int, float)) or
           not math.isfinite(value) or value < 0 for value in [*times, duration]) or times != sorted(times):
        raise ValueError('Invalid private observation interval')
    at = int(times[-1])
    jobs = validate_jobs(sample['jobs']) if 'jobs' in sample else []
    if sample.get('backup_job'):
        jobs += validate_jobs([sample['backup_job']])
    complete = 'jobs' in sample and sample.get('backup_known') is True
    free, device = sample['free_bytes'], sample['device']
    for value in (free, device):
        if value is not None and (isinstance(value, bool) or not isinstance(value, int) or value < 0):
            raise ValueError('Invalid private filesystem sample')
    states = {name: value['status'] for name, value in output['components'].items() if name in COMPONENTS}
    if any(value not in ('ok', 'degraded', 'unavailable') for value in states.values()):
        raise ValueError('Invalid component status')
    public_at = dt.datetime.fromisoformat(output['generated_at'].replace('Z', '+00:00')).timestamp()
    activity = ('+'.join(sorted(job['type'] for job in jobs)) or 'idle') if complete else 'unknown'
    connection = open_history(target, at)
    try:
        budget = [HISTORY_TRIM_BATCHES]
        previous = connection.execute('SELECT max(at) FROM samples').fetchone()[0]
        if previous is not None and at - previous < 30:
            raise ValueError('History timestamps must advance by at least 30 seconds')
        trim_history(connection, target, at, budget)
        def insert():
            with history_transaction(connection, target):
                previous = connection.execute('SELECT max(at) FROM samples').fetchone()[0]
                if previous is not None and at - previous < 30:
                    raise ValueError('History timestamps must advance by at least 30 seconds')
                connection.execute('INSERT INTO samples VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)',
                    (at, device, free, json.dumps(jobs), int(complete), activity, json.dumps(states), duration,
                     *times[:1], times[-1], *times[1:4], public_at))
                # Daily/control rows are tiny. Keep the permanent reservation high-water mark.
                cutoff_day = dt.datetime.fromtimestamp(at-30*86400, dt.timezone.utc).date().isoformat()
                for table in ('component_sizes', 'retention_days'):
                    connection.execute('DELETE FROM ' + table + ' WHERE day IN (SELECT day FROM ' + table +
                                       ' WHERE day<? ORDER BY day LIMIT 32)', (cutoff_day,))
        try:
            insert()
        except sqlite3.OperationalError as error:
            if getattr(error, 'sqlite_errorcode', None) != sqlite3.SQLITE_FULL:
                raise
            trim_history(connection, target, at, budget, force=True)
            insert()
        collect_daily_sizes(connection, target, daily_sizes, daily_clock or (lambda: at))
    finally:
        connection.close()


def validate_sizes(values):
    names = ('application_database_bytes', 'prepared_recorded_bytes', 'retired_recorded_bytes',
             'local_map_recorded_bytes', 'pmtiles_referenced_bytes')
    result = numbers(values, names)
    schemas = values['schema_relation_bytes']
    result['schema_relation_bytes'] = numbers(schemas,
        [name for name in ('public', 'store', 'map_store', 'canquery_auth', 'commercial', 'pg_catalog') if name in schemas])
    return result


def persist_private_history(config, output):
    sample = collect_private_sample(config)
    save_history(config['history_path'], sample, output,
                 daily_sizes=lambda: private_query(config, CAPACITY_SQL), daily_clock=time.time)


def write_atomic(filename, document):
    target = Path(filename)
    parent = target.parent.stat()
    if parent.st_uid != 0 or parent.st_mode & 0o022:
        raise ValueError("Observation directory must be root-owned and not writable by other users")
    descriptor, temporary = tempfile.mkstemp(prefix=".ops-status-", dir=target.parent)
    try:
        with os.fdopen(descriptor, "w") as stream:
            json.dump(document, stream, separators=(",", ":"))
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
            os.fchmod(stream.fileno(), 0o644)
        os.replace(temporary, target)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", default="/etc/canquery/observer.json")
    args = parser.parse_args()
    metadata = os.stat(args.config)
    if os.geteuid() != 0 or metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) != 0o600:
        raise ValueError("Run with a root-owned mode-0600 observer configuration")
    config = json.loads(Path(args.config).read_text())
    output = observe(config)
    write_atomic(config.get("output", "/run/canquery/ops-status.json"), output)
    if config.get("history_path"):
        try:
            persist_private_history(config, output)
        except Exception:
            # History failure must not suppress current health or expose secrets.
            print('{"event":"capacity_history_failed"}')
    print(json.dumps({"event": "component_observation", "status": {name: value["status"] for name, value in output["components"].items()}}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print('{"event":"component_observation_failed"}')
        raise SystemExit(1)
