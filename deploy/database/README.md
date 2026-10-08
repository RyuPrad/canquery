# Runtime database privileges

Migration 036 adds three narrowly scoped `SECURITY DEFINER` lock helpers. It
changes no row contents or login credentials. It must precede the compatible API
and ingest code. The helpers have a fixed trusted search path, qualified table
references, no caller SQL, and no PUBLIC execution privilege. Keep their owner as
the deployment identity. Never grant that identity to a runtime role.

`runtime-roles.sql` is an explicit administrator operation for PostgreSQL 16, not
an application migration or startup action. Apply only to the verified application
database, after current recovery backups and a reviewed privilege/ownership
inventory. Freeze preparation admission and stop the existing workers/API before
cutover. Do not start another worker. The script refuses unexpected store table
names/owners, runtime memberships, database identity or helper ownership.

```sh
psql --no-psqlrc --set=ON_ERROR_STOP=1 \
  --set=app_database=REVIEWED_DATABASE --set=deploy_role=REVIEWED_DEPLOY_OWNER \
  --file=deploy/database/runtime-roles.sql REVIEWED_DATABASE
```

Use a PostgreSQL administrative connection, with secrets supplied privately. The
script creates three LOGIN roles without passwords and one NOLOGIN owner. Set
separate private SCRAM credentials or matching local peer mappings during the
reviewed service cutover; install each connection string only into that runtime's
private environment. Do not put passwords into this SQL, shell arguments, logs,
Git, or migration history. Verify dedicated role names have no uses/grants in
other databases before applying this cluster-level change.

| Identity | Responsibility |
| --- | --- |
| Deployment owner | Migrations, catalogue/source schedules, backup administration and inspected repairs. Owns catalogue, auth/commercial objects and lock helpers. |
| `canquery_api` | Catalogue/map/snapshot reads, queue admission, activity/popularity and necessary authentication/account/meter/billing writes. No schema DDL, catalogue writes or snapshot modification. |
| `canquery_ingest` | Queue/attempt state, snapshot construction/publication/retirement and bounded original-debit settlement. No authentication, key, SMTP or Stripe rows. |
| `canquery_map` | Map queue and map metadata/features, with temporary geometry staging. No financial/auth rows or store snapshots. |
| `canquery_store_owner` | NOLOGIN owner of generated snapshots and owned sequences. Only ingest/deployment inherit it. Does not own catalogue or commercial objects. |

Set `CANQUERY_STORE_OWNER_ROLE=canquery_store_owner` for the ingest worker and any
explicit administrative process which builds a snapshot. The loader transfers
ownership immediately after creating the table, within its transaction. The
script transfers existing generated tables and their owned sequences, preserving
API SELECT grants. Default SELECT privileges are configured for each actual
creator (deployment, ingest and store owner); inherited role defaults alone do
not cover objects created as another role. Re-run reviewed grants after adding a
new persistent table or changing a runtime's responsibility. New auth/commercial
objects receive no automatic blanket runtime grants.

The public schema remains usable for PostGIS functions/types, but is not writable
by runtime roles or PUBLIC. PostgreSQL system catalogue visibility and ordinary
built-in functions are not a secret-storage boundary. The ingest role retains
substantial DDL authority within `store`; the API necessarily retains account,
billing and auth DML. These are scoped service privileges, not a row-level
multi-tenant isolation system.

Before reopening service, run the disposable role integration suite and actual
role canaries for account access, anonymous/keyed catalogue reads, a bounded
preparation/refund, local read/export, map claim/publication and retirement. Denial
checks must establish that runtime identities cannot change catalogue/pins,
assume the deployment role, modify API-read-only snapshots, or read other service
secrets. `integration/runtimeRoles.test.cjs` provisions and exercises these grants
only when all three disposable database gates match; never point it at a useful
preview or production database.

A recovery bundle must include role definitions, memberships, object/default
ACLs and independently recoverable private runtime configuration. Restore roles
before database objects. Do not roll back by granting deployment ownership to a
runtime identity or replacing current financial data. Compatible code can use the
helpers and split roles; keep migration 036 during a forward correction.
