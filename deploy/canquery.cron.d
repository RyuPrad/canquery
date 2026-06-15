# /etc/cron.d/canquery
# A root cron drop-in whose wrapper drops to the unprivileged app user and logs
# to its home. Install the wrapper at /usr/local/sbin/canquery-run-job.sh (see
# DEPLOY.md).
SHELL=/bin/sh
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin

# Full catalogue harvest (resumable; ~50k datasets - first run takes hours)
15 2 * * * root /usr/local/sbin/canquery-run-job.sh catalog-sync

# Incremental upserts from package_search high-water mark
*/30 * * * * root /usr/local/sbin/canquery-run-job.sh incremental-sync

# Enforce STORE_BUDGET_GB on the store schema
45 3 * * * root /usr/local/sbin/canquery-run-job.sh evict-store
