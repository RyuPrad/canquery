# CanQuery security review — October 2026

CanQuery completed a white-box application and deployment review on October 9,
2026. The review covered the public API and website, developer accounts, billing
boundaries, catalogue ingestion, map processing, database roles, release
artifacts, service confinement, public network exposure and recovery controls.
It included source review, dependency and secret scanning, disposable-database
tests, and bounded read-only production checks.

The review produced the following application changes:

- authentication request bodies are parsed through a 64 KiB boundary before
  reaching Better Auth, and unsupported authentication media types are rejected;
- authentication and Stripe webhook endpoints have inexpensive admission limits
  before database or signature work;
- CORS accepts only configured origins and does not derive trust from the request
  `Host` header;
- encrypted account-mail payloads explicitly require a 16-byte AES-GCM tag;
- `csv-parse`, `stream-json`, Jest and ExcelJS's transitive UUID dependency were
  updated, while existing parser depth and object-key validation remains in place;
- CanQuery runtime service definitions disable core-dump creation.

Production dependency audits for both the server and client reported no known
vulnerabilities after the updates. The full development audit retains a moderate
advisory chain in Jest's coverage tooling; it is not installed in the production
runtime, processes repository-controlled test inputs, and has no patched upstream
release at the time of review. Gitleaks findings were checked and were fixed-length
SHA-256 manifest values, not credentials.

Validation included 1,140 server tests, 514 client tests, 66 Jest database tests,
45 native database and privilege tests, the production frontend build, operational
Python and Node checks, and the repository's complete source verifier. PostgreSQL
tests ran only against a disposable PostgreSQL 16/PostGIS 3.5 database.

The production review confirmed that database and application listeners remain
loopback-only, the public host firewall exposes the intended web, SSH and mail
submission ports, runtime identities remain separated, releases are read-only,
and `main` is protected. This is a dated review, not a claim that vulnerabilities
cannot exist. Please use the private reporting process in [SECURITY.md](SECURITY.md)
for suspected security issues.
