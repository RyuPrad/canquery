#!/usr/bin/env python3
"""Package exact Git source and the already verified frontend; never rebuild it."""
import argparse
import gzip
import hashlib
import io
import json
from pathlib import Path
import subprocess
import tarfile


def command(root, *args):
    return subprocess.check_output(args, cwd=root).decode().strip()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def package(root, output, expected_commit):
    root = Path(root).resolve()
    commit = command(root, 'git', 'rev-parse', 'HEAD')
    if commit != expected_commit:
        raise ValueError('HEAD does not match the expected release commit')
    if command(root, 'git', 'status', '--porcelain', '--untracked-files=no'):
        raise ValueError('Release source must have no tracked modifications')
    source = subprocess.check_output(['git', 'archive', '--format=tar', commit], cwd=root)
    files = {}
    with tarfile.open(fileobj=io.BytesIO(source)) as archive:
        for entry in archive:
            if entry.isdir():
                continue
            if not entry.isfile() or Path(entry.name).name == '.env':
                raise ValueError('Release source contains an unsupported file: ' + entry.name)
            files[entry.name] = (archive.extractfile(entry).read(), 0o755 if entry.mode & 0o111 else 0o644)
    frontend = root / 'client' / 'dist'
    if not (frontend / 'index.html').is_file() or not (frontend / 'asset-manifest.json').is_file():
        raise ValueError('The verified frontend index and asset manifest are required')
    # Never follow a generated symlink outside the artifact boundary.
    for path in sorted(frontend.rglob('*')):
        if path.is_symlink():
            raise ValueError('Frontend contains a symlink: ' + str(path))
        if path.is_file():
            files[path.relative_to(root).as_posix()] = (path.read_bytes(), 0o644)
    if 'deploy/backup-upload.cjs' in files:
        uploader = root / 'operations/backup-upload.cjs'
        if uploader.is_symlink() or not uploader.is_file() or uploader.stat().st_size == 0:
            raise ValueError('The bundled standalone backup uploader is required')
        files['operations/backup-upload.cjs'] = (uploader.read_bytes(), 0o644)
    timestamp = int(command(root, 'git', 'show', '-s', '--format=%ct', commit))
    node = command(root, 'node', '--version')
    if not node.startswith('v22.'):
        raise ValueError('Release packaging requires the verified Node 22 runtime')
    manifest = {
        'schema_version': 1, 'commit': commit,
        'tree': command(root, 'git', 'rev-parse', 'HEAD^{tree}'),
        'source_date_epoch': timestamp, 'node': node,
        'npm': command(root, 'npm', '--version'),
        'dependencies': 'Install server production dependencies with npm ci --omit=dev using the included lockfile.',
        'migrations': sorted(name for name in files if name.startswith('server/sql/migrations/') and name.endswith('.sql')),
        'files': {name: {'sha256': digest(data), 'bytes': len(data), 'mode': mode}
                  for name, (data, mode) in sorted(files.items())}
    }
    files['release-manifest.json'] = ((json.dumps(manifest, indent=2, sort_keys=True) + '\n').encode(), 0o644)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    target = output / ('canquery-' + commit + '.tar.gz')
    # Refuse replacing previous evidence, including the accompanying checksum.
    checksum = target.with_suffix(target.suffix + '.sha256')
    if target.exists() or checksum.exists():
        raise ValueError('Release output already exists')
    with target.open('xb') as raw:
        with gzip.GzipFile(filename='', mode='wb', fileobj=raw, mtime=timestamp) as compressed:
            with tarfile.open(fileobj=compressed, mode='w', format=tarfile.PAX_FORMAT) as archive:
                for name, (data, mode) in sorted(files.items()):
                    entry = tarfile.TarInfo(name)
                    entry.size, entry.mode, entry.mtime = len(data), mode, timestamp
                    entry.uid = entry.gid = 0
                    archive.addfile(entry, io.BytesIO(data))
    checksum.write_text(digest(target.read_bytes()) + '  ' + target.name + '\n')
    return target


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--commit', required=True)
    parser.add_argument('--output-dir', required=True)
    parser.add_argument('--source-root', default=str(Path(__file__).resolve().parent.parent))
    args = parser.parse_args()
    try:
        print(package(args.source_root, args.output_dir, args.commit))
    except (ValueError, subprocess.CalledProcessError) as error:
        parser.exit(1, str(error) + '\n')


if __name__ == '__main__':
    main()
