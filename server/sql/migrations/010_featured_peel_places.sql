-- Curated place discovery for the Peel Region launch. The complete SGC place
-- hierarchy already exists; this migration makes the region and its three
-- lower-tier municipalities first-class browse destinations.

UPDATE places
SET featured = true,
    updated_at = now()
WHERE id IN (
    'sgc-cd-3521',
    'sgc-csd-3521005',
    'sgc-csd-3521010',
    'sgc-csd-3521024'
);

UPDATE places
SET type_en = 'Regional municipality',
    type_fr = 'Municipalité régionale',
    latitude = 43.7500,
    longitude = -79.7800,
    default_zoom = 9,
    updated_at = now()
WHERE id = 'sgc-cd-3521';

UPDATE places
SET type_en = 'City',
    type_fr = 'Ville',
    latitude = 43.5890,
    longitude = -79.6440,
    default_zoom = 10,
    updated_at = now()
WHERE id = 'sgc-csd-3521005';

UPDATE places
SET type_en = 'City',
    type_fr = 'Ville',
    latitude = 43.7315,
    longitude = -79.7624,
    default_zoom = 10,
    updated_at = now()
WHERE id = 'sgc-csd-3521010';

UPDATE places
SET type_en = 'Town',
    type_fr = 'Ville',
    latitude = 43.8668,
    longitude = -79.8670,
    default_zoom = 9,
    updated_at = now()
WHERE id = 'sgc-csd-3521024';
