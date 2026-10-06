#!/usr/bin/env python3
"""Install reviewed, additive submission configuration on an existing Postfix host.

Install Dovecot 2.3/OpenDKIM first, and provision the hostname's TLS certificate
with sync-certificate.py. Preview is the default. Expected hashes guard drift.
Credentials are generated locally and written only to a root-private file.
"""
import argparse
import base64
import hashlib
import json
import os
import pathlib
import secrets
import shutil
import subprocess
from templates import render


def write(path, contents, mode=0o644, group=None):
    path = pathlib.Path(path)
    path.write_text(contents)
    path.chmod(mode)
    if group:
        shutil.chown(path, user='root', group=group)


def main():
    p = argparse.ArgumentParser()
    for arg in ('domain', 'hostname', 'address', 'selector', 'expected-main', 'expected-master', 'evidence'):
        p.add_argument('--' + arg, required=True)
    p.add_argument('--apply', action='store_true')
    a = p.parse_args()
    content = render(a.domain, a.hostname, a.address, a.selector)
    for name, expected in [('main.cf', a.expected_main), ('master.cf', a.expected_master)]:
        actual = hashlib.sha256(pathlib.Path('/etc/postfix', name).read_bytes()).hexdigest()
        if actual != expected:
            raise SystemExit('Postfix configuration changed: ' + name)
    root = pathlib.Path('/etc/canquery-mail')
    if (root / 'installed.json').exists():
        raise SystemExit('Already installed; review a scoped update rather than replacing credentials')
    if not a.apply:
        print(json.dumps({'mode': 'preview', 'files': content}, indent=2))
        return
    if os.geteuid():
        raise SystemExit('Run as root')
    existing = [root / name for name in ('credentials.json','users','dkim.pem','dovecot.conf','opendkim.conf','senders')]
    existing += [pathlib.Path('/etc/systemd/system',name+'.service') for name in ('canquery-mail-auth','canquery-mail-dkim')]
    if any(path.exists() for path in existing):
        raise SystemExit('Partial or existing installation found; preserve its credentials and inspect before resuming')
    evidence = pathlib.Path(a.evidence)
    proof = json.loads((evidence / 'encrypted-backups-reverified.json').read_text())
    if len(proof['backups']) != 2 or not all(b['roundtrip_verified'] for b in proof['backups']):
        raise SystemExit('Fresh verified off-host backups required')
    if not (root / 'tls/current/cert.pem').is_file():
        raise SystemExit('Install the verified TLS certificate first')
    if not subprocess.check_output(['dovecot', '--version'], text=True).startswith('2.3.'):
        raise SystemExit('This configuration requires Dovecot 2.3')
    if os.statvfs('/var/lib').f_bavail * os.statvfs('/var/lib').f_frsize < 35 * 1024**3 + 100 * 1024**2:
        raise SystemExit('Storage floor would be at risk')
    os.umask(0o077)
    root.mkdir(mode=0o755, exist_ok=True)
    root.chmod(0o755)
    credentials = {name + '@' + a.domain: secrets.token_urlsafe(32) for name in ('support', 'accounts')}
    write(root / 'credentials.json', json.dumps(credentials) + '\n', 0o600)
    users = []
    for user, password in credentials.items():
        encoded = subprocess.check_output(['openssl', 'passwd', '-6', '-stdin'], input=password+'\n', text=True).strip()
        users.append(user + ':{SHA512-CRYPT}' + encoded)
    write(root / 'users', '\n'.join(users) + '\n', 0o640, 'dovecot')
    for name in ('dovecot.conf', 'opendkim.conf', 'senders'):
        write(root / name, content[name])
    key = root / 'dkim.pem'
    if key.exists():
        raise SystemExit('Refusing to overwrite an existing signing key')
    subprocess.run(['openssl', 'genpkey', '-algorithm', 'RSA', '-pkeyopt', 'rsa_keygen_bits:2048', '-out', str(key)], check=True, stderr=subprocess.DEVNULL)
    key.chmod(0o600)
    shutil.chown(key, user='opendkim', group='opendkim')
    for name, text in {
        'canquery-mail-auth': '''[Unit]
Description=CanQuery SMTP authentication only
After=network.target
[Service]
Type=simple
ExecStart=/usr/sbin/dovecot -F -c /etc/canquery-mail/dovecot.conf
RuntimeDirectory=canquery-mail-auth
StateDirectory=canquery-mail-auth
Restart=on-failure
RestartSec=5
PrivateTmp=true
ProtectSystem=full
ProtectHome=true
[Install]
WantedBy=multi-user.target
''',
        'canquery-mail-dkim': '''[Unit]
Description=CanQuery submission DKIM signer
After=network.target
[Service]
Type=simple
User=opendkim
Group=postfix
SupplementaryGroups=opendkim
RuntimeDirectory=canquery-mail-dkim
RuntimeDirectoryMode=0750
ExecStart=/usr/sbin/opendkim -f -x /etc/canquery-mail/opendkim.conf
Restart=on-failure
RestartSec=5
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
NoNewPrivileges=true
[Install]
WantedBy=multi-user.target
''',
    }.items():
        path = pathlib.Path('/etc/systemd/system', name + '.service')
        if path.exists():
            raise SystemExit('Refusing to overwrite unit ' + str(path))
        write(path, text)
    subprocess.run(['doveconf', '-c', str(root / 'dovecot.conf'), '-n'], check=True, stdout=subprocess.DEVNULL)
    subprocess.run(['runuser', '-u', 'opendkim', '--', 'opendkim', '-n', '-x', str(root / 'opendkim.conf')], check=True)
    master = pathlib.Path('/etc/postfix/master.cf')
    with master.open('a') as stream:
        stream.write('\n' + content['master.cf.fragment'])
    subprocess.run(['postfix', 'check'], check=True)
    subprocess.run(['systemctl', 'daemon-reload'], check=True)
    subprocess.run(['systemctl', 'enable', '--now', 'canquery-mail-auth', 'canquery-mail-dkim'], check=True)
    subprocess.run(['systemctl', 'reload', 'postfix'], check=True)
    public = subprocess.check_output(['openssl', 'pkey', '-in', str(key), '-pubout', '-outform', 'DER'])
    receipt = {'domain': a.domain, 'hostname': a.hostname, 'selector': a.selector,
               'dkim_name': a.selector + '._domainkey', 'dkim_value': 'v=DKIM1; k=rsa; p=' + base64.b64encode(public).decode(),
               'master_after_sha256': hashlib.sha256(master.read_bytes()).hexdigest()}
    write(root / 'installed.json', json.dumps(receipt, indent=2) + '\n', 0o600)
    print(json.dumps(receipt))


if __name__ == '__main__':
    main()
