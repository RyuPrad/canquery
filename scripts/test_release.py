import hashlib
import importlib.util
import json
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

SPEC = importlib.util.spec_from_file_location('release', Path(__file__).with_name('build-release.py'))
release = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(release)


class ReleaseArtifactTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name) / 'repo'
        self.root.mkdir()
        self.git('init', '-q')
        self.git('config', 'user.email', 'fixture@example.test')
        self.git('config', 'user.name', 'Fixture')
        (self.root / '.gitignore').write_text('.env\nclient/dist/\n')
        (self.root / 'server').mkdir()
        (self.root / 'server' / 'server.js').write_text('console.log("fixture");\n')
        self.git('add', '.')
        self.git('commit', '-qm', 'Fixture')
        self.commit = self.git('rev-parse', 'HEAD')
        self.frontend = self.root / 'client' / 'dist'
        self.frontend.mkdir(parents=True)
        (self.frontend / 'index.html').write_text('<html>fixture</html>')
        (self.frontend / 'asset-manifest.json').write_text('{}')
        (self.root / '.env').write_text('SECRET=do-not-archive')

    def git(self, *args):
        return subprocess.check_output(['git', *args], cwd=self.root).decode().strip()

    def test_exact_source_frontend_and_hash_inventory_without_ignored_secrets(self):
        artifact = release.package(self.root, Path(self.temp.name) / 'out', self.commit)
        with tarfile.open(artifact) as archive:
            names = archive.getnames()
            self.assertNotIn('.env', names)
            self.assertIn('client/dist/index.html', names)
            manifest = json.load(archive.extractfile('release-manifest.json'))
            self.assertEqual(manifest['commit'], self.commit)
            for name, item in manifest['files'].items():
                data = archive.extractfile(name).read()
                self.assertEqual(item['sha256'], hashlib.sha256(data).hexdigest())
                self.assertEqual(item['bytes'], len(data))
        duplicate = release.package(self.root, Path(self.temp.name) / 'repeat', self.commit)
        self.assertEqual(artifact.read_bytes(), duplicate.read_bytes())
        with self.assertRaisesRegex(ValueError, 'already exists'):
            release.package(self.root, artifact.parent, self.commit)

    def test_rejects_mismatched_commit_dirty_source_and_external_symlinks(self):
        with self.assertRaisesRegex(ValueError, 'expected release commit'):
            release.package(self.root, Path(self.temp.name) / 'out', '0' * 40)
        (self.root / 'server' / 'server.js').write_text('changed')
        with self.assertRaisesRegex(ValueError, 'tracked modifications'):
            release.package(self.root, Path(self.temp.name) / 'out', self.commit)
        self.git('checkout', '--', 'server/server.js')
        (self.frontend / 'secret').symlink_to(self.root / '.env')
        with self.assertRaisesRegex(ValueError, 'symlink'):
            release.package(self.root, Path(self.temp.name) / 'out', self.commit)

    def test_backup_source_requires_a_bundled_standalone_operations_artifact(self):
        (self.root / 'deploy').mkdir()
        (self.root / 'deploy/backup-upload.cjs').write_text('module.exports = {};\n')
        self.git('add', 'deploy/backup-upload.cjs')
        self.git('commit', '-qm', 'Backup fixture')
        commit = self.git('rev-parse', 'HEAD')
        with self.assertRaisesRegex(ValueError, 'standalone backup uploader'):
            release.package(self.root, Path(self.temp.name) / 'out', commit)
        (self.root / 'operations').mkdir()
        (self.root / 'operations/backup-upload.cjs').write_text('module.exports = {};\n')
        artifact = release.package(self.root, Path(self.temp.name) / 'out', commit)
        with tarfile.open(artifact) as archive:
            manifest = json.load(archive.extractfile('release-manifest.json'))
            self.assertIn('operations/backup-upload.cjs', manifest['files'])


if __name__ == '__main__':
    unittest.main()
