import importlib.util
import json
import pathlib
import tarfile
import tempfile
import unittest
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('backup_runner', pathlib.Path(__file__).with_name('backup-runner.py'))
runner = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runner)


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
                with patch.object(runner.subprocess, 'run', side_effect=RuntimeError('dump failed')):
                    with self.assertRaises(RuntimeError):
                        runner.run(config)
            saved = json.loads(state.read_text())
            self.assertFalse(saved['last_attempt_ok'])
            self.assertEqual(saved['last_verified_at'], '2026-10-07T01:30:00Z')
            self.assertEqual(state.stat().st_mode & 0o777, 0o600)

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
