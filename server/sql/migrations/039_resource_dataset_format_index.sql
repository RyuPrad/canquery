-- Format filters and catalogue counts read each dataset's formats and live
-- tables. This index answers both without visiting the much wider resource
-- rows. Building it blocks resource writes, not reads; a busy catalogue
-- refuses the lock instead of waiting.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10min';

CREATE INDEX IF NOT EXISTS idx_resources_dataset_format
    ON resources (dataset_id, format) INCLUDE (datastore_active);
