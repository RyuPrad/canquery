-- Live progress of a running preparation (download bytes, loaded rows, then
-- the finishing steps), written by the ingest worker alongside its heartbeat
-- and shown to the page that waits for the table. Additive; no backfill.
ALTER TABLE ingest_jobs ADD COLUMN IF NOT EXISTS progress jsonb;
