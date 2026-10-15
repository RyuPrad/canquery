-- Federal records declare whether they are federal, provincial or municipal
-- data. Other sources leave this null and are classified by their places when
-- read. Adding a nullable column and an unvalidated check only changes the
-- catalog, so the table lock lasts milliseconds; 040 backfills and validates.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

ALTER TABLE datasets
    ADD COLUMN jurisdiction text,
    ADD CONSTRAINT datasets_jurisdiction_check
        CHECK (jurisdiction IN ('federal', 'provincial', 'municipal')) NOT VALID;
