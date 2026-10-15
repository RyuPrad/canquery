-- Copy the declared jurisdiction from stored federal records, reading each
-- stored package once. Row locks only; a sync holding the same rows makes this
-- fail fast so it can be rerun.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10min';

WITH declared AS MATERIALIZED (
    SELECT d.id, lower(btrim(d.raw->>'jurisdiction')) AS jurisdiction
    FROM datasets d
    WHERE EXISTS (
        SELECT 1 FROM dataset_sources ds
        WHERE ds.dataset_id = d.id AND ds.source_id = 'open-canada')
)
UPDATE datasets d
SET jurisdiction = declared.jurisdiction
FROM declared
WHERE d.id = declared.id
  AND declared.jurisdiction IN ('federal', 'provincial', 'municipal')
  AND d.jurisdiction IS DISTINCT FROM declared.jurisdiction;

ALTER TABLE datasets VALIDATE CONSTRAINT datasets_jurisdiction_check;
ANALYZE datasets (jurisdiction);
