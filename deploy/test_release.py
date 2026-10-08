import hashlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest
from unittest.mock import patch


def load(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


ROOT = Path(__file__).resolve().parent.parent
release = load('promote', ROOT / 'deploy/release.py')
builder = load('builder', ROOT / 'scripts/build-release.py')


class ReleasePromotionTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.repo = self.base / 'checkout'
        self.repo.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.email', 'fixture@example.test')
        self.git('config', 'user.name', 'Fixture')
        (self.repo / '.gitignore').write_text('.env\nclient/dist/\n')
        (self.repo / 'server').mkdir()
        (self.repo / 'server/server.js').write_text('console.log("verified");\n')
        (self.repo / 'server/package.json').write_text('{"dependencies":{}}\n')
        (self.repo / 'server/package-lock.json').write_text('{}\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'Fixture')
        self.commit = self.git('rev-parse', 'HEAD')
        self.dist = self.repo / 'client/dist'
        (self.dist / 'assets').mkdir(parents=True)
        (self.dist / 'index.html').write_text('verified index')
        (self.dist / 'asset-manifest.json').write_text('{}')
        (self.dist / 'assets/app-abcdefgh.js').write_text('old verified asset')
        (self.repo / '.env').write_text('SECRET=retained')
        self.archive = builder.package(self.repo, self.base / 'artifacts', self.commit)
        self.checksum = hashlib.sha256(self.archive.read_bytes()).hexdigest()
        self.destination = self.base / self.commit

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.repo).decode().strip()

    def stage(self, apply=True):
        with patch.object(release.os, 'geteuid', return_value=1000):
            return release.stage(self.archive, self.checksum, self.commit, self.repo, self.destination, apply=apply)

    def repack(self, members, name='changed.tar.gz'):
        target = self.base / name
        with tarfile.open(target, 'w:gz') as archive:
            for path, (data, mode) in members.items():
                item = tarfile.TarInfo(path)
                item.size, item.mode = len(data), mode
                archive.addfile(item, io.BytesIO(data))
        return target, hashlib.sha256(target.read_bytes()).hexdigest()

    def test_root_verification_runs_git_as_checkout_owner(self):
        owner = self.repo.stat()
        with patch.object(release.os, 'geteuid', return_value=0):
            with patch.object(release.subprocess, 'check_output', return_value=b'fixture') as command:
                self.assertEqual(release.git_bytes(self.repo, 'rev-parse', 'HEAD'), b'fixture')
        expected = {'user': owner.st_uid, 'group': owner.st_gid, 'extra_groups': []} if owner.st_uid else {}
        command.assert_called_once_with(['git', 'rev-parse', 'HEAD'], cwd=self.repo, **expected)

    def test_preview_is_read_only_and_stage_does_not_copy_private_environment(self):
        self.assertFalse(self.stage(False)['apply'])
        self.assertFalse(self.destination.exists())
        self.stage()
        self.assertEqual((self.destination / 'client/dist/index.html').read_text(), 'verified index')
        self.assertFalse((self.destination / '.env').exists())
        self.assertEqual((self.repo / '.env').read_text(), 'SECRET=retained')
        release.inspect_stage(self.destination)
        with self.assertRaisesRegex(ValueError, 'new directory'):
            self.stage()

    def test_modified_archive_source_rejected_even_with_self_consistent_manifest(self):
        members = release.archive_members(self.archive.read_bytes())
        manifest = json.loads(members[release.MANIFEST][0])
        payload = b'console.log("unreviewed");\n'
        members['server/server.js'] = (payload, 0o644)
        manifest['files']['server/server.js'].update(sha256=release.sha256(payload), bytes=len(payload))
        members[release.MANIFEST] = (json.dumps(manifest).encode(), 0o644)
        archive, checksum = self.repack(members)
        with self.assertRaisesRegex(ValueError, 'Source bytes differ'):
            release.verify_archive(archive, checksum, self.commit, self.repo)

    def test_bad_checksum_traversal_and_unsafe_modes_fail_before_staging(self):
        with self.assertRaisesRegex(ValueError, 'SHA-256 differs'):
            release.verify_archive(self.archive, '0' * 64, self.commit, self.repo)
        for name, mode in [('../private', 0o644), ('/private', 0o644), ('server/.env', 0o644), ('unsafe', 0o777)]:
            archive, checksum = self.repack({name: (b'x', mode)})
            with self.assertRaises(ValueError):
                release.verify_archive(archive, checksum, self.commit, self.repo)
        self.assertFalse(self.destination.exists())

    def test_old_hashed_assets_are_retained_but_old_index_is_not(self):
        self.stage()
        (self.dist / 'assets/app-abcdefgh.js').unlink()
        (self.dist / 'assets/app-ijklmnop.js').write_text('new verified asset')
        (self.dist / 'index.html').write_text('new index')
        archive = builder.package(self.repo, self.base / 'new-artifacts', self.commit)
        destination = self.base / 'next' / self.commit
        destination.parent.mkdir()
        with patch.object(release.os, 'geteuid', return_value=1000):
            release.stage(archive, release.sha256(archive.read_bytes()), self.commit, self.repo, destination,
                          previous=self.destination, apply=True)
        self.assertEqual((destination / 'client/dist/index.html').read_text(), 'new index')
        self.assertEqual((destination / 'client/dist/assets/app-abcdefgh.js').read_text(), 'old verified asset')
        release.inspect_stage(destination)

    def test_post_stage_changes_and_escaping_dependency_links_fail_sealing(self):
        self.stage()
        dependencies = self.destination / 'server/node_modules'
        dependencies.mkdir()
        (dependencies / 'escape').symlink_to(self.repo / '.env')
        with self.assertRaisesRegex(ValueError, 'escaping dependency symlink'):
            release.inspect_stage(self.destination)
        (dependencies / 'escape').unlink()
        (self.destination / 'server/server.js').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'changed after verification'):
            release.seal(self.destination, self.archive, self.checksum, self.commit, self.repo)

    def test_sealing_requires_dependencies_and_activation_refuses_checkout_or_drift(self):
        self.stage()
        with self.assertRaisesRegex(ValueError, 'production server dependencies'):
            release.seal(self.destination, self.archive, self.checksum, self.commit, self.repo)
        (self.destination / 'server/node_modules').mkdir()
        (self.destination / 'server/node_modules/.package-lock.json').write_text('{"packages":{}}')
        self.assertFalse(release.seal(self.destination, self.archive, self.checksum, self.commit, self.repo)['sealed'])
        with self.assertRaisesRegex(ValueError, 'existing checkouts'):
            release.activate(self.destination, self.repo, 'none')
        current = self.base / 'current'
        current.symlink_to(self.repo)
        with self.assertRaisesRegex(ValueError, 'drifted'):
            release.activate(self.destination, current, 'none')
        with self.assertRaisesRegex(ValueError, 'root-owned and read-only'):
            release.activate(self.destination, current, str(self.repo))


if __name__ == '__main__':
    unittest.main()
