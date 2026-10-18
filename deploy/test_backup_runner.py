import importlib.util
import json
import pathlib
import os
import subprocess
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('backup_runner', pathlib.Path(__file__).with_name('backup-runner.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)

# Stands in for psql: records its input, answers the lock query and writes a
# marker when its input closes, which is when the real session would end.
FAKE_PSQL = ('import pathlib,sys\n'
             'log,released=pathlib.Path(sys.argv[1]),pathlib.Path(sys.argv[2])\n'
             'while True:\n'
             '    line=sys.stdin.readline()\n'
             '    if not line: break\n'
             '    log.write_text((log.read_text() if log.exists() else "")+line)\n'
             '    if "pg_advisory_lock" in line: print("locked",flush=True)\n'
             'released.write_text("yes")\n')


class BackupRunnerTests(unittest.TestCase):
    def test_retention_requires_matching_verified_latest_dump(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            files = []
            for day in ['01', '02', '03']:
                item = root / ('app-202610' + day + 'T010000Z.dump')
                item.write_bytes(day.encode())
                files.append(item)
            unrelated = root / 'manual.dump'
            unrelated.write_bytes(b'keep')
            release = root / 'release'
            release.mkdir()
            (release / files[0].name).write_bytes(b'keep')
            with patch.object(runner, 'valid_dump', return_value=True):
                with self.assertRaises(ValueError):
                    runner.retain_two(root, ['app'], {files[2].name: 'wrong'})
                self.assertTrue(all(item.exists() for item in files))
                deleted = runner.retain_two(root, ['app'], {files[2].name: runner.sha256(files[2])})
            self.assertEqual(deleted, [files[0].name])
            self.assertTrue(unrelated.exists())
            self.assertTrue((release / files[0].name).exists())

    def test_fewer_than_two_valid_dumps_never_prunes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            for day in ['01', '02']:
                (root / ('app-202610' + day + 'T010000Z.dump')).write_bytes(b'x')
            with patch.object(runner, 'valid_dump', side_effect=[True, False]):
                self.assertEqual(runner.retain_two(root, ['app'], {}), [])
            self.assertEqual(len(list(root.iterdir())), 2)

    def test_failed_attempt_preserves_last_verified_time(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            state = root / 'status.json'
            runner.atomic_json(state, {'last_verified_at': '2026-10-07T01:30:00Z', 'last_attempt_ok': True})
            config = {'status_path': str(state), 'backup_dir': str(root), 'app_database': 'app',
                      'analytics_database': 'analytics', 'min_free_gb': 35, 'dump_script': '/trusted/dump.sh'}
            with patch.object(runner, 'trusted_file', return_value=pathlib.Path('/trusted/dump.sh')):
                with patch.object(runner, 'run_command', side_effect=RuntimeError('dump failed')):
                    with self.assertRaises(RuntimeError):
                        runner.run(config)
            saved = json.loads(state.read_text())
            self.assertFalse(saved['last_attempt_ok'])
            self.assertEqual(saved['last_attempt_status'], 'failed')
            self.assertIn('last_finished_at', saved)
            self.assertEqual(saved['last_verified_at'], '2026-10-07T01:30:00Z')
            self.assertEqual(state.stat().st_mode & 0o777, 0o600)

    def test_running_attempt_keeps_prior_result_until_it_completes(self):
        with tempfile.TemporaryDirectory() as temporary:
            state = pathlib.Path(temporary) / 'status.json'
            runner.atomic_json(state, {'last_verified_at': '2026-10-07T01:30:00Z', 'last_attempt_ok': True})
            def during_attempt(config, current):
                saved = json.loads(state.read_text())
                self.assertEqual(saved['last_attempt_status'], 'running')
                self.assertTrue(saved['last_attempt_ok'])
                self.assertEqual(saved['last_verified_at'], '2026-10-07T01:30:00Z')
            with patch.object(runner, '_run', side_effect=during_attempt):
                runner.run({'status_path': str(state)})

    def test_timeout_stops_child_group_and_reaps_direct_process(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            pidfile, marker = root / 'child.pid', root / 'terminated'
            child = ('import os,signal,time,pathlib; '
                     f'pathlib.Path({str(pidfile)!r}).write_text(str(os.getpid())); '
                     f'signal.signal(signal.SIGTERM,lambda *_:(pathlib.Path({str(marker)!r}).write_text("yes"),exit(0))); '
                     'time.sleep(60)')
            parent = ('import subprocess,sys,signal,time; '
                      'child=subprocess.Popen([sys.executable,"-c",sys.argv[1]]); '
                      'signal.signal(signal.SIGTERM,lambda *_:(child.wait(timeout=2),exit(0))); '
                      'time.sleep(60)')
            with self.assertRaises(subprocess.TimeoutExpired):
                runner.run_command([sys.executable, '-c', parent, child], timeout=0.5)
            self.assertEqual(marker.read_text(), 'yes')
            with self.assertRaises(ProcessLookupError):
                os.kill(int(pidfile.read_text()), 0)

    def test_store_lock_is_held_until_released(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            log, released = root / 'input.sql', root / 'released'
            process = runner.hold_store_lock('app', 5, command=[sys.executable, '-c', FAKE_PSQL, str(log), str(released)])
            self.assertIsNotNone(process)
            self.assertFalse(released.exists())
            self.assertEqual(log.read_text(), "SET lock_timeout = '5s';\n"
                             "SELECT 'locked' FROM pg_advisory_lock(hashtext('canquery-store-budget-v1'));\n")
            runner.release_store_lock(process)
            self.assertEqual(released.read_text(), 'yes')
            self.assertEqual(process.returncode, 0)

    def test_store_lock_that_is_not_granted_returns_none(self):
        # psql stops on the lock timeout error without printing a row.
        quiet = [sys.executable, '-c', 'import sys; sys.stdin.readline(); sys.stdin.readline(); sys.exit(3)']
        self.assertIsNone(runner.hold_store_lock('app', 5, command=quiet))
        self.assertIsNone(runner.hold_store_lock('app', 5, command=[sys.executable, '-c', 'raise SystemExit(2)']))

    def test_dumps_run_inside_the_store_lock_and_release_it_on_failure(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            config = {'status_path': str(root / 'status.json'), 'backup_dir': str(root), 'app_database': 'app',
                      'analytics_database': 'analytics', 'min_free_gb': 5, 'dump_script': '/trusted/dump.sh'}
            calls = []
            def dump(args, **_kwargs):
                calls.append(('dump', args[-1]))
                raise RuntimeError('dump failed')
            with patch.object(runner, 'trusted_file', return_value=pathlib.Path('/trusted/dump.sh')), \
                    patch.object(runner, 'hold_store_lock', side_effect=lambda database, wait: calls.append(('hold', database, wait)) or 'session'), \
                    patch.object(runner, 'release_store_lock', side_effect=lambda session: calls.append(('release', session))), \
                    patch.object(runner, 'run_command', side_effect=dump):
                with self.assertRaises(RuntimeError):
                    runner.run(config)
            self.assertEqual(calls, [('hold', 'app', runner.STORE_LOCK_WAIT_SECONDS), ('dump', '/trusted/dump.sh'),
                                     ('release', 'session')])

    def test_store_lock_is_the_application_store_budget_lock(self):
        evict = pathlib.Path(__file__).parents[1] / 'server' / 'services' / 'evictService.js'
        self.assertIn(f"const STORE_BUDGET_LOCK = '{runner.STORE_LOCK}';", evict.read_text())

    def test_process_return_codes_and_captured_outputs_are_preserved(self):
        result = runner.run_command([sys.executable, '-c', 'print("fixture")'],
                                    timeout=5, check=True, capture_output=True, text=True)
        self.assertEqual(result.stdout, 'fixture\n')
        with self.assertRaises(subprocess.CalledProcessError):
            runner.run_command([sys.executable, '-c', 'raise SystemExit(7)'], timeout=5, check=True)

    def test_configuration_archive_requires_all_paths_and_preserves_private_modes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = pathlib.Path(temporary)
            secret = root / 'secret.env'
            secret.write_text('test-only')
            secret.chmod(0o600)
            destination = root / 'configuration.tar.gz'
            runner.configuration_archive([str(secret)], destination)
            with tarfile.open(destination) as archive:
                item = archive.getmembers()[0]
                self.assertEqual(item.mode, 0o600)
                self.assertEqual(archive.extractfile(item).read(), b'test-only')
            with self.assertRaises(ValueError):
                runner.configuration_archive([str(root / 'missing')], destination)


if __name__ == '__main__':
    unittest.main()
