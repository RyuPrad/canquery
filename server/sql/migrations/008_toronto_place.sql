-- Toronto is simultaneously a Statistics Canada census division and a
-- census subdivision. CanQuery exposes one stable city entry and keeps both
-- official identifiers (plus the former URL/id) as aliases.

UPDATE places
SET slug = 'toronto-on-3520005', updated_at = now()
WHERE id = 'sgc-csd-3520005' AND slug = 'toronto-on';

INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES (
    'sgc-cd-3520', 'toronto-on', 'municipality', 'Toronto', 'Toronto',
    'City', 'Ville', 'ca-on', 43.6532, -79.3832, 10, true, true
) ON CONFLICT (id) DO UPDATE SET
    slug = EXCLUDED.slug,
    kind = EXCLUDED.kind,
    name_en = EXCLUDED.name_en,
    name_fr = EXCLUDED.name_fr,
    type_en = EXCLUDED.type_en,
    type_fr = EXCLUDED.type_fr,
    parent_id = EXCLUDED.parent_id,
    latitude = EXCLUDED.latitude,
    longitude = EXCLUDED.longitude,
    default_zoom = EXCLUDED.default_zoom,
    enabled = true,
    featured = true,
    updated_at = now();

-- Merge any links created by an earlier SGC import before deleting the
-- duplicate subdivision place. Insert first so overlapping links are harmless.
INSERT INTO dataset_places (
    source_id, dataset_id, place_id, relationship,
    includes_descendants, assignment_method
)
SELECT source_id, dataset_id, 'sgc-cd-3520', relationship,
       includes_descendants, assignment_method
FROM dataset_places
WHERE place_id = 'sgc-csd-3520005'
ON CONFLICT (source_id, dataset_id, place_id, relationship) DO UPDATE SET
    includes_descendants = EXCLUDED.includes_descendants,
    assignment_method = EXCLUDED.assignment_method;

DELETE FROM dataset_places WHERE place_id = 'sgc-csd-3520005';
UPDATE organizations SET place_id = 'sgc-cd-3520'
WHERE place_id = 'sgc-csd-3520005';
DELETE FROM place_identifiers WHERE place_id = 'sgc-csd-3520005';

INSERT INTO place_identifiers (place_id, scheme, vintage, value)
VALUES
    ('sgc-cd-3520', 'sgc-cd', '2021', '3520'),
    ('sgc-cd-3520', 'sgc-csd', '2021', '3520005')
ON CONFLICT (scheme, vintage, value) DO UPDATE SET
    place_id = EXCLUDED.place_id;

INSERT INTO place_aliases (slug, place_id)
VALUES
    ('toronto-on-3520005', 'sgc-cd-3520'),
    ('sgc-csd-3520005', 'sgc-cd-3520')
ON CONFLICT (slug) DO UPDATE SET place_id = EXCLUDED.place_id;

DELETE FROM places WHERE id = 'sgc-csd-3520005';
