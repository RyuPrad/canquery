#!/usr/bin/env python3
"""Copy a renewed Caddy certificate/key atomically; never expose Caddy's key store."""
import argparse
import hashlib
import os
import pathlib
import re
import shutil
import subprocess
import tempfile


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--hostname', required=True)
    parser.add_argument('--source', required=True, type=pathlib.Path)
    parser.add_argument('--destination', default='/etc/canquery-mail/tls', type=pathlib.Path)
    args = parser.parse_args()
    if os.geteuid() or not re.fullmatch(r'[a-z0-9.-]+', args.hostname):
        raise SystemExit('Run as root with a valid mail hostname')
    cert = args.source / (args.hostname + '.crt')
    key = args.source / (args.hostname + '.key')
    subprocess.run(['openssl', 'x509', '-in', str(cert), '-noout', '-checkend', '86400'], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['openssl', 'x509', '-in', str(cert), '-noout', '-checkhost', args.hostname], check=True, stdout=subprocess.DEVNULL)
    public_cert = subprocess.check_output(['openssl', 'x509', '-in', str(cert), '-pubkey', '-noout'])
    public_key = subprocess.check_output(['openssl', 'pkey', '-in', str(key), '-pubout'])
    if public_cert != public_key:
        raise SystemExit('Certificate/key mismatch')
    digest = hashlib.sha256(cert.read_bytes() + public_key).hexdigest()
    args.destination.mkdir(mode=0o700, parents=True, exist_ok=True)
    current = args.destination / 'current'
    release = args.destination / digest
    if current.is_symlink() and current.resolve() == release:
        return
    os.umask(0o077)
    if not release.exists():
        stage = pathlib.Path(tempfile.mkdtemp(prefix='.stage-', dir=args.destination))
        shutil.copyfile(cert, stage / 'cert.pem')
        shutil.copyfile(key, stage / 'key.pem')
        stage.rename(release)
    link = args.destination / '.next'
    if link.exists() or link.is_symlink():
        link.unlink()
    link.symlink_to(release.name)
    link.replace(current)
    subprocess.run(['postfix', 'check'], check=True)
    subprocess.run(['systemctl', 'reload', 'postfix'], check=True)
    # Retain one prior generation for recovery, bound obsolete private key copies.
    old = sorted((p for p in args.destination.iterdir() if p.is_dir() and not p.is_symlink()
                  and re.fullmatch('[a-f0-9]{64}', p.name) and p != release), key=lambda p:p.stat().st_mtime, reverse=True)
    for path in old[1:]:
        shutil.rmtree(path)


if __name__ == '__main__':
    main()
