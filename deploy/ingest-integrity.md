# Ingestion integrity release

Blank numeric ingestion settings select the documented defaults; malformed or
out-of-range values fail startup with the setting name. The worker prints only
effective numeric limits and their units. Explicit zero still disables the
documented reserve/floor values, not file, row or column limits.

New preparations reject surplus CSV cells, including empty trailing cells.
Short records are padded with NULL. Integer strings with redundant leading
zeroes remain TEXT even when first encountered after the inference sample.
Original header labels are retained as `original_label`; field `id` values are
unique PostgreSQL identifiers bounded by UTF-8 bytes. New snapshots build a
unique `_id` index before the final relation-size admission check. This release
does not rebuild existing snapshots or recover historically lost zeroes.

## Existing identifier reconciliation

Before deploying strict local identifier validation, audit existing prepared
metadata against actual PostgreSQL columns. The operator script changes only
proved overlong-identifier metadata mismatches; it never renames a physical
column or changes preparation timestamps, source versions, rows or ledgers.
Run as the deployment/database owner with the intended database configured.
Keep manifests and receipts outside the public repository.

```sh
node server/scripts/repair-column-identifiers.js \
  --resource=REVIEWED_RESOURCE_ID --output=/private/new-manifest.json
```

Repeat `--resource` for the reviewed resource scope. The default preview uses a
read-only repeatable-read transaction and creates a new mode-0600 manifest.
Review the complete ordinal/type mapping and proposed JSON before applying:

```sh
node server/scripts/repair-column-identifiers.js --apply \
  --manifest=/private/new-manifest.json --receipt=/private/new-receipts.jsonl
```

Apply takes the store-budget, resource, reader and metadata locks in the existing
maintenance order, rechecks the complete evidence and skips busy resources or
active jobs. Each resource commits independently. A durable intent record
precedes its update, followed by a committed receipt. Preserve partial receipts;
after any applied batch or intervening change, produce a new preview instead of
replaying stale evidence. An unchanged fresh preview is a safe no-op.

Corrected fields retain explicit `legacy_ids` for old query inputs. Resolve
these before local SQL validation; returned IDs match actual record keys.
Client reconciliation and profile caches must use the ordered field schema as
well as snapshot identity, since a metadata correction does not change the true
preparation time. Promote the alias-aware server and schema-aware client with
the correction, clearing old process caches through the normal API restart.

Normal production rollout still requires current backups and the preparation
admission barrier/drained single worker. Preserve migration 035, publication
receipts and the original-period credit settlement boundary. Do not regenerate
the whole cache merely to install the index or fix these metadata entries.

## Verification

Focused unit suites cover configuration, full-stream CSV fidelity, identifiers,
query counts and reconciliation refusal. `preparationIntegration.test.js` adds
PostgreSQL field/record equality, late-overflow rollback, leading-zero fidelity,
index accounting, unchanged timestamps and reader/drift repair protections to
the existing snapshot/publication/eviction tests. Use only an explicitly
disposable database with all three integration URL gates set to that database.
