#!/usr/bin/env python3
"""Root-owned, read-only host observations; never publish command output/errors."""
import argparse
import datetime as dt
import json
import math
import os
from pathlib import Path
import shlex
import stat
import subprocess
import tempfile
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
    print(json.dumps({"event": "component_observation", "status": {name: value["status"] for name, value in output["components"].items()}}))


if __name__ == "__main__":
    try:
        main()
    except Exception:
        print('{"event":"component_observation_failed"}')
        raise SystemExit(1)
