#!/usr/bin/env python3
"""Capture official Cloudflare ranges and render site-scoped Caddy snippets.

Never edits an installed Caddyfile, DNS, firewall or running service.
"""
import argparse
import datetime as dt
import hashlib
import ipaddress
import json
from pathlib import Path
import urllib.request

SOURCES = {4: 'https://www.cloudflare.com/ips-v4', 6: 'https://www.cloudflare.com/ips-v6'}


def parse_ranges(raw, version):
    networks = [ipaddress.ip_network(line.strip(), strict=True) for line in raw.decode('ascii').splitlines() if line.strip()]
    if not 1 <= len(networks) <= 64 or len(set(networks)) != len(networks):
        raise ValueError('Unexpected range count or duplicate network')
    for network in networks:
        if network.version != version or not network.is_global or network.prefixlen < (8 if version == 4 else 16):
            raise ValueError('Unexpected address family or unsafe range')
    return [str(network) for network in networks]


def capture(destination):
    if destination.exists():
        raise ValueError('Capture destination must not already exist')
    files = {}
    for version, url in SOURCES.items():
        request = urllib.request.Request(url, headers={'User-Agent': 'CanQuery-Operations/1.0 (+https://canquery.com)'})
        with urllib.request.urlopen(request, timeout=20) as response:
            if response.geturl() != url:
                raise ValueError('Official range endpoint redirected')
            raw = response.read(32769)
        if len(raw) > 32768:
            raise ValueError('Official range response exceeds bound')
        networks = parse_ranges(raw, version)
        files[f'ips-v{version}.txt'] = (raw, {'source': url, 'sha256': hashlib.sha256(raw).hexdigest(), 'count': len(networks)})
    destination.mkdir(parents=False)
    for name, (raw, _) in files.items():
        (destination / name).write_bytes(raw)
    manifest = {'captured_at': dt.datetime.now(dt.timezone.utc).isoformat(),
                'files': {name: value[1] for name, value in files.items()}}
    (destination / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')


def load_ranges(directory, max_age_days=30):
    manifest = json.loads((directory / 'manifest.json').read_text())
    captured = dt.datetime.fromisoformat(manifest['captured_at'])
    age = dt.datetime.now(dt.timezone.utc) - captured
    if age.total_seconds() < -300 or age > dt.timedelta(days=max_age_days):
        raise ValueError('Range capture is stale or future-dated; capture and review current official lists')
    ranges = []
    for version, source in SOURCES.items():
        name = f'ips-v{version}.txt'
        record = manifest['files'][name]
        raw = (directory / name).read_bytes()
        if record['source'] != source or record['sha256'] != hashlib.sha256(raw).hexdigest():
            raise ValueError('Range source/hash mismatch')
        networks = parse_ranges(raw, version)
        if len(networks) != record['count']:
            raise ValueError('Range count mismatch')
        ranges.extend(networks)
    return ranges, manifest['captured_at']


def render(ranges, captured_at):
    networks = ' '.join(ranges)
    return f'''# Official Cloudflare range capture: {captured_at}
# Import transition OR locked FIRST inside a site route block. Existing handlers
# follow inside that same route; import proxy-identity into EVERY reverse_proxy.
# Never import these snippets into unrelated sites or global servers settings.
(canquery-edge-transition) {{
    @canquery_cloudflare remote_ip {networks}
    @canquery_bad_cf_header {{
        remote_ip {networks}
        not header_regexp CF-Connecting-IP ^[0-9a-fA-F:.]{{3,45}}$
    }}
    vars canquery_client_ip {{remote_host}}
    vars @canquery_cloudflare canquery_client_ip {{http.request.header.CF-Connecting-IP}}
    respond @canquery_bad_cf_header "Invalid edge client identity" 400
}}

(canquery-edge-locked) {{
    @canquery_outside {{
        not remote_ip {networks} 127.0.0.1/32 ::1/128
    }}
    respond @canquery_outside "Direct origin access is disabled" 403
    import canquery-edge-transition
}}

(canquery-proxy-identity) {{
    header_up X-Forwarded-For {{vars.canquery_client_ip}}
    header_up -X-Real-IP
    header_up -Forwarded
    header_up -CF-Connecting-IP
    header_up -CF-Connecting-IPv6
    header_up -True-Client-IP
}}
'''


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    fetch = commands.add_parser('capture')
    fetch.add_argument('--output', type=Path, required=True)
    generate = commands.add_parser('render')
    generate.add_argument('--ranges', type=Path, required=True)
    args = parser.parse_args()
    if args.command == 'capture':
        capture(args.output)
    else:
        ranges, captured_at = load_ranges(args.ranges)
        print(render(ranges, captured_at), end='')


if __name__ == '__main__':
    main()
