#!/usr/bin/env python3
"""Verify/apply the CanQuery performance overlay to an isolated analytics tree."""
import argparse
import hashlib
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def digest(value):
    return hashlib.sha256(value).hexdigest()


def apply(target, write=False):
    target = Path(target).resolve()
    live = Path('/opt/canquery-analytics/current')
    if live.exists() and target == live.resolve():
        raise ValueError('Use an isolated stage, never the live analytics release.')
    manifest = json.loads((ROOT / 'base-manifest.json').read_text())
    if json.loads((target / 'package.json').read_text())['version'] != manifest['version']:
        raise ValueError('Unexpected analytics package version.')
    for path, expected in manifest['protected'].items():
        if digest((target / path).read_bytes()) != expected:
            raise ValueError('Unrelated analytics source changed: ' + path)
    replacements = {
        str(path.relative_to(ROOT / 'files')): path.read_bytes()
        for path in (ROOT / 'files').rglob('*') if path.is_file()
    }
    if set(replacements) != set(manifest['files']):
        raise ValueError('Overlay files do not match the reviewed manifest.')
    marker = target / '.canquery-performance-overlay.json'
    previous = json.loads(marker.read_text()) if marker.exists() else {}
    if previous and previous.get('method') != 'web-vitals-v1':
        raise ValueError('Unexpected prior performance overlay.')
    for path, replacement in replacements.items():
        existing = target / path
        current = digest(existing.read_bytes()) if existing.is_file() else None
        allowed = [manifest['files'][path], digest(replacement)]
        if path in previous.get('files', {}):
            allowed.append(previous['files'][path])
        if current not in allowed:
            raise ValueError('Unexpected analytics source change: ' + path)
    # Validate the entire tree before writing any file.
    if write:
        for path, replacement in replacements.items():
            destination = target / path
            destination.parent.mkdir(parents=True, exist_ok=True)
            destination.write_bytes(replacement)
            destination.chmod(0o644)
        (target / '.canquery-performance-overlay.json').write_text(json.dumps({
            'method': 'web-vitals-v1',
            'files': {path: digest(value) for path, value in replacements.items()},
        }, indent=2) + '\n')
    return len(replacements)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('target')
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    count = apply(args.target, args.apply)
    print(('Applied' if args.apply else 'Verified') + f' {count} analytics overlay files.')
