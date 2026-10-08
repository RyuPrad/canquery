import datetime as dt
import http.client
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
import os
from pathlib import Path
import socket
import subprocess
import tempfile
import threading
import time
import unittest

spec = importlib.util.spec_from_file_location('edge_configure', Path(__file__).with_name('configure.py'))
configure = importlib.util.module_from_spec(spec)
spec.loader.exec_module(configure)


class RangeTests(unittest.TestCase):
    def test_captured_official_lists_have_both_families(self):
        ranges, captured = configure.load_ranges(Path(__file__).with_name('ranges-20261008'), max_age_days=36500)
        self.assertEqual(len(ranges), 22)
        self.assertTrue(dt.datetime.fromisoformat(captured).tzinfo)
        self.assertIn('173.245.48.0/20', ranges)
        self.assertIn('2606:4700::/32', ranges)

    def test_rejects_private_overbroad_duplicate_or_wrong_family(self):
        for raw, version in [(b'127.0.0.1/32', 4), (b'0.0.0.0/0', 4),
                             (b'173.245.48.0/20\n173.245.48.0/20', 4), (b'2606:4700::/32', 4)]:
            with self.assertRaises(ValueError):
                configure.parse_ranges(raw, version)

    def test_no_global_trust_or_existing_host_replacement(self):
        rendered = configure.render(['173.245.48.0/20'], 'fixture')
        self.assertNotIn('trusted_proxies', rendered)
        self.assertNotIn('servers {', rendered)
        self.assertNotIn('mail.', rendered)
        self.assertIn('header_up X-Forwarded-For {vars.canquery_client_ip}', rendered)


CADDY = os.environ.get('CANQUERY_CADDY_TEST_BINARY')


@unittest.skipUnless(CADDY, 'set CANQUERY_CADDY_TEST_BINARY to the reviewed Caddy executable')
class CaddyBehaviorTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        class Upstream(BaseHTTPRequestHandler):
            def do_GET(self):
                body = json.dumps(dict(self.headers)).encode()
                self.send_response(200)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *_args):
                pass
        cls.backend = ThreadingHTTPServer(('127.0.0.1', 0), Upstream)
        cls.thread = threading.Thread(target=cls.backend.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.backend.shutdown()
        cls.backend.server_close()
        cls.thread.join()

    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix='canquery-caddy-test-')
        self.process = None

    def tearDown(self):
        if self.process:
            self.process.terminate()
            try:
                self.process.wait(timeout=5)
            except subprocess.TimeoutExpired:
                self.process.kill()
                self.process.wait(timeout=5)
            self.log.close()
        self.directory.cleanup()

    def start(self, mode):
        with socket.socket() as probe:
            probe.bind(('127.0.0.1', 0))
            self.port = probe.getsockname()[1]
        # Only this isolated fixture substitutes a loopback Cloudflare peer.
        # The production CLI refuses private/non-global capture ranges.
        snippets = configure.render(['127.0.0.2/32'], 'fixture-only')
        proxy = f'''reverse_proxy 127.0.0.1:{self.backend.server_port} {{
            import canquery-proxy-identity
        }}'''
        config = f'''{{
    admin off
    auto_https off
}}
{snippets}
http://canquery.test:{self.port} {{
    bind 127.0.0.1
    route {{
        import canquery-edge-{mode}
        handle /collect/* {{
            {proxy}
        }}
        handle {{
            {proxy}
        }}
    }}
}}
http://www.canquery.test:{self.port} {{
    bind 127.0.0.1
    route {{
        import canquery-edge-{mode}
        redir https://canquery.test{{uri}} permanent
    }}
}}
http://mochi.test:{self.port} {{
    bind 127.0.0.1
    reverse_proxy 127.0.0.1:{self.backend.server_port}
}}
http://mail.canquery.test:{self.port} {{
    bind 127.0.0.1
    respond "existing mail certificate site" 200
}}
'''
        path = Path(self.directory.name) / 'Caddyfile'
        path.write_text(config)
        env = {**os.environ, 'XDG_DATA_HOME': self.directory.name, 'XDG_CONFIG_HOME': self.directory.name}
        validated = subprocess.run([CADDY, 'validate', '--config', str(path), '--adapter', 'caddyfile'],
                                   env=env, capture_output=True, text=True)
        self.assertEqual(validated.returncode, 0, validated.stderr)
        self.log = (Path(self.directory.name) / 'caddy.log').open('w+')
        self.process = subprocess.Popen([CADDY, 'run', '--config', str(path), '--adapter', 'caddyfile'],
                                        env=env, stdout=self.log, stderr=self.log)
        for _ in range(100):
            try:
                self.get('127.0.0.1', host='mail.canquery.test')
                return
            except OSError:
                time.sleep(0.02)
        self.log.seek(0)
        self.fail(self.log.read())

    def get(self, peer, host='canquery.test', path='/', headers=None):
        client = http.client.HTTPConnection('127.0.0.1', self.port, timeout=2, source_address=(peer, 0))
        try:
            client.request('GET', path, headers={'Host': host, **(headers or {})})
            response = client.getresponse()
            return response.status, dict(response.headers), response.read()
        finally:
            client.close()

    def test_transition_trusts_cloudflare_only_and_preserves_direct_identity(self):
        self.start('transition')
        forged = {'CF-Connecting-IP': '203.0.113.42', 'X-Forwarded-For': '198.51.100.9',
                  'X-Real-IP': '198.51.100.8', 'Forwarded': 'for=198.51.100.7',
                  'True-Client-IP': '198.51.100.6', 'CF-Connecting-IPv6': '2001:db8::5'}
        for peer, expected in [('127.0.0.2', '203.0.113.42'), ('127.0.0.3', '127.0.0.3')]:
            for route in ['/', '/collect/event']:
                status, _, raw = self.get(peer, path=route, headers=forged)
                self.assertEqual(status, 200)
                headers = {key.lower(): value for key, value in json.loads(raw).items()}
                self.assertEqual(headers['x-forwarded-for'], expected)
                for removed in ['cf-connecting-ip', 'cf-connecting-ipv6', 'true-client-ip', 'x-real-ip', 'forwarded']:
                    self.assertNotIn(removed, headers)
        self.assertEqual(self.get('127.0.0.2')[0], 400)
        self.assertEqual(self.get('127.0.0.2', headers={'CF-Connecting-IP': '1.2.3.4, 5.6.7.8'})[0], 400)

    def test_locked_origin_denies_direct_even_before_nested_handlers_and_www_redirect(self):
        self.start('locked')
        for host in ['canquery.test', 'www.canquery.test']:
            for route in ['/', '/collect/event']:
                self.assertEqual(self.get('127.0.0.3', host=host, path=route,
                                         headers={'CF-Connecting-IP': '203.0.113.42'})[0], 403)
        self.assertEqual(self.get('127.0.0.1')[0], 200)
        self.assertEqual(self.get('127.0.0.2', headers={'CF-Connecting-IP': '2001:db8::42'})[0], 200)
        status, headers, _ = self.get('127.0.0.2', host='www.canquery.test', path='/docs?q=1',
                                      headers={'CF-Connecting-IP': '203.0.113.42'})
        self.assertEqual(status, 301)
        self.assertEqual(headers['Location'], 'https://canquery.test/docs?q=1')
        self.assertEqual(self.get('127.0.0.3', host='mochi.test')[0], 200)
        self.assertEqual(self.get('127.0.0.3', host='mail.canquery.test')[0], 200)


if __name__ == '__main__':
    unittest.main()
