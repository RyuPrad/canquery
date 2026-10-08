# Verified immutable releases

Build with Node 22.22.1, matching CI. Routine production releases consume the
`canquery-<commit>` CI artifact after all required jobs pass for that exact
commit. The artifact includes reviewed source, the tested frontend, locked
dependency manifests, migration inventory and a standalone backup uploader.
Native analytics and task-specific database/browser/operational acceptance
remain separate gates. No command below runs migrations or restarts services.

Use a deployment account to own source checkouts and isolated staging. Runtime
API/ingest/map identities must be different accounts. Root owns final releases,
the `current` link and separately installed operations code. Runtime directories,
credentials, databases and backups remain outside releases. Preserve historical
checkout/service names on existing hosts until their scoped migration is ready.

## Prepare and review

Record the current commit, service/unit configuration, database migration state,
frontend hashes and approved compatibility boundary. Obtain and validate fresh
database/configuration backups and remote recovery evidence. Resolve physical
headroom before staging; budget for dependencies, both frontend generations and
temporary work without lowering the configured safety floors.

Download the exact successful CI tarball and checksum. Copy its full SHA-256
from the trusted CI receipt; do not derive the expected value from an untrusted
archive on the target. Fetch the reviewed commit into a clean deployment-owned
checkout. `release.py` verifies the trusted archive hash, every member's path,
mode, size and digest, and all tracked bytes against that checkout's Git object.
Only the built frontend and standalone uploader may be additional generated
files. Source symlinks, traversal, duplicate entries and private `.env` files
are rejected. Keep these placeholders as task-specific variables, not secrets:

```bash
RELEASE_SHA=<complete-reviewed-commit>
RELEASE_CHECKSUM=<trusted-CI-tarball-sha256>
RELEASE_ARCHIVE=/private/artifacts/canquery-$RELEASE_SHA.tar.gz
RELEASE_CHECKOUT=/home/canquery-deploy/source
RELEASE_STAGE=/opt/canquery/staging/$RELEASE_SHA
RELEASE_FINAL=/opt/canquery/releases/$RELEASE_SHA
RELEASE_PREVIOUS=/opt/canquery/releases/<previous-commit>
```

Root creates `/opt/canquery/staging` for the deployment account and
`/opt/canquery/releases` as root-owned mode 0755. Keep both on the same
filesystem so final relocation is atomic. The runtime accounts must not belong
to the deployment group. The deployment account must not own the final-release
parent or `/opt/canquery/current`.

For the first conversion of an existing host, preserve its active checkout and
private environment. Create a baseline artifact from its exact clean deployed
commit and the already verified deployed `client/dist`, using the new packer's
`--source-root` option. Stage that baseline privately as an asset reference;
do not activate the old code or rebuild its frontend. This gives the first new
release a hash inventory for retained assets. Subsequent releases reference
the previous sealed release. An existing real directory at `current` is never
overwritten by the activation tool.

## Stage as the deployment user

Run the helper from the reviewed checkout. Every operation previews by default;
`--apply` is an explicit mutation. The stage directory must not already exist.

```bash
python3 deploy/release.py stage --archive "$RELEASE_ARCHIVE" \
  --sha256 "$RELEASE_CHECKSUM" --commit "$RELEASE_SHA" \
  --checkout "$RELEASE_CHECKOUT" --destination "$RELEASE_STAGE" \
  --previous-release "$RELEASE_PREVIOUS"
python3 deploy/release.py stage --archive "$RELEASE_ARCHIVE" \
  --sha256 "$RELEASE_CHECKSUM" --commit "$RELEASE_SHA" \
  --checkout "$RELEASE_CHECKOUT" --destination "$RELEASE_STAGE" \
  --previous-release "$RELEASE_PREVIOUS" --apply
npm ci --prefix "$RELEASE_STAGE/server" --omit=dev
```

Do not load production environment/secrets while installing dependencies. Only
the server's locked production dependencies are installed; the tested frontend
is never recompiled. Old hashed assets are copied only after their hashes match
the prior release inventory. A same-name/different-content collision fails.
Unversioned files, including the old HTML index, are never carried forward.
The new stage writes `client/dist/index.html` last. Retained assets are recorded
in `stage-receipt.json`; no automatic pruning of old assets/releases is added.
Failed stages remain isolated for diagnosis and require separate scoped cleanup.

## Seal, promote and verify

Root independently re-verifies the original trusted artifact and checkout,
then checks the installed stage for source drift, unexpected files and escaping
dependency symlinks. Sealing sets files to 0444 (0555 for executables), directories
to 0555 and ownership to root before relocating the stage to the root-owned
final-release parent. Runtime identities cannot edit source or dependencies.

```bash
sudo python3 deploy/release.py seal --release "$RELEASE_STAGE" \
  --archive "$RELEASE_ARCHIVE" --sha256 "$RELEASE_CHECKSUM" \
  --commit "$RELEASE_SHA" --checkout "$RELEASE_CHECKOUT" \
  --destination "$RELEASE_FINAL" --apply
sudo python3 deploy/release.py activate --release "$RELEASE_FINAL" \
  --current /opt/canquery/current --expected-current "$RELEASE_PREVIOUS"
```

Before the final activation, complete required forward migrations and any
admission/worker coordination in the reviewed release runbook. Point the service
working directories to `/opt/canquery/current/server` and load each service's
private environment through root-controlled `EnvironmentFile` directives.
Keep runtime write paths separate. Scheduled wrappers must also resolve the
intended release and load their private environment explicitly. Never copy a
historical whole environment or downgrade the account/preparation ledgers.

Run the same activation command with `--apply` only at the authorized promotion
boundary. It verifies the exact predecessor and atomically replaces only the
`current` symlink. For the first installation of that symlink, use
`--expected-current none`; this does not alter the preserved old checkout.
Restart only affected services using the installed unit identities, then verify
service health, meaningful workflow checks, file ownership, old/new frontend
asset delivery, CSP and continuity of unrelated services. The running old API
may continue serving its old release until its coordinated restart.

Install the verified `operations/backup-upload.cjs` in a separate root-owned,
read-only `/opt/canquery-operations/releases/<commit>` with the matching tracked
backup runner and host backup script. Use only that bundled uploader for root
backup jobs: it contains the locked AWS dependencies and must not resolve
application-owned `node_modules`. Root operations configuration and credentials
stay outside both application and operations releases. Updating the operations
service/cron target is an independent explicit promotion with its own smoke
check; switching the API release does not silently switch root jobs.

A code recovery repeats the same verified artifact procedure against a reviewed
compatible commit, retaining current migrations, configuration, billing and
preparation history. A prior release is not automatically compatible with newer
data. This tooling does not restore databases, drop snapshots, clear failures,
change capacity floors or cancel subscriptions.
