#!/usr/bin/env bash
# Invoke under the host's existing backup flock. Configuration is supplied by
# the caller; credentials continue to use PostgreSQL's local peer identity.
set -uo pipefail
umask 077

backup_dir=${CANQUERY_BACKUP_DIR:-/var/backups/canquery}
app_database=${CANQUERY_BACKUP_APP_DATABASE:-canquery}
analytics_database=${CANQUERY_BACKUP_ANALYTICS_DATABASE:-canquery_analytics}
keep_days=${CANQUERY_BACKUP_KEEP_DAYS:-7}
min_free_gb=${CANQUERY_BACKUP_MIN_FREE_GB:-2}
stamp=$(date -u +%Y%m%dT%H%M%SZ)
dump_pid=
partial=

if [[ ! $app_database =~ ^[A-Za-z0-9_-]+$ || ! $analytics_database =~ ^[A-Za-z0-9_-]+$ ||
      ! $keep_days =~ ^[1-9][0-9]*$ || ! $min_free_gb =~ ^[0-9]+$ ]]; then
    echo 'Invalid backup configuration' >&2
    exit 1
fi
min_free_bytes=$((min_free_gb * 1024 * 1024 * 1024))
install -d -o postgres -g postgres -m 0700 "$backup_dir" || exit 1

cleanup() {
    if [[ -n $dump_pid ]]; then
        kill -TERM "$dump_pid" 2>/dev/null || true
        wait "$dump_pid" 2>/dev/null || true
    fi
    if [[ -n $partial ]]; then rm -f -- "$partial"; fi
}
trap cleanup EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

available_bytes() {
    df -PB1 "$backup_dir" | awk 'NR == 2 {print $4}'
}

dump_one() {
    local database=$1
    shift
    local prefix=${database//_/-}
    local final="$backup_dir/$prefix-$stamp.dump"
    local available previous reserve
    partial="$final.partial"
    if [[ -e $final || -e $partial ]]; then
        echo "Refusing to overwrite backup: $final" >&2
        partial=
        return 1
    fi
    previous=$(find "$backup_dir" -maxdepth 1 -type f -size +0 -name "$prefix-????????T??????Z.dump" -printf '%T@ %s\n' | sort -nr | awk 'NR == 1 {print $2}')
    reserve=$(( ${previous:-0} * 5 / 4 ))
    if ((reserve < 268435456)); then reserve=268435456; fi
    available=$(available_bytes)
    if [[ ! $available =~ ^[0-9]+$ ]] || ((available < min_free_bytes + reserve)); then
        echo "Insufficient backup headroom for $database" >&2
        partial=
        return 1
    fi
    echo "Starting $database backup at $(date -u +%FT%TZ)"
    runuser -u postgres -- pg_dump --format=custom --compress=6 "$@" --file="$partial" "$database" &
    dump_pid=$!
    while kill -0 "$dump_pid" 2>/dev/null; do
        available=$(available_bytes)
        if [[ ! $available =~ ^[0-9]+$ ]] || ((available < min_free_bytes)); then
            echo "Stopping $database backup to preserve disk headroom" >&2
            kill -TERM "$dump_pid" 2>/dev/null || true
            wait "$dump_pid" 2>/dev/null || true
            dump_pid=
            rm -f -- "$partial"
            partial=
            return 1
        fi
        sleep 1
    done
    if ! wait "$dump_pid"; then
        dump_pid=
        echo "Backup failed for $database" >&2
        rm -f -- "$partial"
        partial=
        return 1
    fi
    dump_pid=
    if [[ ! -s $partial ]] || ! pg_restore --list "$partial" >/dev/null; then
        echo "Backup manifest validation failed for $database" >&2
        rm -f -- "$partial"
        partial=
        return 1
    fi
    chmod 0600 "$partial" || return 1
    mv -T -- "$partial" "$final" || return 1
    partial=
    echo "Published $final at $(date -u +%FT%TZ)"
}

status=0
dump_one "$app_database" --exclude-table-data=map_store.features || status=1
dump_one "$analytics_database" || status=1

# Retention is independent of today's dumps. Preserve the newest two
# manifest-readable archives per database even if they exceed the age limit.
python3 - "$backup_dir" "$keep_days" "${app_database//_/-}" "${analytics_database//_/-}" <<'PY' || status=1
import pathlib,re,subprocess,sys,time
directory=pathlib.Path(sys.argv[1])
cutoff=time.time()-int(sys.argv[2])*86400
for prefix in sys.argv[3:]:
    pattern=re.compile(re.escape(prefix)+r'-\d{8}T\d{6}Z\.dump$')
    files=sorted((p for p in directory.iterdir() if p.is_file() and not p.is_symlink() and pattern.fullmatch(p.name)),key=lambda p:p.stat().st_mtime,reverse=True)
    protected=set()
    for path in files:
        if path.stat().st_size and subprocess.run(['pg_restore','--list',str(path)],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL).returncode==0:
            protected.add(path)
            if len(protected)==2: break
    if len(protected)<2:
        print('Retention skipped: fewer than two valid backups for '+prefix,file=sys.stderr)
        continue
    for path in files:
        if path not in protected and path.stat().st_mtime<cutoff:
            path.unlink()
            print('Expired '+str(path),flush=True)
PY
exit "$status"
