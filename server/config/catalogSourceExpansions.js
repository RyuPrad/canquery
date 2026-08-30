'use strict';

const DONNEES_QUEBEC_ACTION = 'https://www.donneesquebec.ca/recherche/api/3/action';
const DONNEES_QUEBEC_DATASET = 'https://www.donneesquebec.ca/recherche/dataset';
const DEFAULT_RESTRICTED_LICENSE_PATTERNS = [
    /non.?commercial/i,
    /personal use only/i,
    /by-nc/i
];

function portalLicense(titleEn, titleFr, url, attributionNameEn, attributionNameFr) {
    return {
        titleEn,
        titleFr,
        url,
        attributionEn: 'Contains information licensed under ' + attributionNameEn + '.',
        attributionFr: 'Contient des renseignements visés par ' + attributionNameFr + '.'
    };
}

const EXPANSION_LICENSES = {
    SAINT_JOHN_LICENSE: portalLicense(
        'Open Government Licence – City of Saint John',
        'Licence du gouvernement ouvert – Ville de Saint John',
        'https://catalogue-saintjohn.opendata.arcgis.com/pages/open-government-licence-city-of-saint-john',
        'the Open Government Licence – City of Saint John',
        'la Licence du gouvernement ouvert – Ville de Saint John'
    ),
    // Intentionally null until the municipalities publish verifiable licence
    // evidence for a machine-readable catalogue. Their configs remain disabled.
    WHITEHORSE_LICENSE: null,
    ST_JOHNS_LICENSE: null,
    CHARLOTTETOWN_LICENSE: null,
    REGINA_LICENSE: portalLicense(
        'Open Government Licence – City of Regina',
        'Licence du gouvernement ouvert – Ville de Regina',
        'https://www.regina.ca/city-government/open-data/open-government-licence/index.html',
        'the Open Government Licence – City of Regina',
        'la Licence du gouvernement ouvert – Ville de Regina'
    ),
    WINDSOR_LICENSE: portalLicense(
        'City of Windsor Open Data Licence',
        'Licence de données ouvertes de la Ville de Windsor',
        'https://opendata.citywindsor.ca/Documents/OpenDataTermsofUse.pdf',
        'the City of Windsor Open Data Licence',
        'la Licence de données ouvertes de la Ville de Windsor'
    ),
    KINGSTON_LICENSE: portalLicense(
        'City of Kingston Open Data Licence',
        'Licence de données ouvertes de la Ville de Kingston',
        'https://www.cityofkingston.ca/documents/10180/144997/CityofKingston_OpenDataLicense.pdf',
        'the City of Kingston Open Data Licence',
        'la Licence de données ouvertes de la Ville de Kingston'
    ),
    RED_DEER_LICENSE: portalLicense(
        'Open Government Licence – The City of Red Deer',
        'Licence du gouvernement ouvert – Ville de Red Deer',
        'https://data.reddeer.ca/about',
        'the Open Government Licence – The City of Red Deer',
        'la Licence du gouvernement ouvert – Ville de Red Deer'
    ),
    KAMLOOPS_LICENSE: portalLicense(
        'Open Government Licence – Kamloops',
        'Licence du gouvernement ouvert – Kamloops',
        'https://www.kamloops.ca/open-data-catalogue-disclaimer',
        'the Open Government Licence – Kamloops',
        'la Licence du gouvernement ouvert – Kamloops'
    ),
    NANAIMO_LICENSE: portalLicense(
        'Open Government Licence – Nanaimo',
        'Licence du gouvernement ouvert – Nanaimo',
        'https://www.nanaimo.ca/your-government/maps-data/open-data-catalogue/open-data-catalogue-licence',
        'the Open Government Licence – Nanaimo',
        'la Licence du gouvernement ouvert – Nanaimo'
    ),
    ABBOTSFORD_LICENSE: portalLicense(
        'City of Abbotsford Open Data Licence',
        'Licence de données ouvertes de la Ville d’Abbotsford',
        'https://opendata-abbotsford.hub.arcgis.com/pages/city-of-abbotsford-open-data-licence',
        'the City of Abbotsford Open Data Licence',
        'la Licence de données ouvertes de la Ville d’Abbotsford'
    ),
    GNWT_LICENSE: portalLicense(
        'Open Government Licence – Northwest Territories',
        'Licence du gouvernement ouvert – Territoires du Nord-Ouest',
        'https://www.gov.nt.ca/en/open-government-licence-northwest-territories',
        'the Open Government Licence – Northwest Territories',
        'la Licence du gouvernement ouvert – Territoires du Nord-Ouest'
    ),
    COQUITLAM_LICENSE: portalLicense(
        'Open Government Licence – City of Coquitlam',
        'Licence du gouvernement ouvert – Ville de Coquitlam',
        'https://www.coquitlam.ca/894/Open-Government-Licence',
        'the Open Government Licence – City of Coquitlam',
        'la Licence du gouvernement ouvert – Ville de Coquitlam'
    ),
    PRINCE_GEORGE_LICENSE: portalLicense(
        'Open Government Licence – City of Prince George',
        'Licence du gouvernement ouvert – Ville de Prince George',
        'https://pgmapinfo.princegeorge.ca/opendata/CityofPrinceGeorge_Open_Government_License_Open_Data.pdf',
        'the Open Government Licence – City of Prince George',
        'la Licence du gouvernement ouvert – Ville de Prince George'
    ),
    NEW_WESTMINSTER_LICENSE: portalLicense(
        'Open Government Licence – City of New Westminster',
        'Licence du gouvernement ouvert – Ville de New Westminster',
        'https://opendata.newwestcity.ca/pages/terms-of-use',
        'the Open Government Licence – City of New Westminster',
        'la Licence du gouvernement ouvert – Ville de New Westminster'
    ),
    PORT_MOODY_LICENSE: portalLicense(
        'City of Port Moody Open Data Terms of Use',
        'Conditions d’utilisation des données ouvertes de la Ville de Port Moody',
        'https://www.portmoody.ca/city-government/open-data-portal/open-data-terms-of-use/',
        'the City of Port Moody Open Data Terms of Use',
        'les Conditions d’utilisation des données ouvertes de la Ville de Port Moody'
    ),
    SQUAMISH_LICENSE: portalLicense(
        'Open Government Licence – District of Squamish',
        'Licence du gouvernement ouvert – District de Squamish',
        'https://squamish.ca/government-and-administration/maps-and-data/open-data/',
        'the Open Government Licence – District of Squamish',
        'la Licence du gouvernement ouvert – District de Squamish'
    ),
    MAPLE_RIDGE_LICENSE: portalLicense(
        'Open Government Licence – City of Maple Ridge',
        'Licence du gouvernement ouvert – Ville de Maple Ridge',
        'https://www.mapleridge.ca/terms-use',
        'the Open Government Licence – City of Maple Ridge',
        'la Licence du gouvernement ouvert – Ville de Maple Ridge'
    ),
    PORT_COQUITLAM_LICENSE: portalLicense(
        'Open Government Licence – City of Port Coquitlam',
        'Licence du gouvernement ouvert – Ville de Port Coquitlam',
        'https://data-poco.hub.arcgis.com/pages/terms',
        'the Open Government Licence – City of Port Coquitlam',
        'la Licence du gouvernement ouvert – Ville de Port Coquitlam'
    )
};

function exactPattern(value) {
    const escaped = String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('^' + escaped + '$', 'i');
}

function donneesQuebecSource({
    id, organization, cityEn, cityFr, publisherPattern, placeId,
    directGeoJsonMaps = true, directGeoJsonMapsDisabledReason = null
}) {
    return {
        id,
        kind: 'ckan',
        nameEn: cityEn + ' Open Data',
        nameFr: 'Données ouvertes de ' + cityFr,
        homepageUrl: 'https://www.donneesquebec.ca/recherche/organization/' + organization,
        datasetBaseUrl: DONNEES_QUEBEC_DATASET,
        catalogUrl: DONNEES_QUEBEC_ACTION,
        upstreamHost: 'www.donneesquebec.ca',
        catalogOrganization: organization,
        enabled: true,
        syncIntervalHours: 24,
        maxDeleteFraction: 0.1,
        metadataLanguage: 'fr',
        directGeoJsonMaps,
        ...(directGeoJsonMapsDisabledReason ? { directGeoJsonMapsDisabledReason } : {}),
        defaultOrganizationId: organization,
        defaultOrganizationName: organization,
        defaultOrganizationTitleEn: cityEn,
        defaultOrganizationTitleFr: cityFr,
        licenseMode: 'record-explicit',
        authoritativePublishers: [{ publisher: publisherPattern }],
        licenseRules: [{ publisher: publisherPattern, licenseId: /^cc-by$/i, license: null }],
        placeRules: [{
            publisher: publisherPattern,
            placeId,
            relationship: 'direct',
            includesDescendants: false
        }]
    };
}

function arcgisMunicipalSource({
    id,
    cityEn,
    cityFr,
    host,
    homepageUrl,
    placeId,
    license,
    publisherPatterns,
    includesDescendants = false,
    restrictedLicensePatterns = [],
    unavailableServicePatterns = [],
    enabled = true,
    disabledReason = null
}) {
    const publisher = exactPattern(cityEn);
    return {
        id,
        kind: 'arcgis-hub',
        nameEn: cityEn + ' Open Data',
        nameFr: 'Données ouvertes de ' + cityFr,
        homepageUrl: homepageUrl || 'https://' + host + '/',
        catalogUrl: 'https://' + host + '/api/feed/dcat-us/1.1.json',
        upstreamHost: host,
        enabled,
        ...(disabledReason ? { disabledReason } : {}),
        syncIntervalHours: 24,
        maxDeleteFraction: 0.1,
        placeholderPublisher: cityEn,
        restrictedLicensePatterns: DEFAULT_RESTRICTED_LICENSE_PATTERNS.concat(restrictedLicensePatterns),
        unavailableServicePatterns,
        publisherAliases: publisherPatterns.map(pattern => ({ publisher: pattern, name: cityEn })),
        authoritativePublishers: [{ publisher }],
        licenseRules: license ? [{ publisher, license }] : [],
        placeRules: [{
            publisher,
            placeId,
            relationship: 'direct',
            includesDescendants
        }]
    };
}

function reginaSource() {
    const license = EXPANSION_LICENSES.REGINA_LICENSE;
    return {
        id: 'regina-hub',
        kind: 'ckan',
        nameEn: 'City of Regina Open Data',
        nameFr: 'Données ouvertes de la Ville de Regina',
        homepageUrl: 'https://openregina.ca/',
        datasetBaseUrl: 'https://openregina.ca/dataset',
        catalogUrl: 'https://openregina.ca/api/3/action',
        upstreamHost: 'openregina.ca',
        catalogOrganization: 'city-of-regina',
        enabled: true,
        syncIntervalHours: 24,
        maxDeleteFraction: 0.1,
        metadataLanguage: 'en',
        defaultOrganizationId: 'city-of-regina',
        defaultOrganizationName: 'city-of-regina',
        defaultOrganizationTitleEn: 'City of Regina',
        defaultOrganizationTitleFr: 'Ville de Regina',
        licenseMode: 'record-explicit',
        licenseRules: [{
            publisher: /^city of regina$/i,
            licenseId: /^notspecified$/i,
            licenseTitle: /^open gov\. license$/i,
            license
        }],
        authoritativePublishers: [{ publisher: /^city of regina$/i }],
        placeRules: [{
            publisher: /^city of regina$/i,
            placeId: 'sgc-csd-4706027',
            relationship: 'direct',
            includesDescendants: false
        }]
    };
}

function redDeerSource() {
    return {
        id: 'red-deer-hub',
        kind: 'red-deer',
        nameEn: 'City of Red Deer Open Data',
        nameFr: 'Données ouvertes de la Ville de Red Deer',
        homepageUrl: 'https://data.reddeer.ca/',
        catalogUrl: 'https://data.reddeer.ca/api/datasets',
        upstreamHost: 'data.reddeer.ca',
        enabled: true,
        syncIntervalHours: 24,
        maxDeleteFraction: 0.1,
        publisher: 'The City of Red Deer',
        license: EXPANSION_LICENSES.RED_DEER_LICENSE,
        placeId: 'sgc-csd-4808011'
    };
}

function gnwtSource() {
    return {
        id: 'northwest-territories-open-data',
        kind: 'ckan',
        nameEn: 'Northwest Territories Open Data',
        nameFr: 'Données ouvertes des Territoires du Nord-Ouest',
        homepageUrl: 'https://opendata.gov.nt.ca/',
        datasetBaseUrl: 'https://opendata.gov.nt.ca/dataset',
        catalogUrl: 'https://opendata.gov.nt.ca/api/3/action',
        upstreamHost: 'opendata.gov.nt.ca',
        enabled: true,
        syncIntervalHours: 24,
        maxDeleteFraction: 0.1,
        metadataLanguage: 'en',
        defaultOrganizationId: 'government-of-the-northwest-territories',
        defaultOrganizationName: 'government-of-the-northwest-territories',
        defaultOrganizationTitleEn: 'Government of the Northwest Territories',
        defaultOrganizationTitleFr: 'Gouvernement des Territoires du Nord-Ouest',
        licenseMode: 'record-explicit',
        licenseRules: [{ licenseId: /^GNWT$/i, license: EXPANSION_LICENSES.GNWT_LICENSE }],
        placeRules: [{
            publisher: /.*/,
            placeId: 'sgc-pr-61',
            relationship: 'direct',
            includesDescendants: true
        }]
    };
}

function buildExpansionSources({ ccBy4License }) {
    if (!ccBy4License || !ccBy4License.url) throw new Error('CC BY 4.0 licence is required');

    const dq = options => {
        const source = donneesQuebecSource(options);
        source.licenseRules[0].license = ccBy4License;
        return source;
    };

    return [
        dq({ id: 'gatineau-open-data', organization: 'ville-de-gatineau', cityEn: 'City of Gatineau', cityFr: 'la Ville de Gatineau', publisherPattern: /^ville de gatineau$/i, placeId: 'sgc-csd-2481017' }),
        dq({ id: 'trois-rivieres-open-data', organization: 'ville-de-trois-rivieres', cityEn: 'City of Trois-Rivières', cityFr: 'la Ville de Trois-Rivières', publisherPattern: /^ville de trois-rivi[eè]res$/i, placeId: 'sgc-csd-2437067' }),
        dq({ id: 'repentigny-open-data', organization: 'ville-de-repentigny', cityEn: 'City of Repentigny', cityFr: 'la Ville de Repentigny', publisherPattern: /^ville de repentigny$/i, placeId: 'sgc-csd-2460013' }),
        dq({ id: 'longueuil-open-data', organization: 'ville-de-longueuil', cityEn: 'City of Longueuil', cityFr: 'la Ville de Longueuil', publisherPattern: /^ville de longueuil$/i, placeId: 'sgc-csd-2458227' }),
        dq({ id: 'saguenay-open-data', organization: 'ville-de-saguenay', cityEn: 'City of Saguenay', cityFr: 'la Ville de Saguenay', publisherPattern: /^ville de saguenay$/i, placeId: 'sgc-csd-2494068' }),
        dq({ id: 'rimouski-open-data', organization: 'ville-de-rimouski', cityEn: 'City of Rimouski', cityFr: 'la Ville de Rimouski', publisherPattern: /^ville de rimouski$/i, placeId: 'sgc-csd-2410043' }),
        dq({
            id: 'shawinigan-open-data', organization: 'ville-de-shawinigan',
            cityEn: 'City of Shawinigan', cityFr: 'la Ville de Shawinigan',
            publisherPattern: /^ville de shawinigan$/i, placeId: 'sgc-csd-2436033',
            directGeoJsonMaps: false,
            directGeoJsonMapsDisabledReason: 'Map service timed out from production during v35 closeout'
        }),
        dq({ id: 'levis-open-data', organization: 'ville-de-levis', cityEn: 'City of Lévis', cityFr: 'la Ville de Lévis', publisherPattern: /^ville de l[eé]vis$/i, placeId: 'sgc-csd-2425213' }),
        dq({ id: 'sherbrooke-open-data', organization: 'ville-de-sherbrooke', cityEn: 'City of Sherbrooke', cityFr: 'la Ville de Sherbrooke', publisherPattern: /^ville de sherbrooke$/i, placeId: 'sgc-csd-2443027' }),
        arcgisMunicipalSource({ id: 'saint-john-hub', cityEn: 'City of Saint John', cityFr: 'la Ville de Saint John', host: 'catalogue-saintjohn.opendata.arcgis.com', placeId: 'sgc-csd-1301006', license: EXPANSION_LICENSES.SAINT_JOHN_LICENSE, publisherPatterns: [/^the city of saint john$/i, /^city of saint john$/i] }),

        // These three municipalities do not currently publish the documented
        // ArcGIS Hub feeds or an equivalent machine-readable catalogue under
        // a verified open-data licence. Retain their stable source identities,
        // but keep scheduled sync fail-closed until the municipalities expose
        // an admissible catalogue again.
        arcgisMunicipalSource({ id: 'whitehorse-hub', cityEn: 'City of Whitehorse', cityFr: 'la Ville de Whitehorse', host: 'data-whitehorse.opendata.arcgis.com', homepageUrl: 'https://data.whitehorse.ca/', placeId: 'sgc-csd-6001009', license: EXPANSION_LICENSES.WHITEHORSE_LICENSE, publisherPatterns: [/^(?:the )?city of whitehorse$/i], enabled: false, disabledReason: 'No live machine-readable catalogue with verified open-data terms' }),
        arcgisMunicipalSource({ id: 'st-johns-hub', cityEn: "City of St. John's", cityFr: "la Ville de St. John's", host: 'map-stjohns.opendata.arcgis.com', homepageUrl: 'https://map.stjohns.ca/', placeId: 'sgc-csd-1001519', license: EXPANSION_LICENSES.ST_JOHNS_LICENSE, publisherPatterns: [/^(?:the )?city of st\.?\s*john'?s$/i], enabled: false, disabledReason: 'No live ArcGIS Hub feed or verified portal-wide open-data licence' }),
        arcgisMunicipalSource({ id: 'charlottetown-hub', cityEn: 'City of Charlottetown', cityFr: 'la Ville de Charlottetown', host: 'city-charlottetown.opendata.arcgis.com', homepageUrl: 'https://www.charlottetown.ca/resident_services/maps', placeId: 'sgc-csd-1102075', license: EXPANSION_LICENSES.CHARLOTTETOWN_LICENSE, publisherPatterns: [/^(?:the )?city of charlottetown$/i], enabled: false, disabledReason: 'No live machine-readable municipal catalogue with verified open-data terms' }),
        reginaSource(),
        arcgisMunicipalSource({ id: 'windsor-hub', cityEn: 'City of Windsor', cityFr: 'la Ville de Windsor', host: 'open-data-portal-citywindsor.hub.arcgis.com', homepageUrl: 'https://opendata.citywindsor.ca/', placeId: 'sgc-csd-3537039', license: EXPANSION_LICENSES.WINDSOR_LICENSE, publisherPatterns: [/^(?:the )?city of windsor$/i, /^the corporation of the city of windsor$/i] }),
        arcgisMunicipalSource({ id: 'kingston-hub', cityEn: 'City of Kingston', cityFr: 'la Ville de Kingston', host: 'opendatakingston.cityofkingston.ca', placeId: 'sgc-csd-3510010', license: EXPANSION_LICENSES.KINGSTON_LICENSE, publisherPatterns: [/^(?:the )?city of kingston$/i, /^the corporation of the city of kingston$/i, /^information systems & technology - gis group$/i], restrictedLicensePatterns: [/commercial purposes?[^.]{0,160}(?:strictly )?prohibited/i, /express written permission of opta/i] }),
        redDeerSource(),
        arcgisMunicipalSource({ id: 'kamloops-hub', cityEn: 'City of Kamloops', cityFr: 'la Ville de Kamloops', host: 'mydata-kamloops.opendata.arcgis.com', placeId: 'sgc-csd-5933042', license: EXPANSION_LICENSES.KAMLOOPS_LICENSE, publisherPatterns: [/^(?:the )?city of kamloops$/i] }),
        arcgisMunicipalSource({ id: 'nanaimo-hub', cityEn: 'City of Nanaimo', cityFr: 'la Ville de Nanaimo', host: 'gisdata.nanaimo.ca', placeId: 'sgc-csd-5921007', license: EXPANSION_LICENSES.NANAIMO_LICENSE, publisherPatterns: [/^(?:the )?city of nanaimo$/i], restrictedLicensePatterns: [/disclaimer that pops up/i] }),
        arcgisMunicipalSource({ id: 'abbotsford-hub', cityEn: 'City of Abbotsford', cityFr: 'la Ville d’Abbotsford', host: 'opendata-abbotsford.hub.arcgis.com', placeId: 'sgc-csd-5909052', license: EXPANSION_LICENSES.ABBOTSFORD_LICENSE, publisherPatterns: [/^(?:the )?city of abbotsford$/i], restrictedLicensePatterns: [/data sharing agreement with metro vancouver/i], unavailableServicePatterns: [/^https:\/\/maps\.abbotsford\.ca\/arcgis\/rest\/services\/GeocortexExt\//i] }),

        gnwtSource(),
        arcgisMunicipalSource({ id: 'coquitlam-hub', cityEn: 'City of Coquitlam', cityFr: 'la Ville de Coquitlam', host: 'data.coquitlam.ca', placeId: 'sgc-csd-5915034', license: EXPANSION_LICENSES.COQUITLAM_LICENSE, publisherPatterns: [/^city of coquitlam$/i] }),
        arcgisMunicipalSource({ id: 'prince-george-hub', cityEn: 'City of Prince George', cityFr: 'la Ville de Prince George', host: 'data-cityofpg.opendata.arcgis.com', placeId: 'sgc-csd-5953023', license: EXPANSION_LICENSES.PRINCE_GEORGE_LICENSE, publisherPatterns: [/^city of prince george$/i] }),
        arcgisMunicipalSource({ id: 'new-westminster-hub', cityEn: 'City of New Westminster', cityFr: 'la Ville de New Westminster', host: 'opendata.newwestcity.ca', placeId: 'sgc-csd-5915029', license: EXPANSION_LICENSES.NEW_WESTMINSTER_LICENSE, publisherPatterns: [/^city of new westminster(?:, british columbia, canada)?$/i] }),
        arcgisMunicipalSource({ id: 'port-moody-hub', cityEn: 'City of Port Moody', cityFr: 'la Ville de Port Moody', host: 'data.portmoody.ca', placeId: 'sgc-csd-5915043', license: EXPANSION_LICENSES.PORT_MOODY_LICENSE, publisherPatterns: [/^city of port moody$/i] }),
        arcgisMunicipalSource({ id: 'squamish-hub', cityEn: 'District of Squamish', cityFr: 'le District de Squamish', host: 'data.squamish.ca', placeId: 'sgc-csd-5931006', license: EXPANSION_LICENSES.SQUAMISH_LICENSE, publisherPatterns: [/^district of squamish$/i] }),
        arcgisMunicipalSource({ id: 'maple-ridge-hub', cityEn: 'City of Maple Ridge', cityFr: 'la Ville de Maple Ridge', host: 'opengov.mapleridge.ca', placeId: 'sgc-csd-5915075', license: EXPANSION_LICENSES.MAPLE_RIDGE_LICENSE, publisherPatterns: [/^(?:city of )?maple ridge$/i], restrictedLicensePatterns: [/translink/i] }),
        arcgisMunicipalSource({ id: 'port-coquitlam-hub', cityEn: 'City of Port Coquitlam', cityFr: 'la Ville de Port Coquitlam', host: 'data-poco.hub.arcgis.com', placeId: 'sgc-csd-5915039', license: EXPANSION_LICENSES.PORT_COQUITLAM_LICENSE, publisherPatterns: [/^city of port coquitlam$/i], restrictedLicensePatterns: [/pocomap/i, /internal business and personal purpose/i] }),
        dq({ id: 'sherbrooke-geomatics-open-data', organization: 'ville-de-sherbrooke-donnees-geomatiques', cityEn: 'City of Sherbrooke Geomatics', cityFr: 'la Ville de Sherbrooke – données géomatiques', publisherPattern: /^ville de sherbrooke - donn[eé]es g[eé]omatiques$/i, placeId: 'sgc-csd-2443027' }),
        dq({
            id: 'saint-hyacinthe-open-data', organization: 'ville-de-saint-hyacinthe',
            cityEn: 'City of Saint-Hyacinthe', cityFr: 'la Ville de Saint-Hyacinthe',
            publisherPattern: /^ville de saint-hyacinthe$/i, placeId: 'sgc-csd-2454048',
            directGeoJsonMaps: false,
            directGeoJsonMapsDisabledReason: 'Map service timed out from production during v35 closeout'
        })
    ];
}

module.exports = {
    buildExpansionSources,
    EXPANSION_LICENSES,
    arcgisMunicipalSource,
    donneesQuebecSource,
    exactPattern
};
