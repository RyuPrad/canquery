# CanQuery Cloudflare proxy boundary

The generator emits importable Caddy snippets, never a replacement host config.
It does not edit DNS, firewall rules, installed files or services. Verified with
Caddy 2.11.4, matching the reviewed host. Keep the shared host's global options,
Mochi sites, analytics sites and mail certificate site unchanged.

## Range capture and review

`ranges-20261008` contains the dated raw official IPv4/IPv6 responses and their
SHA-256 manifest. Cloudflare's authoritative sources are
[IPv4](https://www.cloudflare.com/ips-v4),
[IPv6](https://www.cloudflare.com/ips-v6) and the
[range index](https://www.cloudflare.com/ips/). Capture anew before a later rollout:

```sh
python3 deploy/cloudflare/configure.py capture --output /private/new-range-capture
python3 deploy/cloudflare/configure.py render --ranges /private/new-range-capture \
  > /private/reviewed-edge-snippets.caddy
```

Capture refuses an existing destination, redirects, malformed/private/overbroad
ranges and excessive lists. Rendering checks the original hashes, identities and
a maximum 30-day age. Review added/removed ranges and the generated diff before
installing; no unattended trusted-network update is introduced. Install the
reviewed snippet file root-owned, read-only to Caddy. Record its checksum.

## Site-scoped installation

Import the snippet definitions once at the top level. In the existing apex and
www blocks, put one explicit `route` around the existing **HTTP handlers**, then
import the selected edge snippet first. Keep site-level `tls`, `log`, `bind`,
`encode` and other non-handler settings in their proper Caddy contexts. Preserve
all existing handler order and path rewrites. A schematic example follows; it
must be reconciled with the complete installed blocks, including collection
proxies, before use:

```caddyfile
import /etc/caddy/canquery-edge-snippets.caddy

canquery.example {
    encode zstd gzip
    header -Server
    route {
        import canquery-edge-transition
        # Existing analytics/other path handlers stay here, unchanged.
        # Add the proxy identity import inside each of their reverse_proxy blocks.
        reverse_proxy 127.0.0.1:3100 {
            import canquery-proxy-identity
        }
    }
}
www.canquery.example {
    route {
        import canquery-edge-transition
        redir https://canquery.example{uri} permanent
    }
}
```

The explicit route is required. Caddy normally sorts `handle` ahead of `respond`;
a restriction outside a route can therefore run after a nested proxy has already
answered. Do not add a global directive-order or trusted-proxy setting to solve
this. [Caddy directive ordering](https://caddyserver.com/docs/caddyfile/directives#directive-order)

The transition snippet starts with the connection's actual peer IP. Only a peer
in the captured Cloudflare networks may replace it with `CF-Connecting-IP`; an
absent or obviously malformed edge identity fails closed. The proxy snippet
replaces `X-Forwarded-For` with that single normalized identity and removes other
forwarded identity headers. Direct callers cannot forge their IP through those
headers. Caddy's normal Host and protocol handling remains in place, and the API
continues trusting its one loopback Caddy hop. Apply the proxy snippet to every
CanQuery reverse proxy, including analytics collection proxies, so they receive
the same normalized identity. [Cloudflare request headers](https://developers.cloudflare.com/fundamentals/reference/http-request-headers/),
[Caddy proxy headers](https://caddyserver.com/docs/caddyfile/directives/reverse_proxy#headers)

Keep Cloudflare Pseudo IPv4 **off** (or Add Header rather than Overwrite Headers),
and do not enable the transform that removes visitor IP headers. There is no
broad trust in caller-supplied X-Forwarded-For, no use of Caddy's global client-IP
settings, and no change to unrelated hostnames. Network admission establishes a
Cloudflare source, not ownership of a particular Cloudflare zone; it is not a
replacement for zone-specific authenticated origin pulls if those are adopted
later. [Authenticated origin pulls](https://developers.cloudflare.com/ssl/origin-configuration/authenticated-origin-pull/)

## Transition, origin lock and acceptance

First deploy transition handling and validate the complete staged Caddyfile with
the installed Caddy version before a scoped reload. Preserve the original full
configuration privately. Verify apex/www and unrelated services, both direct and
through Cloudflare. Enable Full (strict), proxy only the intended web records,
and preserve all mail MX/TXT/CAA and certificate automation records. The mail
hostname remains DNS-only; this procedure does not filter SMTP or shared ports.
[Cloudflare proxy limitations](https://developers.cloudflare.com/dns/proxy-status/limitations/)

After authoritative nameserver delegation and the intended proxied A/AAAA records
are confirmed, and real client tests reach Cloudflare, switch **only** the two
site imports to `canquery-edge-locked`. It permits Cloudflare networks and exactly
127.0.0.1/::1 for local operator canaries. Other peers receive 403 before any
CanQuery nested handler or www redirect. Preserve the normalized-header import.
Validate the complete config again and reload through the existing service.
If delegation/cache propagation is incomplete, keep transition mode active.

Do not impose a host-wide Cloudflare-only firewall on this shared server. Keep
ports 80/443 accessible for unrelated sites and Caddy-managed ACME challenges.
These snippets restrict the site's application routes; they do not disable TLS
or Caddy's automatic HTTP challenge handler. Leave normal automatic HTTPS
enabled. Do not create a blanket public `/.well-known/acme-challenge/*` application
bypass: only an actual active ACME challenge should be answered by Caddy. A fake
challenge path does not test renewal. Through a proxied hostname, ensure the
edge permits real HTTP-01 challenge requests without cache/challenge interference;
TLS-ALPN validation does not pass through a standard HTTPS reverse proxy. Verify
certificate renewal through the existing controlled procedure and retain the mail
certificate timer. [Caddy automatic HTTPS and ACME](https://caddyserver.com/docs/automatic-https#acme-challenges)

Acceptance should retain time, peer path, HTTP status and relevant headers:

- Through the edge: public metadata/health, anonymous private-account 401,
  login/no-store, API noindex, and versioned static asset cache behavior.
- Direct remote origin with the correct Host/SNI: apex and www return 403 in
  locked mode, even with forged CF-Connecting-IP/X-Forwarded-For.
- Local loopback with correct Host/SNI: bounded metadata/health remain available;
  forged edge headers do not change the local visitor identity.
- Isolated fixtures: machine API and signed webhook requests remain ordinary
  HTTP responses, with no browser challenge; keyed successes/errors stay
  private/no-store and reach metering. Do not cache API/account/auth/webhook routes.
- Shared Mochi and mail certificate endpoints behave as before; no mail/DNS
  configuration is replaced. Certificate renewal is a separate verified gate.

Production GET checks must avoid query/profile/export/activity routes that renew
or measure resource use. Use isolated fixtures for slow requests, IP limiter
behavior, account/payment paths, preparation and export cancellation. An origin
lock rollback changes only the two imports back to transition, validates and
reloads; it retains correct visitor-IP normalization and all unrelated settings.

## Local executable verification

```sh
CANQUERY_CADDY_TEST_BINARY=/path/to/reviewed/caddy \
  python3 -m unittest discover -s deploy/cloudflare -p 'test_*.py' -v
```

Without the explicit binary, range/generator checks run and two executable Caddy
cases are marked skipped. With Caddy 2.11.4, the harness validates and runs isolated
HTTP sites on ephemeral loopback ports. It models Cloudflare with a fixture-only
127.0.0.2 peer, proves direct-header spoof resistance and edge identity handling,
checks nested analytics paths and www ordering, and confirms unrelated mail/Mochi
hosts stay reachable. The production capture CLI refuses that private fixture
range. No test modifies the host's Caddy service or certificate store.
