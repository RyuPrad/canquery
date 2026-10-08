import datetime as dt
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import unittest

spec = importlib.util.spec_from_file_location("observer", Path(__file__).with_name("observe-components.py"))
observer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(observer)


class ObservationTests(unittest.TestCase):
    def setUp(self):
        self.now = dt.datetime(2026, 10, 8, tzinfo=dt.timezone.utc)
        self.config = {"database_os_user": "deploy", "database": "test", "deploy_user": "deploy",
                       "app_dir": "/srv/canquery/current", "services": {name: name + ".service" for name in
                       ("api", "preparation", "maps", "mail_auth", "mail_dkim", "mail_certificate")}}
        self.queues = {name: {"eligible_pending": 0, "running": 0, "stale_running": 0,
                              "oldest_pending_seconds": 0, **({"capacity_failures_last_hour": 0} if name == "preparation" else {"failed_resources": 0})}
                       for name in ("preparation", "maps")}
        self.commercial = dict.fromkeys(observer.COMMERCIAL_METRICS, 0)
        self.ops = {"data": {"jobs": {"full": {"status": "ok"}}}}
        self.backup = {"last_verified_at": self.now.isoformat(), "last_attempt_at": self.now.isoformat(), "last_attempt_ok": True}
        self.free = 44 * 1024 ** 3
        self.calls = []

    def run_command(self, arguments, **options):
        self.calls.append((arguments, options))
        if arguments[0].endswith("systemctl"):
            return "\n\n".join("Id=" + unit + "\nActiveState=active" for unit in self.config["services"].values())
        self.assertEqual(arguments[:4], ["/usr/sbin/runuser", "-u", "deploy", "--"])
        if arguments[4].endswith("psql"):
            self.assertIn("BEGIN READ ONLY", arguments[-1])
            return json.dumps(self.queues)
        self.assertEqual(arguments[-1], "status")
        self.assertNotIn("--apply", arguments)
        return json.dumps(self.commercial)

    def collect(self, run=None):
        return observer.observe(self.config, run=run or self.run_command,
                                fetch=lambda url: {"ok": True, "db": True} if url.endswith("readyz") else self.ops,
                                now=self.now, statfs=lambda _: SimpleNamespace(f_bavail=self.free, f_frsize=1),
                                read_json=lambda _: self.backup)["components"]

    def test_healthy_observations_are_bounded_aggregates(self):
        result = self.collect()
        self.assertTrue(all(component["ok"] for component in result.values()))
        self.assertNotIn('"test"', json.dumps(result))
        self.assertNotIn("/srv", json.dumps(result))
        self.assertEqual(result["storage"]["checks"]["operating_margin_bytes"], 43 * 1024 ** 3)

    def test_publisher_map_failure_does_not_fail_availability_or_preparation(self):
        self.queues["maps"]["failed_resources"] = 1
        result = self.collect()
        self.assertFalse(result["maps"]["ok"])
        self.assertTrue(result["availability"]["ok"])
        self.assertTrue(result["preparation"]["ok"])

    def test_stalled_worker_eligible_queue_and_capacity_are_actionable(self):
        for key, value in (("stale_running", 1), ("oldest_pending_seconds", 1801), ("capacity_failures_last_hour", 3)):
            with self.subTest(key=key):
                self.queues["preparation"][key] = value
                self.assertFalse(self.collect()["preparation"]["ok"])
                self.queues["preparation"][key] = 0

    def test_missed_or_failed_backup_and_low_margin_fail(self):
        self.backup["last_verified_at"] = (self.now - dt.timedelta(hours=26)).isoformat()
        self.assertFalse(self.collect()["backups"]["ok"])
        self.backup["last_verified_at"] = self.now.isoformat()
        self.backup["last_attempt_ok"] = False
        self.assertFalse(self.collect()["backups"]["ok"])
        self.free = 42 * 1024 ** 3
        self.assertFalse(self.collect()["storage"]["ok"])

    def test_running_backup_has_two_hour_bound_without_claiming_new_recovery_point(self):
        self.backup.update(last_attempt_status="running", last_attempt_ok=False)
        self.assertTrue(self.collect()["backups"]["ok"])
        self.assertTrue(self.collect()["backups"]["checks"]["attempt_in_progress"])
        self.backup["last_attempt_at"] = (self.now - dt.timedelta(hours=2, seconds=1)).isoformat()
        self.assertFalse(self.collect()["backups"]["ok"])
        self.backup["last_attempt_at"] = self.now.isoformat()
        self.backup["last_verified_at"] = (self.now - dt.timedelta(hours=26)).isoformat()
        self.assertFalse(self.collect()["backups"]["ok"])

    def test_terminal_failure_cannot_be_hidden_by_previous_success(self):
        self.backup.update(last_attempt_status="failed", last_attempt_ok=True)
        self.assertFalse(self.collect()["backups"]["ok"])
        self.backup.update(last_attempt_status="succeeded", last_attempt_ok=True)
        self.assertTrue(self.collect()["backups"]["ok"])

    def test_backlog_and_source_failure_preserve_independent_components(self):
        self.commercial["delayed_mail"] = 1
        self.ops["data"]["jobs"]["full"]["status"] = "failed"
        result = self.collect()
        self.assertFalse(result["commercial"]["ok"])
        self.assertFalse(result["sources"]["ok"])
        self.assertTrue(result["availability"]["ok"])

    def test_command_failure_never_exposes_diagnostics(self):
        def fail(*args, **kwargs):
            raise RuntimeError("private password or host path")
        result = self.collect(run=fail)
        self.assertEqual(result["preparation"]["status"], "unavailable")
        self.assertFalse(result["availability"]["ok"])
        self.assertNotIn("private", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
