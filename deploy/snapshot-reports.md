# Retaining a reproducible bounded extract

A prepared resource now exposes `ingestion.snapshot_id`. Query and profile
responses identify their local snapshot in `meta.snapshot`; send its `id` as the
`snapshot` query parameter on subsequent queries, profiles or CSV exports. The
server either uses that exact stored table/schema or returns HTTP 409 with
`code=SNAPSHOT_UNAVAILABLE`. Start a new extraction explicitly after this error.
No request automatically prepares a file, retains a historical table, or switches
to another copy. Missing resources still return 404. Live CKAN DataStore cannot
satisfy a required local snapshot.

The opaque token identifies a publication, not a publisher content hash. Metadata
changes do not change the token; replacing or rebuilding its table does. The
preparation timestamp is not a freshness guarantee. `source_metadata_version`
fingerprints tracked publisher metadata, and does not establish that the actual
file was checked and remained unchanged. Catalogue provenance and publisher
modification times are observations at retrieval, not preparation-time records.

## Local report bundle

Python 3's standard library is sufficient:

```sh
# Set CANQUERY_API_KEY privately in the calling environment when using a key.
python3 scripts/export-snapshot.py RESOURCE_ID /private/reports/report-2026-10-08 \
  --query-file /private/reports/query.json
```

The query file is an object containing existing `q`, `filters`, `sort`, `group_by`,
`agg`, `agg_column` or `bucket` parameters. For example:

```json
{"filters":{"STREET_NAME":"KING"}}
```

The resource must already have a ready local table. The helper reads metadata and
a one-row query, then retrieves sequential pages pinned to that snapshot. It
never requests preparation. Each successful request consumes its ordinary API
credits, including repeated inspection and aggregation requests; this is not the
25-credit CSV endpoint. HTTP retries may add normal successful-request charges.

A new private output directory contains `data.jsonl` and `manifest.json`. JSONL
retains returned null/empty distinctions and decimal or identifier strings; no
spreadsheet conversion is applied. The manifest records schema, exact query,
snapshot, observed provenance, timestamps, count/completeness, deployed limits,
request identifiers and the output SHA-256. It includes no key. A completed
manifest is the success marker; never use a partial output left by an interrupted
process. Existing directories are never overwritten.

By default the complete filtered output must fit the installed export bound
(hard maximum 10,000) and the API offset/page limits. Narrow the query when it does
not. `--allow-truncated` explicitly permits a bounded incomplete result and records
that fact in the manifest. Aggregate counts represent groups, not source rows.
The helper also refuses a response over 32 MiB or an output over 256 MiB. Its total
run deadline is 30 minutes, socket timeout at most 120 seconds, and at most three
retries per request; Retry-After remains authoritative. Redirects are not followed.
HTTP origins are accepted only for explicit local fixtures.

Retain the report bundle wherever its intended users can protect and recover it.
It is not uploaded automatically. A saved extract can explain a previous report
when its serving snapshot has expired; it does not promise that CanQuery can
re-run that old snapshot or reproduce publisher data that was never archived.

## Verification

```sh
python3 -m unittest discover -s scripts/tests -p 'test_export_snapshot.py'
npm --prefix server test -- --runTestsByPath __tests__/queryRuntime.test.js
```

Run the disposable PostgreSQL preparation integration suite for reader/refresh
races. Production rollout does not need a migration for snapshot tokens.

HTTP query work has a 110-second no-response-progress deadline, below the
Cloudflare proxy read timeout. JSON receives `504 REQUEST_TIMEOUT` before headers;
an already-started CSV closes and must be discarded. Streaming writes reset this
progress clock; keyed requests retain their separate four-minute maximum.
Disconnect/timeout cancels CKAN requests and retry waits and destroys a local
reader's connection. PostgreSQL checks disconnected clients every second and
retirement regains the snapshot lock. A shared preparation job remains independent
of its HTTP polling/admission connection.

Completed cached values remain reusable. Request-owned upstream/local computations
are not shared in flight, so cancelling one visitor cannot abort another visitor's
work. The API binds `127.0.0.1` by default (`HOST` overrides for an explicitly reviewed
network setup); Caddy supplies the one trusted proxy hop.
