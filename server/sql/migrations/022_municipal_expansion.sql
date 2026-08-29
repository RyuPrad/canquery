-- Canonicalize Victoria, Waterloo Region cluster, London, Kelowna, and Fredericton
-- in the 2021 Statistics Canada hierarchy.

DELETE FROM place_aliases
WHERE slug IN (
    'victoria-bc',
    'waterloo-region-on',
    'waterloo-on',
    'kitchener-on',
    'cambridge-on',
    'woolwich-on',
    'wilmot-on',
    'wellesley-on',
    'north-dumfries-on',
    'london-on',
    'kelowna-bc',
    'fredericton-nb',
    'waterloo-on-3530016',
    'waterloo-region-on-3530'
);

-- Provinces
INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES
    ('sgc-pr-59', 'british-columbia', 'province', 'British Columbia', 'Colombie-Britannique', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false),
    ('ca-on', 'ontario', 'province', 'Ontario', 'Ontario', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false),
    ('sgc-pr-13', 'new-brunswick', 'province', 'New Brunswick', 'Nouveau-Brunswick', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false)
ON CONFLICT (id) DO UPDATE SET
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

-- Census Divisions / Regions
INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES
    ('sgc-cd-5917', 'capital-bc', 'region', 'Capital', 'Capital', 'Census division', 'Division de recensement', 'sgc-pr-59', NULL, NULL, NULL, true, false),
    ('sgc-cd-3530', 'waterloo-region-on', 'region', 'Waterloo', 'Waterloo', 'Regional municipality', 'Municipalité régionale', 'ca-on', 43.4643, -80.5204, 9, true, true),
    ('sgc-cd-3539', 'middlesex-on', 'region', 'Middlesex', 'Middlesex', 'Census division', 'Division de recensement', 'ca-on', NULL, NULL, NULL, true, false),
    ('sgc-cd-5935', 'central-okanagan-bc', 'region', 'Central Okanagan', 'Central Okanagan', 'Census division', 'Division de recensement', 'sgc-pr-59', NULL, NULL, NULL, true, false),
    ('sgc-cd-1310', 'york-nb', 'region', 'York', 'York', 'Census division', 'Division de recensement', 'sgc-pr-13', NULL, NULL, NULL, true, false)
ON CONFLICT (id) DO UPDATE SET
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
    featured = EXCLUDED.featured,
    updated_at = now();

-- Municipalities
INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES
    ('sgc-csd-5917034', 'victoria-bc', 'municipality', 'Victoria', 'Victoria', 'City', 'Ville', 'sgc-cd-5917', 48.4284, -123.3656, 10, true, true),
    ('sgc-csd-3530013', 'kitchener-on', 'municipality', 'Kitchener', 'Kitchener', 'City', 'Ville', 'sgc-cd-3530', 43.4516, -80.4925, 10, true, true),
    ('sgc-csd-3530016', 'waterloo-on', 'municipality', 'Waterloo', 'Waterloo', 'City', 'Ville', 'sgc-cd-3530', 43.4643, -80.5204, 10, true, true),
    ('sgc-csd-3530010', 'cambridge-on', 'municipality', 'Cambridge', 'Cambridge', 'City', 'Ville', 'sgc-cd-3530', 43.3616, -80.3144, 10, true, true),
    ('sgc-csd-3530035', 'woolwich-on', 'municipality', 'Woolwich', 'Woolwich', 'Township', 'Canton', 'sgc-cd-3530', 43.5650, -80.5500, 9, true, true),
    ('sgc-csd-3530020', 'wilmot-on', 'municipality', 'Wilmot', 'Wilmot', 'Township', 'Canton', 'sgc-cd-3530', 43.4000, -80.6500, 9, true, true),
    ('sgc-csd-3530027', 'wellesley-on', 'municipality', 'Wellesley', 'Wellesley', 'Township', 'Canton', 'sgc-cd-3530', 43.5500, -80.7667, 9, true, true),
    ('sgc-csd-3530004', 'north-dumfries-on', 'municipality', 'North Dumfries', 'North Dumfries', 'Township', 'Canton', 'sgc-cd-3530', 43.3000, -80.3833, 9, true, true),
    ('sgc-csd-3539036', 'london-on', 'municipality', 'London', 'London', 'City', 'Ville', 'sgc-cd-3539', 42.9849, -81.2453, 9, true, true),
    ('sgc-csd-5935010', 'kelowna-bc', 'municipality', 'Kelowna', 'Kelowna', 'City', 'Ville', 'sgc-cd-5935', 49.8880, -119.4960, 10, true, true),
    ('sgc-csd-1310032', 'fredericton-nb', 'municipality', 'Fredericton', 'Fredericton', 'City', 'Ville', 'sgc-cd-1310', 45.9636, -66.6431, 10, true, true)
ON CONFLICT (id) DO UPDATE SET
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
    featured = EXCLUDED.featured,
    updated_at = now();

-- Identifiers
INSERT INTO place_identifiers (place_id, scheme, vintage, value)
VALUES
    ('sgc-pr-59', 'sgc-pr', '2021', '59'),
    ('ca-on', 'sgc-pr', '2021', '35'),
    ('sgc-pr-13', 'sgc-pr', '2021', '13'),
    ('sgc-cd-5917', 'sgc-cd', '2021', '5917'),
    ('sgc-cd-3530', 'sgc-cd', '2021', '3530'),
    ('sgc-cd-3539', 'sgc-cd', '2021', '3539'),
    ('sgc-cd-5935', 'sgc-cd', '2021', '5935'),
    ('sgc-cd-1310', 'sgc-cd', '2021', '1310'),
    ('sgc-csd-5917034', 'sgc-csd', '2021', '5917034'),
    ('sgc-csd-3530013', 'sgc-csd', '2021', '3530013'),
    ('sgc-csd-3530016', 'sgc-csd', '2021', '3530016'),
    ('sgc-csd-3530010', 'sgc-csd', '2021', '3530010'),
    ('sgc-csd-3530035', 'sgc-csd', '2021', '3530035'),
    ('sgc-csd-3530020', 'sgc-csd', '2021', '3530020'),
    ('sgc-csd-3530027', 'sgc-csd', '2021', '3530027'),
    ('sgc-csd-3530004', 'sgc-csd', '2021', '3530004'),
    ('sgc-csd-3539036', 'sgc-csd', '2021', '3539036'),
    ('sgc-csd-5935010', 'sgc-csd', '2021', '5935010'),
    ('sgc-csd-1310032', 'sgc-csd', '2021', '1310032')
ON CONFLICT (scheme, vintage, value) DO UPDATE SET
    place_id = EXCLUDED.place_id;

-- Durable Aliases
INSERT INTO place_aliases (slug, place_id)
VALUES
    ('waterloo-on-3530016', 'sgc-csd-3530016'),
    ('waterloo-region-on-3530', 'sgc-cd-3530')
ON CONFLICT (slug) DO UPDATE SET place_id = EXCLUDED.place_id;
