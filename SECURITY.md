# Security Policy

## Reporting a vulnerability

Please **do not** open a public issue for security problems.

Instead, report privately through GitHub: go to the repository's **Security** tab
→ **Report a vulnerability** (GitHub Private Vulnerability Reporting). That keeps
the report confidential until a fix is available.

Please include:

- a description of the issue and its impact,
- steps to reproduce (a minimal request/payload is ideal),
- the affected endpoint or component, and the commit/branch you tested.

You can expect an acknowledgement within a few days. Once a fix is released, we're
happy to credit you unless you'd prefer to stay anonymous.

## Scope notes

- CanQuery keeps public browser data access and adds verified developer accounts,
  hashed API keys and bounded credit allowances. Account/billing routes require
  owner sessions; Stripe webhooks require a signature. Reports about account
  isolation, quota races, session handling or billing reconciliation are welcome.
- CanQuery ingests **only** files already listed
  in the upstream catalogue (never arbitrary user-supplied URLs). Catalogue URLs
  are still treated as untrusted: downloads allow only public HTTP(S) targets,
  validate and DNS-pin each redirect hop, and can be backed by the shipped egress
  firewall. Reports about bypasses in this path, the query/filter grammar, SQL
  handling, or resource-exhaustion limits are especially welcome.
- The underlying open data is mirrored from open.canada.ca; issues with the
  datasets themselves are out of scope here (raise those upstream).

## Dependency audit follow-up

The September 9, 2026 closeout updates compatible Browserslist, browser mapping,
js-yaml, qs and Vitest dependencies. The remaining moderate upstream advisories
require separate compatibility review; do not use `npm audit fix --force` to
downgrade ExcelJS or change parser major versions during deployment.

The commercial-account work on October 6, 2026 updates compatible `proxy-addr`
to 2.0.8 and each `brace-expansion` dependency to its patched major-compatible
release (1.1.21, 2.1.7 or 5.0.12). The production-dependency audit then reports
four moderate findings and no high/critical findings; this is a dated result.
The added auth, Stripe and mail dependencies have no reported findings in that
audit. The [proxy advisory](https://github.com/jshttp/proxy-addr/security/advisories/GHSA-jqcg-44mw-7w3h)
concerns subnet trust rules; CanQuery retains its existing one-hop proxy setting.
Keep the API listener behind the configured reverse proxy.

The October 8, 2026 source review reproduced the pinned `stream-json`
[Assembler prototype handling](https://github.com/uhop/stream-json/security/advisories/GHSA-mjw6-4jj6-33hc)
issue in GeoJSON feature assembly. Preflight now rejects decoded `__proto__`
object keys at every depth before assembly. The separate
[JSONC comment parsing](https://github.com/uhop/stream-json/security/advisories/GHSA-hqr4-qq8f-hg3x)
path is not used: map ingestion imports the plain JSON parser. Keep these checks
separate from the nesting guard; no one guard covers every parser advisory.

That review's production-only server audit still reported four moderate
package findings and no high/critical findings. Full development audits also
include Jest dependency findings; release runtime dependencies are installed
with `npm ci --omit=dev`. Audit counts describe that dated lockfile and do not
establish that every dependency is safe or every advisory is reachable. Keep
build/test inputs trusted and review major tooling upgrades separately.

| Dependency | Current handling |
| --- | --- |
| [stream-json path-filter nesting](https://github.com/advisories/GHSA-528h-pc64-c93x) | GeoJSON preflight rejects nesting deeper than 128 before the path-filter pass. Keep this guard during a future parser upgrade. |
| [csv-parse duplicate column handling](https://github.com/advisories/GHSA-8cw4-87c7-c6xx) | The application does not enable `group_columns_by_name`, which is required by the reported duplicate-column path. Review major-version changes separately. |
| [ExcelJS transitive uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | The pinned ExcelJS source uses `v4`, while this advisory concerns `v3`/`v5`/`v6` with caller-provided output buffers. No affected call was found. Track upstream compatibility; do not downgrade ExcelJS to satisfy an automated audit suggestion. |

## Converter and runtime boundaries

The converter runs in a memory-limited child with archive, output and execution
limits. It receives only locale, executable-path and temporary-directory
settings; database/billing/object credentials and `NODE_OPTIONS` are not
inherited. Archive limits are resolved by the parent and passed explicitly.
The child still runs as the ingestion Unix identity and shares that identity's
permitted filesystem and network access. This is process isolation and secret
minimization, not a separate OS sandbox or proof against arbitrary code
execution. Keep runtime identities separate, configuration root-private, release
source read-only and the ingestion identity's privileges narrow.

The single ingest worker drains its current attempt on SIGTERM. The supplied
32-minute service stop grace covers the default 30-minute preparation deadline
plus cancellation and cleanup. If that deadline is increased, review the service
grace too; forced termination can interrupt cleanup even though publication
receipts and normal queue recovery preserve accounting evidence.
