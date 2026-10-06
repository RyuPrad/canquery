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

The current `stream-json` audit also reports
[Assembler prototype handling](https://github.com/uhop/stream-json/security/advisories/GHSA-mjw6-4jj6-33hc)
and [JSONC comment parsing](https://github.com/uhop/stream-json/security/advisories/GHSA-hqr4-qq8f-hg3x).
Those paths need a separate compatibility and reachability review; the existing
depth guard below is not a blanket mitigation for every parser advisory.

| Dependency | Current handling |
| --- | --- |
| [stream-json path-filter nesting](https://github.com/advisories/GHSA-528h-pc64-c93x) | GeoJSON preflight rejects nesting deeper than 128 before the path-filter pass. Keep this guard during a future parser upgrade. |
| [csv-parse duplicate column handling](https://github.com/advisories/GHSA-8cw4-87c7-c6xx) | The application does not enable `group_columns_by_name`, which is required by the reported duplicate-column path. Review major-version changes separately. |
| [ExcelJS transitive uuid](https://github.com/advisories/GHSA-w5hq-g745-h8pq) | Track the upstream ExcelJS dependency update; retain the existing isolated Excel conversion limits. |
