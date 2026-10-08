#!/usr/bin/env python3
"""Verify, stage and explicitly activate an immutable CanQuery release."""
import argparse
import hashlib
import io
import json
import os
from pathlib import Path, PurePosixPath
import re
import subprocess
import tarfile
import uuid

MANIFEST = 'release-manifest.json'
RECEIPT = 'stage-receipt.json'
ASSET_PREFIX = 'client/dist/assets/'
HASHED_ASSET = re.compile(r'^.+-[A-Za-z0-9_-]{8,}\.[A-Za-z0-9]+$')


def sha256(data):
    return hashlib.sha256(data).hexdigest()


def safe_name(name):
    path = PurePosixPath(name)
    if not name or path.is_absolute() or '..' in path.parts or '\\' in name or str(path) != name:
        raise ValueError('Unsafe archive path')
    if '.env' in path.parts:
        raise ValueError('Private environment files do not belong in a release')
    return path


def git(checkout, *args):
    return subprocess.check_output(['git', *args], cwd=checkout).decode().strip()


def archive_members(data):
    files = {}
    with tarfile.open(fileobj=io.BytesIO(data), mode='r:*') as archive:
        for member in archive:
            safe_name(member.name)
            if member.name in files or not member.isfile() or member.mode not in (0o644, 0o755):
                raise ValueError('Duplicate, non-regular or unsafe-mode archive member')
            files[member.name] = (archive.extractfile(member).read(), member.mode)
    return files


def verify_archive(archive, checksum, commit, checkout):
    if not re.fullmatch(r'[0-9a-f]{64}', checksum) or not re.fullmatch(r'[0-9a-f]{40}', commit):
        raise ValueError('Expected a complete SHA-256 and Git commit')
    data = Path(archive).read_bytes()
    if sha256(data) != checksum:
        raise ValueError('Archive SHA-256 differs from trusted CI checksum')
    files = archive_members(data)
    manifest = json.loads(files[MANIFEST][0])
    if manifest.get('schema_version') != 1 or manifest.get('commit') != commit:
        raise ValueError('Release manifest identity mismatch')
    if not str(manifest.get('node', '')).startswith('v22.'):
        raise ValueError('Artifact was not packaged with Node 22')
    inventory = manifest['files']
    if set(files) != set(inventory) | {MANIFEST}:
        raise ValueError('Archive and manifest inventories differ')
    for name, expected in inventory.items():
        body, mode = files[name]
        if sha256(body) != expected['sha256'] or len(body) != expected['bytes'] or mode != expected['mode']:
            raise ValueError('Archive member differs from manifest: ' + name)
    if git(checkout, 'rev-parse', 'HEAD') != commit or git(checkout, 'status', '--porcelain', '--untracked-files=no'):
        raise ValueError('Source checkout must be clean at the exact release commit')
    if git(checkout, 'rev-parse', 'HEAD^{tree}') != manifest['tree']:
        raise ValueError('Source tree differs from manifest')
    # Compare every tracked byte, not just the manifest's claimed commit.
    source = subprocess.check_output(['git', 'archive', '--format=tar', commit], cwd=checkout)
    tracked = set()
    with tarfile.open(fileobj=io.BytesIO(source)) as native:
        for item in native:
            if item.isdir():
                continue
            if not item.isfile() or item.name not in files:
                raise ValueError('Tracked source is missing or is not a regular file')
            tracked.add(item.name)
            source_mode = 0o755 if item.mode & 0o111 else 0o644
            if files[item.name] != (native.extractfile(item).read(), source_mode):
                raise ValueError('Source bytes differ from reviewed commit: ' + item.name)
    if any(name not in (MANIFEST, 'operations/backup-upload.cjs') and name not in tracked and not name.startswith('client/dist/') for name in files):
        raise ValueError('Unexpected generated release file')
    for required in ('client/dist/index.html', 'client/dist/asset-manifest.json', 'server/package-lock.json'):
        if required not in files:
            raise ValueError('Required artifact member is missing: ' + required)
    if 'deploy/backup-upload.cjs' in tracked and 'operations/backup-upload.cjs' not in files:
        raise ValueError('The standalone backup uploader is missing')
    return manifest, files


def retained_assets(previous):
    if previous is None:
        return {}
    previous = Path(previous)
    manifest = json.loads((previous / MANIFEST).read_text())
    inventory = dict(manifest['files'])
    receipt = previous / RECEIPT
    if receipt.exists():
        inventory.update(json.loads(receipt.read_text()).get('retained_assets', {}))
    result = {}
    for name, expected in inventory.items():
        if not name.startswith(ASSET_PREFIX):
            continue
        safe_name(name)
        path = previous / name
        if not HASHED_ASSET.fullmatch(path.name) or path.is_symlink() or not path.is_file():
            raise ValueError('Previous asset is not a verified hashed regular file')
        data = path.read_bytes()
        if sha256(data) != expected['sha256'] or len(data) != expected['bytes']:
            raise ValueError('Previous asset differs from its retained manifest')
        result[name] = data
    return result


def stage(archive, checksum, commit, checkout, destination, previous=None, apply=False):
    manifest, files = verify_archive(archive, checksum, commit, checkout)
    destination = Path(destination)
    if destination.exists() or destination.is_symlink() or destination.name != commit:
        raise ValueError('Stage must be a new directory named by the complete commit')
    assets = retained_assets(previous)
    retained = {}
    for name, data in assets.items():
        if name in files:
            if files[name][0] != data:
                raise ValueError('A hashed asset name changed contents')
        else:
            retained[name] = {'sha256': sha256(data), 'bytes': len(data), 'mode': 0o644}
            files[name] = (data, 0o644)
    if not apply:
        return {'commit': commit, 'files': len(files), 'retained_assets': len(retained), 'apply': False}
    if os.geteuid() == 0:
        raise ValueError('Stage and dependency installation must run as the deployment user, not root')
    destination.mkdir(mode=0o755)
    # Publish the staged index last, before any separate activation is possible.
    for name in sorted(files, key=lambda name: (name == 'client/dist/index.html', name)):
        body, mode = files[name]
        target = destination / name
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open('xb') as output:
            output.write(body)
        target.chmod(mode)
    receipt = {'schema_version': 1, 'commit': commit, 'archive_sha256': checksum,
               'manifest_sha256': sha256(files[MANIFEST][0]), 'retained_assets': retained,
               'previous_release': str(Path(previous).resolve()) if previous else None}
    (destination / RECEIPT).write_text(json.dumps(receipt, indent=2, sort_keys=True) + '\n')
    return {'commit': manifest['commit'], 'stage': str(destination), 'apply': True}


def inspect_stage(path):
    path = Path(path).resolve()
    manifest_bytes = (path / MANIFEST).read_bytes()
    manifest = json.loads(manifest_bytes)
    receipt = json.loads((path / RECEIPT).read_text())
    if path.name != manifest['commit'] or receipt['commit'] != manifest['commit'] or receipt['manifest_sha256'] != sha256(manifest_bytes):
        raise ValueError('Stage identity or manifest changed')
    inventory = dict(manifest['files'])
    if any(not name.startswith(ASSET_PREFIX) or not HASHED_ASSET.fullmatch(PurePosixPath(name).name) or name in inventory
           for name in receipt['retained_assets']):
        raise ValueError('Retained asset receipt cannot replace release source')
    inventory.update(receipt['retained_assets'])
    for name, expected in inventory.items():
        safe_name(name)
        target = path / name
        if target.is_symlink() or not target.is_file() or not target.resolve().is_relative_to(path):
            raise ValueError('Stage member escaped its boundary')
        body = target.read_bytes()
        if sha256(body) != expected['sha256'] or len(body) != expected['bytes']:
            raise ValueError('Stage changed after verification: ' + name)
        if target.stat().st_mode & 0o111 != expected['mode'] & 0o111:
            raise ValueError('Stage executable mode changed: ' + name)
    for target in path.rglob('*'):
        name = target.relative_to(path).as_posix()
        if not target.resolve().is_relative_to(path):
            raise ValueError('Stage contains an escaping dependency symlink')
        if target.is_symlink() and not name.startswith('server/node_modules/'):
            raise ValueError('Source contains an unexpected symlink')
        if target.is_dir():
            continue
        if not target.is_file():
            raise ValueError('Stage contains a non-regular runtime file')
        if not target.is_symlink() and target.stat().st_nlink != 1:
            raise ValueError('Stage contains a hard-linked runtime file')
        if name not in inventory and name not in (MANIFEST, RECEIPT) and not name.startswith('server/node_modules/'):
            raise ValueError('Stage contains an unexpected file: ' + name)
    return path, manifest


def seal(path, archive, checksum, commit, checkout, destination=None, apply=False):
    _, trusted = verify_archive(archive, checksum, commit, checkout)
    path, manifest = inspect_stage(path)
    if (path / MANIFEST).read_bytes() != trusted[MANIFEST][0]:
        raise ValueError('Stage manifest differs from trusted artifact')
    installed_lock = path / 'server/node_modules/.package-lock.json'
    if not installed_lock.is_file():
        raise ValueError('Install locked production server dependencies before sealing')
    expected_packages = json.loads((path / 'server/package-lock.json').read_text()).get('packages', {})
    installed_packages = json.loads(installed_lock.read_text()).get('packages', {})
    for name, installed in installed_packages.items():
        expected = expected_packages.get(name)
        if not expected or any(installed.get(key) != expected.get(key) for key in ('version', 'resolved', 'integrity')):
            raise ValueError('Installed dependency identity differs from the reviewed lockfile')
    package = json.loads((path / 'server/package.json').read_text())
    for name in package.get('dependencies', {}):
        if 'node_modules/' + name not in installed_packages or not (path / 'server/node_modules' / name / 'package.json').is_file():
            raise ValueError('Required production dependency is missing: ' + name)
    final = Path(destination).absolute() if destination else path
    if final.name != commit or (final != path and (final.exists() or final.is_symlink())):
        raise ValueError('Final release must be a new directory named by its commit')
    if apply:
        if os.geteuid() != 0:
            raise ValueError('Only root can seal a verified release')
        if not destination or final.parent.is_symlink() or final.parent.stat().st_uid != 0 or final.parent.stat().st_mode & 0o022:
            raise ValueError('Final release parent must be root-owned and not group/world writable')
        for target in [*path.rglob('*'), path]:
            os.chown(target, 0, 0, follow_symlinks=False)
            if not target.is_symlink():
                target.chmod(0o555 if target.is_dir() or target.stat().st_mode & 0o111 else 0o444)
        inspect_stage(path)
        if path != final:
            path.rename(final)
    return {'commit': manifest['commit'], 'release': str(final), 'sealed': apply}


def activate(path, current, expected_current, apply=False):
    path, manifest = inspect_stage(path)
    if not (path / 'server/node_modules/.package-lock.json').is_file():
        raise ValueError('Sealed production dependencies are missing')
    current = Path(current)
    if current.exists() and not current.is_symlink():
        raise ValueError('Current path must be a symlink; existing checkouts are preserved')
    actual = str(current.resolve()) if current.is_symlink() else 'none'
    expected = str(Path(expected_current).resolve()) if expected_current != 'none' else 'none'
    if actual != expected:
        raise ValueError('Current release drifted from the reviewed predecessor')
    if current.absolute().is_relative_to(path):
        raise ValueError('Current link cannot be inside the immutable release')
    for target in [path, *path.rglob('*')]:
        if not target.is_symlink() and (target.stat().st_uid != 0 or target.stat().st_mode & 0o222):
            raise ValueError('Release must be root-owned and read-only before activation')
    if apply:
        if os.geteuid() != 0:
            raise ValueError('Only root can activate a sealed release')
        if current.parent.is_symlink() or current.parent.stat().st_uid != 0 or current.parent.stat().st_mode & 0o022:
            raise ValueError('Current link parent must be root-owned and not group/world writable')
        pending = current.with_name('.' + current.name + '-' + uuid.uuid4().hex)
        try:
            pending.symlink_to(path)
            os.replace(pending, current)
        finally:
            pending.unlink(missing_ok=True)
    return {'commit': manifest['commit'], 'previous': actual, 'current': str(current), 'apply': apply}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    staged = commands.add_parser('stage')
    for flag in ('archive', 'sha256', 'commit', 'checkout', 'destination'):
        staged.add_argument('--' + flag, required=True)
    staged.add_argument('--previous-release')
    staged.add_argument('--apply', action='store_true')
    for name in ('seal', 'activate'):
        sub = commands.add_parser(name)
        sub.add_argument('--release', required=True)
        sub.add_argument('--apply', action='store_true')
        if name == 'seal':
            sub.add_argument('--destination', required=True)
            for flag in ('archive', 'sha256', 'commit', 'checkout'):
                sub.add_argument('--' + flag, required=True)
        else:
            sub.add_argument('--current', required=True)
            sub.add_argument('--expected-current', required=True)
    args = parser.parse_args()
    try:
        if args.command == 'stage':
            result = stage(args.archive, args.sha256, args.commit, args.checkout, args.destination, args.previous_release, args.apply)
        elif args.command == 'seal':
            result = seal(args.release, args.archive, args.sha256, args.commit, args.checkout, args.destination, args.apply)
        else:
            result = activate(args.release, args.current, args.expected_current, args.apply)
        print(json.dumps(result, sort_keys=True))
    except (ValueError, KeyError, OSError, subprocess.CalledProcessError, tarfile.TarError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
