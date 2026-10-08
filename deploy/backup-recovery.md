# Encrypted backups and recovery

This procedure installs the repository's native PostgreSQL backup runner with a
separate private R2 destination. It does not migrate the application to Cloudflare.
Follow [immutable releases](immutable-releases.md) for source and artifact
verification, [component monitoring](component-monitoring.md) for alerts, and
[runtime database privileges](database/README.md) for ownership recovery.
Examples use generic names. Inspect the installed host, database identities,
existing backup lock and schedule before adapting them. Preserve shared services.

## Recovery objectives and limits

The operating objectives are **RPO 24 hours** and **RTO 4 hours**. RPO measures the
age of the recoverable database snapshot at an incident; RTO measures elapsed time
from the recovery decision until the required service and correctness checks pass.
These are targets to measure in drills, not guarantees established by installation.

One successful daily run does not guarantee a strict 24-hour maximum loss window:
the next dump/upload takes time, a failed run increases the gap, and detection and
operator response take additional time. Record each database dump's start time
from the private job log and filename, completion time, remote verification time,
and the interval between recoverable snapshots. `verified_at` is not the database
snapshot time. Alerting after 25 hours is an operational tolerance, not a relaxation
of the 24-hour RPO target. If measured results cannot meet the target, review the
schedule and capacity; tighter recovery needs may require WAL archiving/PITR,
which this workflow does not provide.

Application and analytics dumps are separate consistent PostgreSQL snapshots,
not a single cross-database transaction. Configuration and cluster roles are
captured afterward. Keep release/configuration changes outside that capture
window or record their boundaries. Store the measured recovery result, unresolved
exceptions and the actual data-loss window with private drill evidence.

## What a successful run preserves

[`backup-runner.py`](backup-runner.py) runs as root under the host's existing
backup flock. It invokes the guarded [`canquery-backup.sh`](canquery-backup.sh),
which independently attempts custom-format, compression-level-6 application and
analytics dumps. Each dump must be nonempty and pass `pg_restore --list` before
its `.partial` name is atomically published. Only `map_store.features` **data** is
excluded; map metadata/jobs, catalogue data, prepared `store` tables, account,
billing and preparation-accounting state remain included.

The runner also captures the explicitly listed recovery configuration and
`pg_dumpall --globals-only` output. That output includes cluster role definitions,
memberships and private password hashes, potentially for other applications on a
shared PostgreSQL cluster. Handle the whole bundle as confidential. Dump files
retain database object ownership and ACLs; global role output does not replace
those database dumps.

The standalone uploader streams each file through `age` using only a public
recipient, uploads its ciphertext, reads the object back, and compares ciphertext
SHA-256 and length against the stream it actually uploaded. It also records the
plaintext SHA-256. Neither an S3 ETag nor object metadata is a checksum substitute.
The three verified files are recorded in:

```text
daily/<UTC-stamp>/<application-dump-name>.age
daily/<UTC-stamp>/<analytics-dump-name>.age
daily/<UTC-stamp>/configuration.tar.gz.age
daily/<UTC-stamp>/complete.json
```

`complete.json` records release commit, verification time, file kinds, keys,
plaintext/ciphertext hashes and ciphertext lengths. It contains no dump contents
or decryption key, but remains private operational metadata. The runner retains a
private local receipt only after the uploader and remote retention finish.

An existing object at the requested key causes a fail-closed refusal, even if its
plaintext-hash metadata matches. Retry a failed set with a **new UTC stamp**.
Never overwrite an existing recovery object or accept it by calculating a new
checksum from its own bytes. An incomplete prefix is not a complete recovery point.

## Destination, credentials and key custody

Create a dedicated private R2 **Standard** bucket; do not reuse the PMTiles bucket,
map credentials, public development URL or a browser-facing custom domain. The
backup process needs bucket-scoped object read/write/list/delete and multipart
access for upload, verification and retention. Keep bucket administration and
restore-only read credentials separate from this scheduled writer. Runtime API,
ingest and map identities must not be able to read backup credentials.

Generate the `age` identity on a trusted recovery machine, not the production VPS:

```sh
umask 077
age-keygen -o /secure/recovery/canquery-age.key
age-keygen -y /secure/recovery/canquery-age.key
```

The second command prints the public recipient. Install only that recipient on
the VPS. Keep at least two independently recoverable private-key copies under
operator custody, separate from the VPS and R2 writer credentials. Test access to
both copies, record their custody privately, and retain old identities while any
backup encrypted to their recipients remains. A key rotation needs a new verified
backup and decrypt/restore check before retiring an older identity. Do not include
the private key in `recovery_paths`, shell history, Git or ordinary logs.

A separately administered R2 retention lock can protect recovery objects from
premature deletion. Review its scope and duration against the pruning policy;
a longer lock can intentionally make pruning fail. Administrators can change lock
rules, so this is not protection against compromise of the administrator account.
See [R2 bucket locks](https://developers.cloudflare.com/r2/buckets/bucket-locks/).

## Install the verified operations release

Prerequisites are Node 22 compatible with the lockfiles, Python 3, Bash, `age`,
`flock`, `runuser`, native PostgreSQL client tools and a compatible PostgreSQL 16 /
PostGIS installation. Resolve every command through root-controlled directories.
Use the existing operating system `postgres` account for local peer-authenticated
dumps. Do not give the application runtime superuser credentials.

The CI release contains `operations/backup-upload.cjs`, bundled from locked AWS
SDK dependencies by [`build-operations.mjs`](../scripts/build-operations.mjs).
Install that generated file, not `deploy/backup-upload.cjs`: the latter resolves
application `node_modules` and is inappropriate for a privileged scheduled job.
No production frontend build or npm install is required for operations installation.

After verifying and sealing the exact release, run this adapted installation as
root. The destination must be new; use a new commit directory for each update.

```sh
set -eu
RELEASE_SHA=<complete-reviewed-commit>
RELEASE_DIR=/opt/canquery/releases/$RELEASE_SHA
OPERATIONS_DIR=/opt/canquery-operations/releases/$RELEASE_SHA

test ! -e "$OPERATIONS_DIR"
install -d -o root -g root -m 0755 /opt/canquery-operations/releases
install -d -o root -g root -m 0755 "$OPERATIONS_DIR"
install -o root -g root -m 0444 "$RELEASE_DIR/operations/backup-upload.cjs" "$OPERATIONS_DIR/backup-upload.cjs"
install -o root -g root -m 0444 "$RELEASE_DIR/deploy/backup-runner.py" "$OPERATIONS_DIR/backup-runner.py"
install -o root -g root -m 0444 "$RELEASE_DIR/deploy/canquery-backup.sh" "$OPERATIONS_DIR/canquery-backup.sh"
cmp "$RELEASE_DIR/operations/backup-upload.cjs" "$OPERATIONS_DIR/backup-upload.cjs"
cmp "$RELEASE_DIR/deploy/backup-runner.py" "$OPERATIONS_DIR/backup-runner.py"
cmp "$RELEASE_DIR/deploy/canquery-backup.sh" "$OPERATIONS_DIR/canquery-backup.sh"
chmod 0555 "$OPERATIONS_DIR"
install -d -o root -g root -m 0700 /etc/canquery/backup /var/lib/canquery-backup
install -d -o postgres -g postgres -m 0700 /var/backups/canquery
```

The installation block stops on a failed guard or copy. Do not re-run directory installation commands against an existing release to
make it writable. All ancestors of the runner configuration, uploader, dump
script and credential file must be root-owned and not group/world writable. The
configuration and credential file themselves must be root-private regular files;
symlink files are rejected. An application-owned parent is not acceptable.

A require-only smoke check must succeed from outside the application tree with
no application credentials or `NODE_PATH`. It does not initiate an upload:

```sh
cd /
env -i PATH=/usr/bin:/bin /usr/bin/node -e '
  const backup = require(process.argv[1]);
  if (typeof backup.uploadSet !== "function" || typeof backup.verifyObject !== "function") process.exit(1);
' "$OPERATIONS_DIR/backup-upload.cjs"
```

Promoting the application `current` symlink does not update these root operations
files. Updating the operations release and its scheduled target is a separate
reviewed promotion. Preserve the preceding files and receipts for diagnosis.

## Required configuration

Create root-owned mode-0600 `/etc/canquery/backup/config.json` with the complete
configuration below. Replace placeholders with inspected values. The JSON reader
does not expand shell variables. Use actual full commit paths, not `$RELEASE_SHA`
literals. The directories named by `backup_dir` and the status parent must already
exist before the first run.

```json
{
  "status_path": "/var/lib/canquery-backup/status.json",
  "backup_dir": "/var/backups/canquery",
  "app_database": "canquery",
  "analytics_database": "canquery_analytics",
  "min_free_gb": 35,
  "dump_script": "/opt/canquery-operations/releases/<commit>/canquery-backup.sh",
  "uploader": "/opt/canquery-operations/releases/<commit>/backup-upload.cjs",
  "node": "/usr/bin/node",
  "credential_file": "/etc/canquery/backup/r2.env",
  "release_manifest": "/opt/canquery/current/release-manifest.json",
  "deploy_user": "canquery-deploy",
  "legacy_checkout": "/srv/canquery-legacy",
  "recovery_paths": [
    "/etc/canquery/runtime",
    "/etc/canquery/backup",
    "/etc/canquery/observer.json"
  ]
}
```

| Key | Contract |
| --- | --- |
| `status_path` | Root-private JSON status; its parent also holds receipts and temporary recovery configuration. |
| `backup_dir` | Existing dump directory on a filesystem with verified physical headroom. |
| `app_database`, `analytics_database` | Exact native database names, using letters, numbers, `_` or `-`; do not infer names from public branding. |
| `min_free_gb` | Nonnegative integer GiB emergency floor; preserve the reviewed installed safeguard. |
| `dump_script`, `uploader` | Absolute root-owned immutable operations files. |
| `node` | Absolute compatible Node 22 executable, controlled by root. |
| `credential_file` | Root-private Node env file containing the five variables below. |
| `release_manifest` | Current application manifest supplying its complete commit identity. |
| `deploy_user`, `legacy_checkout` | Fallback identity/path used only when the release manifest does not exist; required for a legacy checkout installation. Do not rely on fallback after immutable migration. |
| `recovery_paths` | Explicit absolute existing configuration files/directories. Top-level symlinks are refused; nested symlinks are archived without following them. |

The sample `recovery_paths` is a starting point, not a complete universal recovery
inventory. Add the installed analytics environment, private auth secret, SMTP
credentials/signing material, required TLS material, deployment/runtime identities,
PostgreSQL authentication/settings, service units, cron/wrappers, Caddy/firewall
configuration and other required private settings under their actual paths. A
missing listed path fails the run. Resolve symlinked configuration to the intended
real source. Do not archive PGDATA, working tables, all of `/var/lib`, or unrelated
shared-host private trees as configuration. Inventory and restore shared mail and
role state deliberately. Keep required recovery software and a copy of its source
release independently accessible, too.

Create root-owned mode-0600 `/etc/canquery/backup/r2.env` privately:

```dotenv
CANQUERY_BACKUP_R2_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
CANQUERY_BACKUP_R2_BUCKET=<dedicated-private-backup-bucket>
CANQUERY_BACKUP_R2_ACCESS_KEY_ID=<bucket-scoped-object-key>
CANQUERY_BACKUP_R2_SECRET_ACCESS_KEY=<bucket-scoped-object-secret>
CANQUERY_BACKUP_AGE_RECIPIENT=<public-age1-recipient>
```

These are the uploader's complete environment settings; it uses region `auto`.
The runner passes database names, directory, floor and a deliberately very long
host-script retention interval itself. `server/.env` is not loaded by the backup
shell script. Keep conflicting inherited `CANQUERY_BACKUP_*` values out of the
scheduler environment, since Node env-file loading does not overwrite existing
process variables. Never print the private env file to verify installation.

## First run and schedule

Before admission, measure space on the dump filesystem and status/configuration
filesystem. The dump script requires its floor plus the larger of 256 MiB or
1.25 times the newest nonempty matching dump for each database. It monitors free
space while dumping and removes only its own partial output if the floor is
crossed. Reserve additional room for both new dumps, temporary configuration,
normal database/WAL growth and any concurrent ingestion. The floor is not an
operating-capacity target.

Run one complete attempt under the **existing** host backup lock, with output
captured in a root-private log. Do not start a second backup path or launch an
unlocked uploader against the scheduled destination:

```sh
flock -n /run/lock/canquery-backup.lock \
  /usr/bin/python3 /opt/canquery-operations/releases/<commit>/backup-runner.py \
  --config /etc/canquery/backup/config.json
```

This command writes dumps and remote objects and may prune older scheduled
backups after verification; it is not a dry run. Check its exit code, local
receipt, remote `complete.json`, and decrypted hashes on the recovery machine.
Complete the restore drill below before calling the recovery system accepted.

Replace the existing daily backup invocation after inspection; do not add a
competing schedule. Example root cron entry, on a host whose cron timezone has
been verified as UTC:

```cron
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 1 * * * root /usr/bin/flock -n /run/lock/canquery-backup.lock /usr/bin/python3 /opt/canquery-operations/releases/<commit>/backup-runner.py --config /etc/canquery/backup/config.json >> /var/log/canquery-backup.log 2>&1
```

Create and protect that log before scheduling, retain errors, and configure
bounded log rotation without exposing credentials. Inspect the next scheduled
receipt, rather than inferring activation from an installed cron file.

## Retention, orphan uploads and storage budget

The automatic policies are intentionally different:

- **Remote daily sets:** retain complete sets for 30 days by verification time,
  while protecting the newest two complete sets regardless of age. Before
  deleting any older set, re-download and verify every object in both protected
  sets. Missing/corrupt objects or invalid receipts stop pruning.
- **Local scheduled dumps:** after successful complete remote processing, retain
  the newest two manifest-readable dumps for each database independently. The
  newest local plaintext hash must match the verified receipt before deletion.
  With fewer than two valid local dumps, skip that database's cleanup. This is a
  count policy, not seven days of local retention.
- **Release directories, manual archives, partial files and `archive/` objects:**
  outside automatic daily retention. Preserve their separate evidence and policy.
  The uploader's `--archive-manifest` facility verifies explicit source hashes;
  it does not create a daily three-file recovery set or apply daily retention.

A failed dump/upload/verification or remote-prune failure does not authorize
local count pruning. The host script's ordinary age policy is suppressed by the
runner; do not invoke that script separately with a conflicting retention policy.
A remote complete set can exist even if later remote pruning failed and the run
was marked failed. Preserve the failure and investigate; do not edit status to
claim success or delete local files based solely on object presence.

The uploader requests abort of unfinished multipart work on handled failures.
A killed host/process can leave multipart parts. Inspect the backup bucket's
lifecycle configuration and retain an **abort incomplete multipart uploads after
seven days** rule; R2 documents that as its default. This rule acts on incomplete
multipart work, not complete backup objects. Do not add a blanket 30-day object
expiration rule: that would bypass the newest-two recovery protection during an
outage. See [R2 object lifecycles](https://developers.cloudflare.com/r2/buckets/object-lifecycles/).

Fully uploaded objects in a prefix without `complete.json` are another kind of
orphan and are not removed by multipart abortion or the daily pruner. Review an
inventory against retained receipts, active attempts and recovery requirements
before any separate cleanup. Use a grace period longer than the maximum active
attempt, verify two newer complete recoverable sets, and approve exact keys;
never delete an entire prefix merely because a receipt is absent.

Measure actual storage rather than quoting a fixed cost. Record local dump and
configuration sizes, each set's ciphertext bytes, total bucket bytes by `daily/`
and `archive/`, incomplete multipart usage, verification traffic/operations and
any retention-lock overhang. At a stable daily cadence, roughly 30 complete sets
plus exceptional retained sets, archives and orphan work determine remote usage.
Upload read-back and protected-set re-verification add reads; include them in the
budget. Use current provider pricing separately. Alert before exceeding the
reviewed storage/spend budget, and review growth after schema or retention changes.

## Status, failures and alert acceptance

The runner atomically writes `last_attempt_at`, `last_attempt_status` (`running`,
`failed`, `succeeded`), `last_finished_at` after completion, and
`last_verified_at` after success. While running, it preserves the prior
`last_attempt_ok`; a failed attempt preserves the last successful verification
but sets that boolean false. Before the first success there may be no verified
time, so monitoring must remain degraded.

Main subprocess work shares a 7,100-second deadline; each dump/upload stage also
has a 5,400-second ceiling. Timeout or interruption sends TERM to the whole owned
process group, then KILL to remaining descendants and reaps its direct child.
Configuration creation, local hash reads and individual manifest inspections
also take time; do not describe the subprocess deadline as a hard whole-job SLA.

Configure the observer's `backup_status` to the exact status path and monitor
`/api/v1/ops/components/backups` externally. The current observer degrades a failed
attempt immediately, a running attempt older than two hours, or a verified remote
backup older than 25 hours. Missing/malformed/stale observations also fail closed.
Observe storage separately: its current operating threshold is 43 GiB free,
including the 35 GiB emergency floor, not an additional 43 GiB reservation.

Prove that an alert reaches the designated recipient with an isolated synthetic
failed/missing/stale backup-status fixture through the installed monitoring path.
Do not corrupt/delete a real backup or change its receipt to test notification.
Restore the original observer input, check recovery notification, and preserve
private delivery/time receipts. A timer being active, a monitor being created or
a component returning 503 is not evidence of notification delivery.

On failure, keep previous recovery points and the original private logs. Check
space, the lock holder, native database/dump errors, root ownership/permissions,
public recipient, R2 access, checksum mismatch and retention-lock refusals. Do
not disable storage floors or locks to hide the failure. Retry a complete attempt
under the same flock with a new stamp after its cause is understood. A boot-time
stale `running` state must not be converted to success without evidence.

## Current isolated restore drill

Use a separate recovery machine or isolated PostgreSQL 16/PostGIS environment
with enough disk, private directories and no connection to production databases.
Block outbound SMTP, Stripe and publisher requests. Do not run the API's billing
or mail maintenance, either worker, catalogue sync or destructive integration
fixtures against a restored customer database. A restored live commercial
`environment` remains live; do not rewrite it or start a sandbox runtime against
it to make a drill pass.

1. Select a complete recovery point. Obtain its private local receipt or another
   independently retained receipt and the matching remote `complete.json` using
   restore-only credentials. Compare identities, file keys/hashes, commit and
   timestamps. Download exactly the three named ciphertext objects. Confirm
   each byte length and ciphertext SHA-256 before decryption.
2. Decrypt with the independently held `age` identity into a private directory.
   Check the plaintext SHA-256 against the receipt; an encryption-success exit
   code is not sufficient. Run `pg_restore --list` on both dumps. Inspect the
   configuration tar's inventory before extraction, reject traversal/unexpected
   paths, and extract into a staging directory, never directly over `/`.
3. Reconcile `recovery/postgres-globals.sql` before database restore. On a fresh
   isolated cluster, restore required roles/memberships in their reviewed order.
   On a shared cluster, never apply the complete globals file blindly: it can
   redefine unrelated roles and contains password hashes. Confirm deployment,
   API/ingest/map and NOLOGIN store-owner identities and default/object ACLs.
4. Create new explicitly named drill databases and restore both dumps with
   `pg_restore --exit-on-error`. Preserve ownership and ACLs for a privilege
   drill; `--no-owner --no-acl` cannot establish production permission recovery.
   Install required extension packages first. Do not use `--clean` against an
   existing valuable database or restore over production for a test.
5. Validate the application and analytics independently using the checks below.
   Recover required private configuration into staged files, confirming the
   original `BETTER_AUTH_SECRET` and separate service credentials are available
   without printing them. Verify at least two independent identity-key copies can
   decrypt a retained backup. Record failures as well as passed retries.
6. Record start/end times, selected snapshot times, restored bytes, actual RPO
   and measured recovery duration. Include provisioning, retrieval, decryption,
   roles, restore, configuration and validation in the RTO assessment. A dump
   restore duration alone is not service recovery time. Compare against the
   24-hour/4-hour objectives and record any unmet boundary.

For example, after provisioning the isolated cluster and reconciling its roles,
restore into newly created databases. These commands must run **on the isolated
recovery environment**, with no production connection variables or port forwards.
The absolute dump paths refer to already decrypted, hash-verified private files:

```sh
set -eu
RESTORE_APP_DB=canquery_drill_application
RESTORE_ANALYTICS_DB=canquery_drill_analytics
RESTORE_APP_DUMP=/secure/restore/application.dump
RESTORE_ANALYTICS_DUMP=/secure/restore/analytics.dump
runuser -u postgres -- createdb --template=template0 "$RESTORE_APP_DB"
runuser -u postgres -- createdb --template=template0 "$RESTORE_ANALYTICS_DB"
runuser -u postgres -- pg_restore --exit-on-error --dbname="$RESTORE_APP_DB" < "$RESTORE_APP_DUMP"
runuser -u postgres -- pg_restore --exit-on-error --dbname="$RESTORE_ANALYTICS_DB" < "$RESTORE_ANALYTICS_DUMP"
```

Creation must fail if either target already exists; do not turn that refusal into
a drop/recreate of an unidentified database. Redirection opens root-private dump
files before dropping to `postgres`, so no public file permissions are required.
Use the dedicated cluster's reviewed local connection parameters. Keep all
application/disposable-test environment variables unset until their distinct
targets have been checked. The normal integration suite deletes/recreates fixture
rows and is not a validation tool for restored customer state.

Restore validation must cover:

- Exact application migration inventory, including commercial/preparation
  migrations 034–035 and runtime helper migration 036 when present in the selected
  point; analytics' independent migration history and corrected measurements.
- Catalogue/provenance/place counts; serving and retired snapshot references;
  representative and pinned prepared-table row counts, schema, `_id` ordering
  and identifier/text fidelity. Verify storage accounting against actual restored
  relations. Empty `map_store.features` is expected; map metadata/jobs and PMTiles
  references must remain. A separately scoped rebuild may be required before
  declaring the local-map component restored.
- Auth users, verified ownership/terms state, sessions/credential records and
  original auth secret; separate private SMTP/configuration recovery. Do not
  decrypt or print individual account/reset payloads for a count check.
- Current commercial environment, accounts, periods, earned paid access, API-key
  digests/prefixes, used/reserved balances, detailed/daily usage, Stripe identities
  and event backlog. Check nonnegative balances and `used + reserved <= allowance`.
- Durable preparation debit identities and original payer/period/amount,
  immutable succeeded/refunded outcomes, unresolved charges, original-period
  reversals and ingest publication receipts. Compare against captured counts or
  aggregate fingerprints where available; do not fabricate a charge or refund to
  resolve missing history.
- Ownership, memberships, default and object privileges, including negative
  checks that runtime roles cannot assume deployment ownership or read other
  services' private data. Keep copied financial/auth data private throughout.

Plan a new drill after material schema, account, credential or backup changes,
and at the reviewed periodic interval. A previous drill predating current ledgers
or runtime-role separation does not establish today's complete recoverability.

## Real incident recovery boundary

A production restore is a separate task-specific recovery decision. First preserve
current damaged/newer state and private incident evidence, establish the desired
recovery point and account for writes after that point. Freeze relevant admissions,
stop the existing API/maintenance/workers and schedules in a coordinated boundary;
never start a second worker. Preserve the installed environment, newer migrations,
storage floors, pins, receipts and shared-service configuration unless a reviewed
recovery explicitly reconciles them.

Restore compatible code, roles, databases and necessary configuration together.
An old database dump must not silently erase newer accounts, earned paid periods,
usage or preparation outcomes. Stripe events or payments accepted after the chosen
point require reconciliation against actual provider evidence; do not infer access
from redirects or clear failure history. Mail restored from an earlier point may
already have been accepted for delivery, so review the outbox before enabling
maintenance. Do not cancel subscriptions, issue cash refunds, resend account mail,
or reset credits merely to make a restore appear healthy.

Reopen service only after the scoped correctness, privilege, health and alert
checks pass and remaining map/source recovery impact is stated. Preserve the
original incident, unsuccessful attempts and final recovery receipts privately.
