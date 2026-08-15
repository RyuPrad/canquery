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
    licenseRules: [
        { publisher: /city of oshawa/i, license: OSHAWA_LICENSE },
        { publisher: /(regional municipality of durham|region of durham)/i, license: DURHAM_LICENSE },
        { publisher: /(conservation ontario|central lake ontario)/i, license: CLOCA_LICENSE },
        { publisher: /(ontario|ministry of natural resources)/i, license: ONTARIO_LICENSE }
    ],
    placeRules: [
        { publisher: /city of oshawa/i, placeId: 'ca-on-oshawa', relationship: 'direct', includesDescendants: false },
        { publisher: /(regional municipality of durham|region of durham)/i, placeId: 'ca-on-durham', relationship: 'coverage', includesDescendants: true },
        { publisher: /(conservation ontario|central lake ontario)/i, placeId: 'ca-on-durham', relationship: 'coverage', includesDescendants: true },
        { publisher: /(ontario|ministry of natural resources)/i, placeId: 'ca-on', relationship: 'coverage', includesDescendants: true }
    ]
}];

function getSource(id) {
    return sources.find(source => source.id === id) || null;
}

module.exports = { sources, getSource, OSHAWA_LICENSE, DURHAM_LICENSE, CLOCA_LICENSE, ONTARIO_LICENSE };
