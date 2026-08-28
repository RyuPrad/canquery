-- Surrey is a Statistics Canada census subdivision within the Greater
-- Vancouver census division. The ancestry already exists for Vancouver, but
-- seed it here as well so this migration remains self-contained and safe to
-- apply before a complete SGC refresh.

DELETE FROM place_aliases WHERE slug = 'surrey-bc';

INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES (
    'sgc-pr-59', 'british-columbia', 'province',
    'British Columbia', 'Colombie-Britannique',
    'Province', 'Province', 'ca', NULL, NULL, NULL, true, false
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
    'sgc-cd-5915', 'greater-vancouver-bc', 'region',
    'Greater Vancouver', 'Greater Vancouver',
    'Census division', 'Division de recensement', 'sgc-pr-59',
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
    'sgc-csd-5915004', 'surrey-bc', 'municipality',
    'Surrey', 'Surrey', 'City', 'Ville', 'sgc-cd-5915',
    49.1913, -122.8490, 10, true, true
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
    ('sgc-pr-59', 'sgc-pr', '2021', '59'),
    ('sgc-cd-5915', 'sgc-cd', '2021', '5915'),
    ('sgc-csd-5915004', 'sgc-csd', '2021', '5915004')
ON CONFLICT (scheme, vintage, value) DO UPDATE SET
    place_id = EXCLUDED.place_id;
