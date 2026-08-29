-- Canonicalize York Region cluster, Niagara Region cluster, Moncton, Guelph,
-- Saanich, and Belleville in the 2021 Statistics Canada hierarchy.

DELETE FROM place_aliases
WHERE slug IN (
    'york-region-on',
    'markham-on',
    'newmarket-on',
    'vaughan-on',
    'richmond-hill-on',
    'aurora-on',
    'whitchurch-stouffville-on',
    'king-on',
    'east-gwillimbury-on',
    'georgina-on',
    'niagara-region-on',
    'niagara-falls-on',
    'welland-on',
    'st-catharines-on',
    'fort-erie-on',
    'port-colborne-on',
    'thorold-on',
    'niagara-on-the-lake-on',
    'lincoln-on',
    'grimsby-on',
    'pelham-on',
    'west-lincoln-on',
    'wainfleet-on',
    'moncton-nb',
    'guelph-on',
    'saanich-bc',
    'belleville-on',
    'york-on',
    'niagara-on',
    'york-region-on-3519',
    'niagara-region-on-3526'
);

-- Provinces
INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES
    ('ca-on', 'ontario', 'province', 'Ontario', 'Ontario', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false),
    ('sgc-pr-13', 'new-brunswick', 'province', 'New Brunswick', 'Nouveau-Brunswick', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false),
    ('sgc-pr-59', 'british-columbia', 'province', 'British Columbia', 'Colombie-Britannique', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false)
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
    ('sgc-cd-3519', 'york-region-on', 'region', 'York', 'York', 'Regional municipality', 'Municipalité régionale', 'ca-on', 44.0000, -79.4667, 9, true, true),
    ('sgc-cd-3526', 'niagara-region-on', 'region', 'Niagara', 'Niagara', 'Regional municipality', 'Municipalité régionale', 'ca-on', 43.0600, -79.3100, 9, true, true),
    ('sgc-cd-1307', 'westmorland-nb', 'region', 'Westmorland', 'Westmorland', 'Census division', 'Division de recensement', 'sgc-pr-13', NULL, NULL, NULL, true, false),
    ('sgc-cd-3523', 'wellington-on', 'region', 'Wellington', 'Wellington', 'County', 'Comté', 'ca-on', NULL, NULL, NULL, true, false),
    ('sgc-cd-3512', 'hastings-on', 'region', 'Hastings', 'Hastings', 'County', 'Comté', 'ca-on', NULL, NULL, NULL, true, false),
    ('sgc-cd-5917', 'capital-bc', 'region', 'Capital', 'Capital', 'Regional district', 'District régional', 'sgc-pr-59', NULL, NULL, NULL, true, false)
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
UPDATE places
SET slug = 'moncton-parish-nb', type_en = 'Parish', type_fr = 'Paroisse', updated_at = now()
WHERE id = 'sgc-csd-1307019';

INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES
    -- York Region Lower-Tier Municipalities
    ('sgc-csd-3519036', 'markham-on', 'municipality', 'Markham', 'Markham', 'City', 'Ville', 'sgc-cd-3519', 43.8561, -79.3370, 10, true, true),
    ('sgc-csd-3519048', 'newmarket-on', 'municipality', 'Newmarket', 'Newmarket', 'Town', 'Ville', 'sgc-cd-3519', 44.0592, -79.4613, 10, true, true),
    ('sgc-csd-3519028', 'vaughan-on', 'municipality', 'Vaughan', 'Vaughan', 'City', 'Ville', 'sgc-cd-3519', 43.8563, -79.5085, 10, true, true),
    ('sgc-csd-3519038', 'richmond-hill-on', 'municipality', 'Richmond Hill', 'Richmond Hill', 'City', 'Ville', 'sgc-cd-3519', 43.8828, -79.4403, 10, true, true),
    ('sgc-csd-3519046', 'aurora-on', 'municipality', 'Aurora', 'Aurora', 'Town', 'Ville', 'sgc-cd-3519', 44.0000, -79.4667, 10, true, true),
    ('sgc-csd-3519044', 'whitchurch-stouffville-on', 'municipality', 'Whitchurch-Stouffville', 'Whitchurch-Stouffville', 'Town', 'Ville', 'sgc-cd-3519', 43.9708, -79.2514, 9, true, true),
    ('sgc-csd-3519049', 'king-on', 'municipality', 'King', 'King', 'Township', 'Canton', 'sgc-cd-3519', 43.9500, -79.5833, 9, true, true),
    ('sgc-csd-3519054', 'east-gwillimbury-on', 'municipality', 'East Gwillimbury', 'East Gwillimbury', 'Town', 'Ville', 'sgc-cd-3519', 44.1333, -79.4500, 9, true, true),
    ('sgc-csd-3519070', 'georgina-on', 'municipality', 'Georgina', 'Georgina', 'Town', 'Ville', 'sgc-cd-3519', 44.3000, -79.4333, 9, true, true),

    -- Niagara Region Lower-Tier Municipalities
    ('sgc-csd-3526043', 'niagara-falls-on', 'municipality', 'Niagara Falls', 'Niagara Falls', 'City', 'Ville', 'sgc-cd-3526', 43.0896, -79.0849, 10, true, true),
    ('sgc-csd-3526032', 'welland-on', 'municipality', 'Welland', 'Welland', 'City', 'Ville', 'sgc-cd-3526', 42.9922, -79.2483, 10, true, true),
    ('sgc-csd-3526053', 'st-catharines-on', 'municipality', 'St. Catharines', 'St. Catharines', 'City', 'Ville', 'sgc-cd-3526', 43.1594, -79.2469, 10, true, true),
    ('sgc-csd-3526003', 'fort-erie-on', 'municipality', 'Fort Erie', 'Fort Erie', 'Town', 'Ville', 'sgc-cd-3526', 42.9000, -78.9333, 9, true, true),
    ('sgc-csd-3526011', 'port-colborne-on', 'municipality', 'Port Colborne', 'Port Colborne', 'City', 'Ville', 'sgc-cd-3526', 42.8833, -79.2500, 10, true, true),
    ('sgc-csd-3526037', 'thorold-on', 'municipality', 'Thorold', 'Thorold', 'City', 'Ville', 'sgc-cd-3526', 43.1167, -79.2000, 10, true, true),
    ('sgc-csd-3526047', 'niagara-on-the-lake-on', 'municipality', 'Niagara-on-the-Lake', 'Niagara-on-the-Lake', 'Town', 'Ville', 'sgc-cd-3526', 43.2553, -79.0772, 10, true, true),
    ('sgc-csd-3526057', 'lincoln-on', 'municipality', 'Lincoln', 'Lincoln', 'Town', 'Ville', 'sgc-cd-3526', 43.1667, -79.4333, 9, true, true),
    ('sgc-csd-3526065', 'grimsby-on', 'municipality', 'Grimsby', 'Grimsby', 'Town', 'Ville', 'sgc-cd-3526', 43.1931, -79.5600, 10, true, true),
    ('sgc-csd-3526028', 'pelham-on', 'municipality', 'Pelham', 'Pelham', 'Town', 'Ville', 'sgc-cd-3526', 43.0500, -79.3333, 9, true, true),
    ('sgc-csd-3526021', 'west-lincoln-on', 'municipality', 'West Lincoln', 'West Lincoln', 'Township', 'Canton', 'sgc-cd-3526', 43.0833, -79.5667, 9, true, true),
    ('sgc-csd-3526014', 'wainfleet-on', 'municipality', 'Wainfleet', 'Wainfleet', 'Township', 'Canton', 'sgc-cd-3526', 42.9167, -79.3667, 9, true, true),

    -- Municipal Anchors
    ('sgc-csd-1307022', 'moncton-nb', 'municipality', 'Moncton', 'Moncton', 'City', 'Cité', 'sgc-cd-1307', 46.0878, -64.7782, 10, true, true),
    ('sgc-csd-3523008', 'guelph-on', 'municipality', 'Guelph', 'Guelph', 'City', 'Ville', 'sgc-cd-3523', 43.5448, -80.2482, 10, true, true),
    ('sgc-csd-5917021', 'saanich-bc', 'municipality', 'Saanich', 'Saanich', 'District municipality', 'Municipalité de district', 'sgc-cd-5917', 48.4841, -123.3822, 10, true, true),
    ('sgc-csd-3512005', 'belleville-on', 'municipality', 'Belleville', 'Belleville', 'City', 'Ville', 'sgc-cd-3512', 44.1628, -77.3832, 10, true, true)
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
    ('sgc-cd-3519', 'sgc-cd', '2021', '3519'),
    ('sgc-cd-3526', 'sgc-cd', '2021', '3526'),
    ('sgc-cd-1307', 'sgc-cd', '2021', '1307'),
    ('sgc-cd-3523', 'sgc-cd', '2021', '3523'),
    ('sgc-cd-3512', 'sgc-cd', '2021', '3512'),
    ('sgc-cd-5917', 'sgc-cd', '2021', '5917'),
    ('sgc-csd-3519036', 'sgc-csd', '2021', '3519036'),
    ('sgc-csd-3519048', 'sgc-csd', '2021', '3519048'),
    ('sgc-csd-3519028', 'sgc-csd', '2021', '3519028'),
    ('sgc-csd-3519038', 'sgc-csd', '2021', '3519038'),
    ('sgc-csd-3519046', 'sgc-csd', '2021', '3519046'),
    ('sgc-csd-3519044', 'sgc-csd', '2021', '3519044'),
    ('sgc-csd-3519049', 'sgc-csd', '2021', '3519049'),
    ('sgc-csd-3519054', 'sgc-csd', '2021', '3519054'),
    ('sgc-csd-3519070', 'sgc-csd', '2021', '3519070'),
    ('sgc-csd-3526043', 'sgc-csd', '2021', '3526043'),
    ('sgc-csd-3526032', 'sgc-csd', '2021', '3526032'),
    ('sgc-csd-3526053', 'sgc-csd', '2021', '3526053'),
    ('sgc-csd-3526003', 'sgc-csd', '2021', '3526003'),
    ('sgc-csd-3526011', 'sgc-csd', '2021', '3526011'),
    ('sgc-csd-3526037', 'sgc-csd', '2021', '3526037'),
    ('sgc-csd-3526047', 'sgc-csd', '2021', '3526047'),
    ('sgc-csd-3526057', 'sgc-csd', '2021', '3526057'),
    ('sgc-csd-3526065', 'sgc-csd', '2021', '3526065'),
    ('sgc-csd-3526028', 'sgc-csd', '2021', '3526028'),
    ('sgc-csd-3526021', 'sgc-csd', '2021', '3526021'),
    ('sgc-csd-3526014', 'sgc-csd', '2021', '3526014'),
    ('sgc-csd-1307022', 'sgc-csd', '2021', '1307022'),
    ('sgc-csd-3523008', 'sgc-csd', '2021', '3523008'),
    ('sgc-csd-5917021', 'sgc-csd', '2021', '5917021'),
    ('sgc-csd-3512005', 'sgc-csd', '2021', '3512005')
ON CONFLICT (scheme, vintage, value) DO UPDATE SET
    place_id = EXCLUDED.place_id;

-- Durable Aliases
INSERT INTO place_aliases (slug, place_id)
VALUES
    ('york-on', 'sgc-cd-3519'),
    ('york-region-on-3519', 'sgc-cd-3519'),
    ('niagara-on', 'sgc-cd-3526'),
    ('niagara-region-on-3526', 'sgc-cd-3526')
ON CONFLICT (slug) DO UPDATE SET place_id = EXCLUDED.place_id;
