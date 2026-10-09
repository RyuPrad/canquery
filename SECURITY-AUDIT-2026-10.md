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

The production follow-up completed later on October 9:

- the reviewed distribution security transaction was installed and the host now
  runs kernel `6.12.0-211.61.1.el10_2`; a cache-only post-check reported no pending
  security updates, while the preceding normal kernel remains available as a
  fallback;
- SSH remains key-only. X11 forwarding is disabled, while TCP forwarding remains
  available for the owner's administrative tunnels with remote gateway exposure
  disabled. A fresh login, a loopback API tunnel and password rejection all passed;
- DMARC moved from monitoring-only to the [RFC 9989](https://www.rfc-editor.org/rfc/rfc9989.html)
  testing mode `p=quarantine; t=y`, with aggregate reports directed to the existing
  support address and subdomains retained at `sp=none`. One authorized message
  from each production sender reached Gmail with SPF, DKIM and DMARC all passing;
- a fresh encrypted recovery set passed remote ciphertext read-back after the
  update. At the final observation, readiness, health, availability, preparation,
  backups, storage and commercial checks returned HTTP 200. Operations and maps
  remained degraded for existing map backlog, and sources became degraded when
  Toronto's upstream returned HTTP 500 during the naturally scheduled municipal
  sync; no job was rerun or cleared for this review.

These operational changes did not alter application storage limits, customer data,
ingestion state or release behavior. Existing retained core files and previously
unmapped PostgreSQL files were not deleted or reclassified.

The production review confirmed that database and application listeners remain
loopback-only, the public host firewall exposes the intended web, SSH and mail
submission ports, runtime identities remain separated, releases are read-only,
and `main` is protected. This is a dated review, not a claim that vulnerabilities
cannot exist. Please use the private reporting process in [SECURITY.md](SECURITY.md)
for suspected security issues.
