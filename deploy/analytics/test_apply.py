import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('analytics_overlay', Path(__file__).with_name('apply.py'))
overlay = importlib.util.module_from_spec(spec)
spec.loader.exec_module(overlay)


class OverlayTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.source = self.root / 'overlay'
        self.target = self.root / 'stage'
        (self.source / 'files').mkdir(parents=True)
        self.target.mkdir()
        (self.target / 'package.json').write_text('{"version":"3.3.1"}')
        (self.target / 'protected').write_text('Mochi unchanged')
        (self.target / 'original').write_text('original')
        (self.source / 'files/original').write_text('corrected')
        (self.source / 'files/new').write_text('new')
        (self.source / 'base-manifest.json').write_text(json.dumps({
            'version': '3.3.1',
            'files': {'original': hashlib.sha256(b'original').hexdigest(), 'new': None},
            'protected': {'protected': hashlib.sha256(b'Mochi unchanged').hexdigest()},
        }))
        previous = overlay.ROOT
        overlay.ROOT = self.source
        self.addCleanup(setattr, overlay, 'ROOT', previous)

    def test_dry_run_and_idempotent_apply(self):
        self.assertEqual(overlay.apply(self.target), 2)
        self.assertEqual((self.target / 'original').read_text(), 'original')
        self.assertFalse((self.target / 'new').exists())
        self.assertEqual(overlay.apply(self.target, True), 2)
        self.assertEqual(overlay.apply(self.target, True), 2)
        self.assertEqual((self.target / 'original').read_text(), 'corrected')
        self.assertEqual((self.target / 'protected').read_text(), 'Mochi unchanged')

    def test_unrelated_change_rejected_before_any_write(self):
        (self.target / 'protected').write_text('drift')
        with self.assertRaises(ValueError):
            overlay.apply(self.target, True)
        self.assertEqual((self.target / 'original').read_text(), 'original')

    def test_unexpected_source_and_new_file_collision_rejected(self):
        (self.target / 'new').write_text('unrelated')
        with self.assertRaises(ValueError):
            overlay.apply(self.target, True)
        self.assertEqual((self.target / 'original').read_text(), 'original')

    def test_wrong_version_rejected(self):
        (self.target / 'package.json').write_text('{"version":"other"}')
        with self.assertRaises(ValueError):
            overlay.apply(self.target, True)

    def test_modified_existing_source_rejected(self):
        (self.target / 'original').write_text('unreviewed')
        with self.assertRaises(ValueError):
            overlay.apply(self.target, True)


if __name__ == '__main__':
    unittest.main()
