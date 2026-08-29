-- Migration 027: Canonicalize Gatineau (QC), Trois-Rivières (QC), Repentigny (QC),
-- Longueuil (QC), Saguenay (QC), Rimouski (QC), Shawinigan (QC), Lévis (QC),
-- Sherbrooke (QC), and Saint John (NB) in the 2021 Statistics Canada hierarchy.

DELETE FROM place_aliases
WHERE slug IN (
    'gatineau-qc',
    'trois-rivieres-qc',
    'repentigny-qc',
    'longueuil-qc',
    'saguenay-qc',
    'rimouski-qc',
    'shawinigan-qc',
    'levis-qc',
    'sherbrooke-qc',
    'saint-john-nb',
    'gatineau-city-qc',
    'trois-rivieres-city-qc',
    'repentigny-city-qc',
    'longueuil-city-qc',
    'saguenay-city-qc',
    'rimouski-city-qc',
    'shawinigan-city-qc',
    'levis-city-qc',
    'sherbrooke-city-qc',
    'saint-john-city-nb'
);

-- Provinces
INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES
    ('ca-qc', 'quebec', 'province', 'Quebec', 'Québec', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false),
    ('ca-nb', 'new-brunswick', 'province', 'New Brunswick', 'Nouveau-Brunswick', 'Province', 'Province', 'ca', NULL, NULL, NULL, true, false)
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

-- Census Divisions / Regions / Counties
INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES
    ('sgc-cd-2481', 'gatineau-region-qc', 'region', 'Gatineau', 'Gatineau', 'Census division', 'Division de recensement', 'ca-qc', NULL, NULL, NULL, true, false),
    ('sgc-cd-2437', 'trois-rivieres-region-qc', 'region', 'Francheville', 'Francheville', 'Census division', 'Division de recensement', 'ca-qc', NULL, NULL, NULL, true, false),
    ('sgc-cd-2460', 'lassomption-qc', 'region', 'L’Assomption', 'L’Assomption', 'Census division', 'Division de recensement', 'ca-qc', NULL, NULL, NULL, true, false),
    ('sgc-cd-2458', 'longueuil-region-qc', 'region', 'Longueuil', 'Longueuil', 'Census division', 'Division de recensement', 'ca-qc', NULL, NULL, NULL, true, false),
    ('sgc-cd-2494', 'le-saguenay-et-son-fjord-qc', 'region', 'Le Saguenay-et-son-Fjord', 'Le Saguenay-et-son-Fjord', 'Census division', 'Division de recensement', 'ca-qc', NULL, NULL, NULL, true, false),
    ('sgc-cd-2410', 'rimouski-neigette-qc', 'region', 'Rimouski-Neigette', 'Rimouski-Neigette', 'Census division', 'Division de recensement', 'ca-qc', NULL, NULL, NULL, true, false),
    ('sgc-cd-2436', 'shawinigan-region-qc', 'region', 'Shawinigan', 'Shawinigan', 'Census division', 'Division de recensement', 'ca-qc', NULL, NULL, NULL, true, false),
    ('sgc-cd-2425', 'levis-region-qc', 'region', 'Lévis', 'Lévis', 'Census division', 'Division de recensement', 'ca-qc', NULL, NULL, NULL, true, false),
    ('sgc-cd-2443', 'sherbrooke-region-qc', 'region', 'Sherbrooke', 'Sherbrooke', 'Census division', 'Division de recensement', 'ca-qc', NULL, NULL, NULL, true, false),
    ('sgc-cd-1301', 'saint-john-county-nb', 'region', 'Saint John', 'Saint John', 'County', 'Comté', 'ca-nb', NULL, NULL, NULL, true, false)
ON CONFLICT (id) DO UPDATE SET
    slug = EXCLUDED.slug,
    kind = EXCLUDED.kind,
    name_en = EXCLUDED.name_en,
    name_fr = EXCLUDED.name_fr,
    type_en = EXCLUDED.type_en,
    type_fr = EXCLUDED.type_fr,
    parent_id = EXCLUDED.parent_id,
    enabled = true,
    featured = EXCLUDED.featured,
    updated_at = now();

-- Municipalities / Census Subdivisions
INSERT INTO places (
    id, slug, kind, name_en, name_fr, type_en, type_fr, parent_id,
    latitude, longitude, default_zoom, enabled, featured
) VALUES
    ('sgc-csd-2481017', 'gatineau-qc', 'municipality', 'Gatineau', 'Gatineau', 'City', 'Ville', 'sgc-cd-2481', 45.4765, -75.7013, 10, true, true),
    ('sgc-csd-2437067', 'trois-rivieres-qc', 'municipality', 'Trois-Rivières', 'Trois-Rivières', 'City', 'Ville', 'sgc-cd-2437', 46.3432, -72.5421, 10, true, true),
    ('sgc-csd-2460013', 'repentigny-qc', 'municipality', 'Repentigny', 'Repentigny', 'City', 'Ville', 'sgc-cd-2460', 45.7423, -73.4497, 10, true, true),
    ('sgc-csd-2458227', 'longueuil-qc', 'municipality', 'Longueuil', 'Longueuil', 'City', 'Ville', 'sgc-cd-2458', 45.5312, -73.5181, 10, true, true),
    ('sgc-csd-2494068', 'saguenay-qc', 'municipality', 'Saguenay', 'Saguenay', 'City', 'Ville', 'sgc-cd-2494', 48.4284, -71.0684, 10, true, true),
    ('sgc-csd-2410043', 'rimouski-qc', 'municipality', 'Rimouski', 'Rimouski', 'City', 'Ville', 'sgc-cd-2410', 48.4488, -68.5240, 10, true, true),
    ('sgc-csd-2436033', 'shawinigan-qc', 'municipality', 'Shawinigan', 'Shawinigan', 'City', 'Ville', 'sgc-cd-2436', 46.5667, -72.7500, 10, true, true),
    ('sgc-csd-2425213', 'levis-qc', 'municipality', 'Lévis', 'Lévis', 'City', 'Ville', 'sgc-cd-2425', 46.8033, -71.1779, 10, true, true),
    ('sgc-csd-2443027', 'sherbrooke-qc', 'municipality', 'Sherbrooke', 'Sherbrooke', 'City', 'Ville', 'sgc-cd-2443', 45.4042, -71.8929, 10, true, true),
    ('sgc-csd-1301006', 'saint-john-nb', 'municipality', 'Saint John', 'Saint John', 'City', 'Cité', 'sgc-cd-1301', 45.2733, -66.0633, 10, true, true)
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
INSERT INTO place_identifiers (place_id, scheme, identifier, is_primary) VALUES
    ('sgc-cd-2481', 'sgc-cd', '2481', true),
    ('sgc-cd-2437', 'sgc-cd', '2437', true),
    ('sgc-cd-2460', 'sgc-cd', '2460', true),
    ('sgc-cd-2458', 'sgc-cd', '2458', true),
    ('sgc-cd-2494', 'sgc-cd', '2494', true),
    ('sgc-cd-2410', 'sgc-cd', '2410', true),
    ('sgc-cd-2436', 'sgc-cd', '2436', true),
    ('sgc-cd-2425', 'sgc-cd', '2425', true),
    ('sgc-cd-2443', 'sgc-cd', '2443', true),
    ('sgc-cd-1301', 'sgc-cd', '1301', true),
    ('sgc-csd-2481017', 'sgc-csd', '2481017', true),
    ('sgc-csd-2437067', 'sgc-csd', '2437067', true),
    ('sgc-csd-2460013', 'sgc-csd', '2460013', true),
    ('sgc-csd-2458227', 'sgc-csd', '2458227', true),
    ('sgc-csd-2494068', 'sgc-csd', '2494068', true),
    ('sgc-csd-2410043', 'sgc-csd', '2410043', true),
    ('sgc-csd-2436033', 'sgc-csd', '2436033', true),
    ('sgc-csd-2425213', 'sgc-csd', '2425213', true),
    ('sgc-csd-2443027', 'sgc-csd', '2443027', true),
    ('sgc-csd-1301006', 'sgc-csd', '1301006', true)
ON CONFLICT (scheme, identifier) DO UPDATE SET
    place_id = EXCLUDED.place_id,
    is_primary = EXCLUDED.is_primary,
    updated_at = now();

-- Aliases
INSERT INTO place_aliases (place_id, slug, kind) VALUES
    ('sgc-csd-2481017', 'gatineau-city-qc', 'legacy'),
    ('sgc-csd-2437067', 'trois-rivieres-city-qc', 'legacy'),
    ('sgc-csd-2460013', 'repentigny-city-qc', 'legacy'),
    ('sgc-csd-2458227', 'longueuil-city-qc', 'legacy'),
    ('sgc-csd-2494068', 'saguenay-city-qc', 'legacy'),
    ('sgc-csd-2410043', 'rimouski-city-qc', 'legacy'),
    ('sgc-csd-2436033', 'shawinigan-city-qc', 'legacy'),
    ('sgc-csd-2425213', 'levis-city-qc', 'legacy'),
    ('sgc-csd-2443027', 'sherbrooke-city-qc', 'legacy'),
    ('sgc-csd-1301006', 'saint-john-city-nb', 'legacy'),
    ('sgc-csd-1301006', 'saint-john-city', 'legacy'),
    ('sgc-cd-1301', 'saint-john-nb-1301', 'legacy')
ON CONFLICT (slug) DO UPDATE SET
    place_id = EXCLUDED.place_id,
    kind = EXCLUDED.kind,
    updated_at = now();
