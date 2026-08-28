-- Halifax Regional Municipality is a Statistics Canada census subdivision
-- inside the distinct Halifax census division. Both official places share the
-- same name, so expose the municipality at the short public slug while keeping
-- its census-division parent as an unfeatured ancestry node.

-- A previous full SGC import gives the census division the unsuffixed slug and
-- the municipality a numeric suffix. Release the desired municipality slug
-- before the canonical upserts below.
UPDATE places
SET slug = 'halifax-region-ns', updated_at = now()
WHERE id = 'sgc-cd-1209' AND slug <> 'halifax-region-ns';

-- Canonical slugs must not also remain in the alias table after an earlier
-- normalization attempt.
DELETE FROM place_aliases
WHERE slug IN ('halifax-region-ns', 'halifax-ns');

INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES (
    'sgc-pr-12', 'nova-scotia', 'province',
    'Nova Scotia', 'Nouvelle-Écosse', 'Province', 'Province', 'ca',
    NULL, NULL, NULL, true, false
) ON CONFLICT (id) DO UPDATE SET
    slug = EXCLUDED.slug,
    kind = EXCLUDED.kind,
    name_en = EXCLUDED.name_en,
    name_fr = EXCLUDED.name_fr,
    type_en = EXCLUDED.type_en,
    type_fr = EXCLUDED.type_fr,
    parent_id = EXCLUDED.parent_id,
    enabled = true,
    featured = false,
    updated_at = now();

INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES (
    'sgc-cd-1209', 'halifax-region-ns', 'region',
    'Halifax', 'Halifax', 'Census division', 'Division de recensement',
    'sgc-pr-12', NULL, NULL, NULL, true, false
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
    featured = false,
    updated_at = now();

INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES (
    'sgc-csd-1209034', 'halifax-ns', 'municipality',
    'Halifax', 'Halifax', 'Regional municipality', 'Municipalité régionale',
    'sgc-cd-1209', 44.6488, -63.5752, 8, true, true
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

INSERT INTO place_identifiers (place_id, scheme, vintage, value)
VALUES
    ('sgc-pr-12', 'sgc-pr', '2021', '12'),
    ('sgc-cd-1209', 'sgc-cd', '2021', '1209'),
    ('sgc-csd-1209034', 'sgc-csd', '2021', '1209034')
ON CONFLICT (scheme, vintage, value) DO UPDATE SET
    place_id = EXCLUDED.place_id;

INSERT INTO place_aliases (slug, place_id)
VALUES ('halifax-ns-1209034', 'sgc-csd-1209034')
ON CONFLICT (slug) DO UPDATE SET place_id = EXCLUDED.place_id;
