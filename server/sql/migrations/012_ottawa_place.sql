-- Ottawa is simultaneously a Statistics Canada census division and a census
-- subdivision. CanQuery exposes one stable city entry and keeps both official
-- identifiers, plus the former subdivision URL/id, as aliases.

UPDATE places
SET slug = 'ottawa-on-3506008', updated_at = now()
WHERE id = 'sgc-csd-3506008' AND slug = 'ottawa-on';

INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES (
    'sgc-cd-3506', 'ottawa-on', 'municipality', 'Ottawa', 'Ottawa',
    'City', 'Ville', 'ca-on', 45.4215, -75.6972, 9, true, true
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

-- Merge links created by an earlier SGC import before deleting the duplicate
-- subdivision place. Insert first so overlapping links remain harmless.
INSERT INTO dataset_places (
    source_id, dataset_id, place_id, relationship,
    includes_descendants, assignment_method
)
SELECT source_id, dataset_id, 'sgc-cd-3506', relationship,
       includes_descendants, assignment_method
FROM dataset_places
WHERE place_id = 'sgc-csd-3506008'
ON CONFLICT (source_id, dataset_id, place_id, relationship) DO UPDATE SET
    includes_descendants = EXCLUDED.includes_descendants,
    assignment_method = EXCLUDED.assignment_method;

DELETE FROM dataset_places WHERE place_id = 'sgc-csd-3506008';
UPDATE organizations SET place_id = 'sgc-cd-3506'
WHERE place_id = 'sgc-csd-3506008';
DELETE FROM place_identifiers WHERE place_id = 'sgc-csd-3506008';

INSERT INTO place_identifiers (place_id, scheme, vintage, value)
VALUES
    ('sgc-cd-3506', 'sgc-cd', '2021', '3506'),
    ('sgc-cd-3506', 'sgc-csd', '2021', '3506008')
ON CONFLICT (scheme, vintage, value) DO UPDATE SET
    place_id = EXCLUDED.place_id;

INSERT INTO place_aliases (slug, place_id)
VALUES
    ('ottawa-on-3506008', 'sgc-cd-3506'),
    ('sgc-csd-3506008', 'sgc-cd-3506')
ON CONFLICT (slug) DO UPDATE SET place_id = EXCLUDED.place_id;

DELETE FROM places WHERE id = 'sgc-csd-3506008';
