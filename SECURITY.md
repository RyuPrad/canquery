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

- canquery exposes an anonymous read API and ingests **only** files already listed
  in the upstream catalogue (never arbitrary user-supplied URLs). Catalogue URLs
  are still treated as untrusted: downloads allow only public HTTP(S) targets,
  validate and DNS-pin each redirect hop, and can be backed by the shipped egress
  firewall. Reports about bypasses in this path, the query/filter grammar, SQL
  handling, or resource-exhaustion limits are especially welcome.
- The underlying open data is mirrored from open.canada.ca; issues with the
  datasets themselves are out of scope here (raise those upstream).
