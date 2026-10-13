-- Publication receipts record which snapshot a preparation job published. A
-- database that already has them (the hosted edition added them alongside its
-- preparation charges) is left unchanged; a partial set stops for review.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';
DO $$
DECLARE present integer;
BEGIN
    SELECT count(*) INTO present FROM pg_attribute
        WHERE attrelid = 'public.ingest_jobs'::regclass AND attnum > 0 AND NOT attisdropped
        AND (attname, format_type(atttypid, atttypmod)) IN (('published_table_name', 'text'),
            ('published_source_version', 'text'), ('published_at', 'timestamp with time zone'));
    IF present = 0 AND NOT EXISTS (SELECT FROM pg_attribute WHERE attrelid = 'public.ingest_jobs'::regclass
        AND NOT attisdropped AND attname IN ('published_table_name', 'published_source_version', 'published_at')) THEN
        ALTER TABLE public.ingest_jobs
            ADD COLUMN published_table_name text,
            ADD COLUMN published_source_version text,
            ADD COLUMN published_at timestamptz,
            ADD CONSTRAINT ingest_jobs_publication_receipt CHECK (
                (published_table_name IS NULL AND published_source_version IS NULL AND published_at IS NULL)
                OR (published_table_name IS NOT NULL AND published_source_version IS NOT NULL AND published_at IS NOT NULL)
            );
    ELSIF present <> 3 OR NOT EXISTS (SELECT FROM pg_constraint
        WHERE conrelid = 'public.ingest_jobs'::regclass AND conname = 'ingest_jobs_publication_receipt' AND contype = 'c') THEN
        RAISE EXCEPTION 'ingest_jobs publication receipts are incomplete; review the table before migrating';
    END IF;
END;
$$;
