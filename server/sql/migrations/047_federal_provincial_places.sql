-- Provincial and territorial governments publish into the federal portal, and
-- their records declare jurisdiction 'provincial'. Place each such record in
-- its province or territory, directly and without inheritance, and give its
-- publisher the same place: the table in config/federalPublisherPlaces.js,
-- which every later federal sync applies. Places missing from this database
-- are skipped. Row locks only; a sync holding the same rows makes this fail
-- fast, and it can be rerun.
SET LOCAL lock_timeout = '3s';
SET LOCAL statement_timeout = '10min';

WITH publisher_places (name, place_id) AS (VALUES
    ('ab', 'sgc-pr-48'),
    ('bc-cb', 'sgc-pr-59'),
    ('mb', 'sgc-pr-46'),
    ('nb', 'sgc-pr-13'),
    ('nl-tnl', 'sgc-pr-10'),
    ('ns-ne', 'sgc-pr-12'),
    ('nwt-tno', 'sgc-pr-61'),
    ('on', 'ca-on'),
    ('pei-ipe', 'sgc-pr-11'),
    ('qc', 'sgc-pr-24'),
    ('sk', 'sgc-pr-47'),
    ('yk', 'sgc-pr-60')
), mapped AS MATERIALIZED (
    SELECT o.id AS org_id, pp.place_id
    FROM organizations o
    JOIN publisher_places pp ON pp.name = o.name
    WHERE EXISTS (SELECT 1 FROM places p WHERE p.id = pp.place_id)
), publishers AS (
    UPDATE organizations o
    SET place_id = mapped.place_id
    FROM mapped
    WHERE o.id = mapped.org_id AND o.place_id IS DISTINCT FROM mapped.place_id
    RETURNING o.id
)
INSERT INTO dataset_places (source_id, dataset_id, place_id, relationship, includes_descendants, assignment_method)
SELECT 'open-canada', d.id, mapped.place_id, 'direct', false, 'source'
FROM datasets d
JOIN mapped ON mapped.org_id = d.org_id
WHERE d.jurisdiction = 'provincial'
  AND EXISTS (
      SELECT 1 FROM dataset_sources ds
      WHERE ds.dataset_id = d.id AND ds.source_id = 'open-canada')
ON CONFLICT (source_id, dataset_id, place_id, relationship) DO NOTHING;

ANALYZE dataset_places;
