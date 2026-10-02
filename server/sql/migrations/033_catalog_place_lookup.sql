-- Discovery enriches each selected dataset with its place memberships. The
-- existing source/place-leading indexes cannot support this lookup efficiently.
-- Refuse a busy catalogue instead of holding up normal source publication.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '30s';

CREATE INDEX IF NOT EXISTS idx_dataset_places_dataset_id
    ON dataset_places(dataset_id);
