-- Curated place discovery for the Durham Region launch. All SGC places remain
-- searchable; `featured` controls the small, intentional set shown before a
-- user searches.

ALTER TABLE places
    ADD COLUMN IF NOT EXISTS featured boolean NOT NULL DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_places_featured_name
    ON places(kind, name_en) WHERE featured AND enabled;

UPDATE places
SET featured = id IN (
        'ca-on-durham',
        'sgc-csd-3518005',
        'sgc-csd-3518039',
        'sgc-csd-3518017',
        'ca-on-oshawa',
        'sgc-csd-3518001',
        'sgc-csd-3518020',
        'sgc-csd-3518029',
        'sgc-csd-3518009'
    ),
    updated_at = now()
WHERE featured
   OR id IN (
        'ca-on-durham',
        'sgc-csd-3518005',
        'sgc-csd-3518039',
        'sgc-csd-3518017',
        'ca-on-oshawa',
        'sgc-csd-3518001',
        'sgc-csd-3518020',
        'sgc-csd-3518029',
        'sgc-csd-3518009'
    );

UPDATE places SET type_en = 'Regional municipality', type_fr = 'Municipalité régionale'
WHERE id = 'ca-on-durham';
UPDATE places SET type_en = 'Town', type_fr = 'Ville'
WHERE id IN ('sgc-csd-3518005', 'sgc-csd-3518009');
UPDATE places SET type_en = 'Township', type_fr = 'Canton'
WHERE id IN ('sgc-csd-3518039', 'sgc-csd-3518020', 'sgc-csd-3518029');
UPDATE places SET type_en = 'Municipality', type_fr = 'Municipalité'
WHERE id = 'sgc-csd-3518017';
UPDATE places SET type_en = 'City', type_fr = 'Ville'
WHERE id IN ('ca-on-oshawa', 'sgc-csd-3518001');
