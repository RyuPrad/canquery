-- Durable retry scheduling for the map worker. A failed download must not
-- monopolize the single queue owner while healthy sources are waiting.
ALTER TABLE map_index_jobs
    ADD COLUMN IF NOT EXISTS next_attempt_at timestamptz NOT NULL DEFAULT now(),
    ADD COLUMN IF NOT EXISTS failure_code text;

CREATE INDEX IF NOT EXISTS idx_map_index_jobs_claimable
    ON map_index_jobs(next_attempt_at, updated_at, resource_id)
    WHERE status = 'pending';
