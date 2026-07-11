-- Explicit worker ownership makes running ingest jobs observable and lets state
-- transitions reject a stale worker. The process-level PostgreSQL advisory lock
-- still guarantees only one queue-draining worker at a time.
ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS worker_id text;
ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS heartbeat_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_ingest_jobs_running_heartbeat
    ON ingest_jobs(heartbeat_at)
    WHERE status = 'running';
