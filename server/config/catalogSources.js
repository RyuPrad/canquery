const OSHAWA_LICENSE = {
    titleEn: 'Open Government Licence – The Corporation of the City of Oshawa',
    titleFr: 'Licence du gouvernement ouvert – The Corporation of the City of Oshawa',
    url: 'https://map.oshawa.ca/OpenData/Open%20Government%20Licence%20version%202.0%20-%20Oshawa.pdf',
    attributionEn: 'Contains information licensed under the Open Government Licence – The Corporation of the City of Oshawa.',
    attributionFr: 'Contient des renseignements visés par la Licence du gouvernement ouvert – The Corporation of the City of Oshawa.'
};

const DURHAM_LICENSE = {
    titleEn: 'Region of Durham Open Data Licence v1.0',
    titleFr: 'Licence de données ouvertes de la région de Durham v1.0',
    url: 'https://www.durham.ca/regional-government/access-to-information/open-data/',
    attributionEn: "Contains public sector information made available under The Regional Municipality of Durham's Open Data Licence.",
    attributionFr: "Contient des renseignements du secteur public fournis selon la licence de données ouvertes de la municipalité régionale de Durham."
};

const AJAX_LICENSE = {
    titleEn: 'Town of Ajax Open Data Licence',
    titleFr: 'Licence de données ouvertes de la Ville d’Ajax',
    url: 'https://townofajax.maps.arcgis.com/sharing/rest/content/items/22e2d8e248724d7cb0310dc2db675abd/data',
    attributionEn: 'Contains information made available under the Town of Ajax Open Data Licence.',
    attributionFr: 'Contient des renseignements fournis selon la licence de données ouvertes de la Ville d’Ajax.'
};

const PICKERING_LICENSE = {
    titleEn: 'City of Pickering Open Data Licence v1.0',
    titleFr: 'Licence de données ouvertes de la Ville de Pickering v1.0',
    url: 'https://www.pickering.ca/media/depbgebg/opendatalicencepickeringv1_acc.pdf',
    attributionEn: 'Contains information made available under the City of Pickering Open Data Licence.',
    attributionFr: 'Contient des renseignements fournis selon la licence de données ouvertes de la Ville de Pickering.'
};

const WHITBY_LICENSE = {
    titleEn: 'The Corporation of the Town of Whitby Open Government Licence',
    titleFr: 'Licence du gouvernement ouvert de la Corporation de la Ville de Whitby',
    url: 'https://whitby.maps.arcgis.com/sharing/rest/content/items/223810efc31c40b3aff99dd74f809a97/data',
    attributionEn: 'Contains information licensed under The Corporation of the Town of Whitby Open Government Licence.',
    attributionFr: 'Contient des renseignements visés par la Licence du gouvernement ouvert de la Corporation de la Ville de Whitby.'
};

const CLOCA_LICENSE = {
    titleEn: 'CLOCA Open Data Licence v1',
    titleFr: 'Licence de données ouvertes de la CLOCA v1',
    url: 'https://www.arcgis.com/home/item.html?id=20586dab57ce40fd9b102d97c144302c',
    attributionEn: 'Contains information made available under the CLOCA Open Data Licence v1.',
    attributionFr: 'Contient des renseignements fournis selon la licence de données ouvertes de la CLOCA v1.'
};

const ONTARIO_LICENSE = {
    titleEn: 'Open Government Licence – Ontario',
    titleFr: 'Licence du gouvernement ouvert – Ontario',
    url: 'https://www.ontario.ca/page/open-government-licence-ontario',
    attributionEn: 'Contains information licensed under the Open Government Licence – Ontario.',
    attributionFr: 'Contient des renseignements visés par la Licence du gouvernement ouvert – Ontario.'
};

const DURHAM_PUBLISHER = /(regional municipality of durham|region of durham)/i;
const ONTARIO_PUBLISHER = /(ontario|ministry of natural resources|aviation, forest fire)/i;
const CONSERVATION_PUBLISHER = /(conservation ontario|central lake ontario)/i;

const regionalRules = {
    licenseRules: [
        { publisher: DURHAM_PUBLISHER, license: DURHAM_LICENSE },
        { publisher: /township of (brock|scugog|uxbridge)/i, license: DURHAM_LICENSE },
        { publisher: CONSERVATION_PUBLISHER, license: CLOCA_LICENSE },
        { publisher: ONTARIO_PUBLISHER, license: ONTARIO_LICENSE }
    ],
    placeRules: [
        { publisher: DURHAM_PUBLISHER, placeId: 'ca-on-durham', relationship: 'coverage', includesDescendants: true },
        { publisher: CONSERVATION_PUBLISHER, placeId: 'ca-on-durham', relationship: 'coverage', includesDescendants: true },
        { publisher: ONTARIO_PUBLISHER, placeId: 'ca-on', relationship: 'coverage', includesDescendants: true }
    ]
};

// Daily sync order is intentional. Municipal/syndicating portals run first and
// the Durham portal runs last, so a shared ArcGIS item keeps the authoritative
// regional copy of its catalogue metadata while retaining every provenance row.
const sources = [{
    id: 'oshawa-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Oshawa Open Data Hub',
    nameFr: 'Portail de données ouvertes de la Ville d’Oshawa',
    homepageUrl: 'https://city-oshawa.opendata.arcgis.com/',
    catalogUrl: 'https://city-oshawa.opendata.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'city-oshawa.opendata.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^(the corporation of the )?city of oshawa$/i, name: 'City of Oshawa' },
        { publisher: DURHAM_PUBLISHER, name: 'Regional Municipality of Durham' }
    ],
    authoritativePublishers: [{ publisher: /city of oshawa/i }],
    licenseRules: [
        { publisher: /city of oshawa/i, license: OSHAWA_LICENSE },
        ...regionalRules.licenseRules
    ],
    placeRules: [
        { publisher: /city of oshawa/i, placeId: 'ca-on-oshawa', relationship: 'direct', includesDescendants: false },
        ...regionalRules.placeRules
    ]
}, {
    id: 'ajax-hub',
    kind: 'arcgis-hub',
    nameEn: 'Town of Ajax Open Data Portal',
    nameFr: 'Portail de données ouvertes de la Ville d’Ajax',
    homepageUrl: 'https://opendata.ajax.ca/',
    catalogUrl: 'https://opendata.ajax.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'opendata.ajax.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^(the corporation of the )?town of ajax$/i, name: 'Town of Ajax' }
    ],
    authoritativePublishers: [{ publisher: /town of ajax/i }],
    licenseRules: [{ publisher: /town of ajax/i, license: AJAX_LICENSE }],
    placeRules: [{
        publisher: /town of ajax/i,
        placeId: 'sgc-csd-3518005',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'pickering-hub',
    kind: 'arcgis-hub',
    nameEn: 'City of Pickering Open Data Portal',
    nameFr: 'Portail de données ouvertes de la Ville de Pickering',
    homepageUrl: 'https://opendata.pickering.ca/',
    catalogUrl: 'https://opendata.pickering.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'opendata.pickering.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: /^(the )?city of pickering$/i, name: 'City of Pickering' },
        { publisher: /^opendata_cityofpickering$/i, name: 'City of Pickering' },
        { publisher: DURHAM_PUBLISHER, name: 'Regional Municipality of Durham' }
    ],
    authoritativePublishers: [{ publisher: /city of pickering/i }],
    licenseRules: [
        { publisher: /city of pickering/i, license: PICKERING_LICENSE },
        ...regionalRules.licenseRules
    ],
    placeRules: [
        {
            publisher: /city of pickering/i,
            placeId: 'sgc-csd-3518001',
            relationship: 'direct',
            includesDescendants: false
        },
        ...regionalRules.placeRules
    ]
}, {
    id: 'whitby-hub',
    kind: 'arcgis-hub',
    nameEn: 'Town of Whitby GeoHub',
    nameFr: 'Géoportail de la Ville de Whitby',
    homepageUrl: 'https://geohub-whitby.hub.arcgis.com/',
    catalogUrl: 'https://geohub-whitby.hub.arcgis.com/api/feed/dcat-us/1.1.json',
    upstreamHost: 'geohub-whitby.hub.arcgis.com',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    licenseMode: 'record-explicit',
    restrictedLicensePatterns: [/personal,?\s+non-commercial/i],
    publisherAliases: [
        { publisher: /^(the corporation of the )?town of whitby$/i, name: 'Town of Whitby' }
    ],
    authoritativePublishers: [{ publisher: /town of whitby/i }],
    licenseRules: [{
        publisher: /town of whitby/i,
        licensePattern: /(223810efc31c40b3aff99dd74f809a97|open government licen[cs]e)/i,
        license: WHITBY_LICENSE
    }],
    placeRules: [{
        publisher: /town of whitby/i,
        placeId: 'sgc-csd-3518009',
        relationship: 'direct',
        includesDescendants: false
    }]
}, {
    id: 'durham-hub',
    kind: 'arcgis-hub',
    nameEn: 'Regional Municipality of Durham Open Data',
    nameFr: 'Données ouvertes de la municipalité régionale de Durham',
    homepageUrl: 'https://opendata.durham.ca/',
    catalogUrl: 'https://opendata.durham.ca/api/feed/dcat-us/1.1.json',
    upstreamHost: 'opendata.durham.ca',
    enabled: true,
    syncIntervalHours: 24,
    maxDeleteFraction: 0.1,
    publisherAliases: [
        { publisher: DURHAM_PUBLISHER, name: 'Regional Municipality of Durham' }
    ],
    authoritativePublishers: [
        { publisher: DURHAM_PUBLISHER },
        { publisher: /township of (brock|scugog|uxbridge)/i }
    ],
    licenseRules: regionalRules.licenseRules,
    placeRules: [
        { publisher: DURHAM_PUBLISHER, placeId: 'ca-on-durham', relationship: 'direct', includesDescendants: true },
        {
            publisher: /township of brock/i,
            placeId: 'sgc-csd-3518039',
            relationship: 'direct',
            includesDescendants: false
        },
        {
            publisher: /township of scugog/i,
            placeId: 'sgc-csd-3518020',
            relationship: 'direct',
            includesDescendants: false
        },
        {
            publisher: /township of uxbridge/i,
            placeId: 'sgc-csd-3518029',
            relationship: 'direct',
            includesDescendants: false
        },
        { publisher: ONTARIO_PUBLISHER, placeId: 'ca-on', relationship: 'coverage', includesDescendants: true }
    ]
}];

function getSource(id) {
    return sources.find(source => source.id === id) || null;
}

module.exports = {
    sources,
    getSource,
    OSHAWA_LICENSE,
    DURHAM_LICENSE,
    AJAX_LICENSE,
    PICKERING_LICENSE,
    WHITBY_LICENSE,
    CLOCA_LICENSE,
    ONTARIO_LICENSE
};
