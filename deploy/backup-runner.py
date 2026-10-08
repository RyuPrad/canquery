#!/usr/bin/env python3
"""Complete a daily recovery point under the existing host backup flock.

The executable, JSON configuration, uploader and encryption binary must be
root-owned and runtime-read-only. The age private key is never needed here.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import pathlib
import re
import subprocess
import tarfile
import tempfile


def utcnow():
    return dt.datetime.now(dt.timezone.utc).isoformat()


def atomic_json(path, value):
    path = pathlib.Path(path)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=path.name + '.', dir=path.parent)
    try:
        with os.fdopen(fd, 'w') as output:
            json.dump(value, output)
            output.write('\n')
            output.flush()
            os.fsync(output.fileno())
        os.replace(temporary, path)
    finally:
        pathlib.Path(temporary).unlink(missing_ok=True)


def trusted_file(path, private=False):
    path = pathlib.Path(path)
    if path.is_symlink() or not path.is_file():
        raise ValueError('Expected regular operations file')
    for ancestor in [path, *path.parents]:
        stat = ancestor.stat()
        if stat.st_uid != 0 or stat.st_mode & 0o022:
            raise ValueError('Operations path must be root-owned and protected')
    if private and path.stat().st_mode & 0o077:
        raise ValueError('Configuration must be root-private')
    return path


def sha256(path):
    value = hashlib.sha256()
    with pathlib.Path(path).open('rb') as source:
        for chunk in iter(lambda: source.read(4 * 1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def dump_candidates(directory, database):
    pattern = re.compile(re.escape(database.replace('_', '-')) + r'-\d{8}T\d{6}Z\.dump$')
    return sorted((p for p in pathlib.Path(directory).iterdir()
                   if pattern.fullmatch(p.name) and p.is_file() and not p.is_symlink()),
                  key=lambda p: p.stat().st_mtime_ns, reverse=True)


def valid_dump(path):
    return path.stat().st_size > 0 and subprocess.run(
        ['pg_restore', '--list', str(path)], stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL, timeout=60).returncode == 0


def retain_two(directory, databases, verified_files):
    """Only run after a complete remote recovery point passed read-back checks."""
    removed = []
    for database in databases:
        candidates = dump_candidates(directory, database)
        valid = [p for p in candidates if valid_dump(p)]
        if len(valid) < 2:
            continue
        latest = valid[0]
        if verified_files.get(latest.name) != sha256(latest):
            raise ValueError('Latest local dump differs from verified recovery point')
        for candidate in candidates:
            if candidate not in valid[:2]:
                # Names are strictly scoped top-level scheduled dumps. Historical
                # release directories and partial files are never retention targets.
                candidate.unlink()
                removed.append(candidate.name)
    return removed


def configuration_archive(paths, destination, recovery_roles=None):
    with tarfile.open(destination, 'w:gz', dereference=False) as archive:
        for value in paths:
            path = pathlib.Path(value)
            if not path.is_absolute() or not path.exists() or path.is_symlink():
                raise ValueError('Missing or unsafe required recovery configuration')
            archive.add(path, arcname=str(path).lstrip('/'), recursive=True)
        if recovery_roles is not None:
            archive.add(recovery_roles, arcname='recovery/postgres-globals.sql')
    os.chmod(destination, 0o600)


def run(config):
    status_path = pathlib.Path(config['status_path'])
    prior = json.loads(status_path.read_text()) if status_path.exists() else {}
    state = {key: prior[key] for key in ['last_verified_at'] if key in prior}
    state.update(last_attempt_at=utcnow(), last_attempt_ok=False)
    atomic_json(status_path, state)
    directory = pathlib.Path(config['backup_dir'])
    databases = [config['app_database'], config['analytics_database']]
    for database in databases:
        if not re.fullmatch(r'[A-Za-z0-9_-]+', database):
            raise ValueError('Invalid database identity')
    before = {p for database in databases for p in dump_candidates(directory, database)}
    environment = dict(os.environ, CANQUERY_BACKUP_DIR=str(directory),
                       CANQUERY_BACKUP_APP_DATABASE=databases[0],
                       CANQUERY_BACKUP_ANALYTICS_DATABASE=databases[1],
                       CANQUERY_BACKUP_MIN_FREE_GB=str(config['min_free_gb']),
                       # Retention follows remote verification below. The guarded
                       # original dump script still independently attempts both DBs.
                       CANQUERY_BACKUP_KEEP_DAYS='365000')
    subprocess.run(['bash', str(trusted_file(config['dump_script']))],
                   env=environment, check=True, timeout=5400)
    files = []
    for database in databases:
        new = [p for p in dump_candidates(directory, database) if p not in before]
        if len(new) != 1 or not valid_dump(new[0]):
            raise ValueError('Expected a fresh validated database dump')
        files.append({'name': new[0].name, 'path': str(new[0]), 'kind': 'database'})
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    with tempfile.TemporaryDirectory(prefix='recovery-', dir=status_path.parent) as temporary:
        temporary = pathlib.Path(temporary)
        configuration = temporary / 'configuration.tar.gz'
        roles = temporary / 'postgres-globals.sql'
        with roles.open('wb') as output:
            subprocess.run(['runuser', '-u', 'postgres', '--', 'pg_dumpall', '--globals-only'],
                           stdout=output, stderr=subprocess.DEVNULL, check=True, timeout=120)
        roles.chmod(0o600)
        # Keep the global roles/memberships separately identified inside the
        # encrypted configuration bundle. They include private password hashes;
        # a restore must reconcile shared-host roles before applying this file.
        configuration_archive(config['recovery_paths'], configuration, recovery_roles=roles)
        files.append({'name': 'configuration.tar.gz', 'path': str(configuration), 'kind': 'configuration'})
        release = pathlib.Path(config['release_manifest'])
        if release.exists():
            commit = json.loads(release.read_text())['commit']
        else:
            commit = subprocess.check_output(['runuser', '-u', config['deploy_user'], '--',
                'git', '-C', config['legacy_checkout'], 'rev-parse', 'HEAD'], text=True).strip()
        manifest = {'version': 1, 'stamp': stamp, 'release': commit, 'files': files}
        manifest_path = temporary / 'manifest.json'
        atomic_json(manifest_path, manifest)
        uploader = trusted_file(config['uploader'])
        credential = trusted_file(config['credential_file'], private=True)
        result = subprocess.run([config['node'], '--env-file=' + str(credential), str(uploader),
                                 '--manifest', str(manifest_path)], check=True, capture_output=True,
                                text=True, timeout=5400, env=environment)
        receipt = json.loads(result.stdout)
        if receipt['stamp'] != stamp or len(receipt['files']) != 3:
            raise ValueError('Unexpected remote recovery receipt')
        atomic_json(status_path.parent / 'receipts' / (stamp + '.json'), receipt)
        verified_files = {item['name']: item['plaintext_sha256'] for item in receipt['files']}
        removed = retain_two(directory, databases, verified_files)
        state.update(last_verified_at=receipt['verified_at'], last_attempt_ok=True)
        atomic_json(status_path, state)
        print(json.dumps({'ok': True, 'verified_at': receipt['verified_at'], 'expired_local_dumps': len(removed)}))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--config', required=True)
    args = parser.parse_args()
    os.umask(0o077)
    configuration = json.loads(trusted_file(args.config, private=True).read_text())
    run(configuration)


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Child stderr, configuration and credentials stay out of public logs.
        print('Daily encrypted backup failed; inspect the private backup status.', flush=True)
        raise SystemExit(1)
