const { sources, getSource } = require('../config/catalogSources');

describe('catalogSources config', () => {
    test('contains 65 configured municipal/regional sources', () => {
        expect(sources).toHaveLength(65);
    });

    test('retrieves toronto-open-data config', () => {
        const toronto = getSource('toronto-open-data');
        expect(toronto).not.toBeNull();
        expect(toronto.kind).toBe('ckan');
        expect(toronto.upstreamHost).toBe('ckan0.cf.opendata.inter.prod-toronto.ca');
        expect(toronto.placeRules[0].placeId).toBe('sgc-cd-3520');
        expect(toronto.licenseRules[0].licenseTitle).toBe('Open Government Licence – Toronto');
    });

    test('retrieves montreal-open-data config', () => {
        const montreal = getSource('montreal-open-data');
        expect(montreal).not.toBeNull();
        expect(montreal.kind).toBe('ckan');
        expect(montreal.upstreamHost).toBe('donnees.montreal.ca');
        expect(montreal.placeRules[0].placeId).toBe('sgc-csd-2466023');
        expect(montreal.licenseMode).toBe('record-explicit');
    });

    test('retrieves quebec-city-open-data config with Donnees Quebec CKAN catalog', () => {
        const quebecCity = getSource('quebec-city-open-data');
        expect(quebecCity).not.toBeNull();
        expect(quebecCity.kind).toBe('ckan');
        expect(quebecCity.upstreamHost).toBe('www.donneesquebec.ca');
        expect(quebecCity.catalogOrganization).toBe('ville-de-quebec');
        expect(quebecCity.metadataLanguage).toBe('fr');
        expect(quebecCity.placeRules[0].placeId).toBe('sgc-csd-2423027');
        expect(quebecCity.licenseRules[0].licenseTitle).toBe('Attribution (CC-BY 4.0)');
    });

    test('retrieves vancouver-open-data config', () => {
        const vancouver = getSource('vancouver-open-data');
        expect(vancouver).not.toBeNull();
        expect(vancouver.kind).toBe('opendatasoft');
        expect(vancouver.upstreamHost).toBe('opendata.vancouver.ca');
        expect(vancouver.placeRules[0].placeId).toBe('sgc-csd-5915022');
        expect(vancouver.licenseRules[0].licenseTitle).toBe('Open Government Licence - Vancouver');
    });

    test('retrieves calgary-open-data config', () => {
        const calgary = getSource('calgary-open-data');
        expect(calgary).not.toBeNull();
        expect(calgary.kind).toBe('socrata');
        expect(calgary.upstreamHost).toBe('data.calgary.ca');
        expect(calgary.placeRules[0].placeId).toBe('sgc-csd-4806016');
        expect(calgary.licenseRules[0].licenseTitle).toBe('Open Government Licence - City of Calgary');
    });

    test('retrieves edmonton-open-data config', () => {
        const edmonton = getSource('edmonton-open-data');
        expect(edmonton).not.toBeNull();
        expect(edmonton.kind).toBe('socrata');
        expect(edmonton.upstreamHost).toBe('data.edmonton.ca');
        expect(edmonton.placeRules[0].placeId).toBe('sgc-csd-4811061');
        expect(edmonton.licenseRules[0].license.titleEn).toBe('Open Government Licence – Edmonton');
    });

    test('retrieves winnipeg-open-data config', () => {
        const winnipeg = getSource('winnipeg-open-data');
        expect(winnipeg).not.toBeNull();
        expect(winnipeg.kind).toBe('socrata');
        expect(winnipeg.upstreamHost).toBe('data.winnipeg.ca');
        expect(winnipeg.placeRules[0].placeId).toBe('sgc-csd-4611040');
        expect(winnipeg.licenseRules[0].licenseTitle).toBe('Open Government Licence – Winnipeg');
    });

    test('retrieves halifax-hub config', () => {
        const halifax = getSource('halifax-hub');
        expect(halifax).not.toBeNull();
        expect(halifax.kind).toBe('arcgis-hub');
        expect(halifax.upstreamHost).toBe('catalogue-hrm.opendata.arcgis.com');
        expect(halifax.placeRules[0].placeId).toBe('sgc-csd-1209034');
        expect(halifax.licenseRules[0].license.titleEn).toBe('Open Government Licence – Halifax');
    });

    test('retrieves hamilton-hub config', () => {
        const hamilton = getSource('hamilton-hub');
        expect(hamilton).not.toBeNull();
        expect(hamilton.kind).toBe('arcgis-hub');
        expect(hamilton.upstreamHost).toBe('open.hamilton.ca');
        expect(hamilton.placeRules[0].placeId).toBe('sgc-cd-3525');
        expect(hamilton.licenseRules[0].license.titleEn).toBe('City of Hamilton Open Data Licence');
    });

    test('retrieves surrey-hub config', () => {
        const surrey = getSource('surrey-hub');
        expect(surrey).not.toBeNull();
        expect(surrey.kind).toBe('arcgis-hub');
        expect(surrey.upstreamHost).toBe('data.surrey.ca');
        expect(surrey.placeRules[0].placeId).toBe('sgc-csd-5915004');
        expect(surrey.licenseRules[0].license.titleEn).toBe('Open Government License – Surrey');
    });

    test('retrieves durham regional and municipal hubs with distinct place mappings', () => {
        const durham = getSource('durham-hub');
        const oshawa = getSource('oshawa-hub');
        const ajax = getSource('ajax-hub');
        const pickering = getSource('pickering-hub');
        const whitby = getSource('whitby-hub');

        expect(durham.placeRules[0].placeId).toBe('ca-on-durham');
        expect(durham.placeRules[0].includesDescendants).toBe(true);

        expect(oshawa.placeRules[0].placeId).toBe('sgc-csd-3518013');
        expect(oshawa.placeRules[0].includesDescendants).toBe(false);

        expect(ajax.placeRules[0].placeId).toBe('sgc-csd-3518005');
        expect(pickering.placeRules[0].placeId).toBe('sgc-csd-3518001');
        expect(whitby.placeRules[0].placeId).toBe('sgc-csd-3518009');
    });

    test('retrieves peel regional and municipal hubs with distinct place mappings', () => {
        const peel = getSource('peel-hub');
        const mississauga = getSource('mississauga-hub');
        const brampton = getSource('brampton-hub');

        expect(peel.placeRules[0].placeId).toBe('sgc-cd-3521');
        expect(peel.placeRules[0].includesDescendants).toBe(true);

        expect(mississauga.placeRules[0].placeId).toBe('sgc-csd-3521005');
        expect(mississauga.placeRules[0].includesDescendants).toBe(false);

        expect(brampton.placeRules[0].placeId).toBe('sgc-csd-3521010');
        expect(brampton.placeRules[0].includesDescendants).toBe(false);
    });

    test('retrieves halton municipal hubs with distinct place mappings', () => {
        const burlington = getSource('burlington-hub');
        const oakville = getSource('oakville-hub');
        const milton = getSource('milton-hub');

        expect(burlington.placeRules[0].placeId).toBe('sgc-csd-3524002');
        expect(oakville.placeRules[0].placeId).toBe('sgc-csd-3524001');
        expect(milton.placeRules[0].placeId).toBe('sgc-csd-3524009');
    });

    test('retrieves greater sudbury, burnaby, and saskatoon hubs with distinct place mappings', () => {
        const sudbury = getSource('sudbury-hub');
        const burnaby = getSource('burnaby-hub');
        const saskatoon = getSource('saskatoon-hub');

        expect(sudbury.placeRules[0].placeId).toBe('sgc-cd-3553');
        expect(burnaby.placeRules[0].placeId).toBe('sgc-csd-5915025');
        expect(saskatoon.placeRules[0].placeId).toBe('sgc-csd-4711066');
    });

    test('retrieves york region and municipal hubs with distinct place mappings', () => {
        const markham = getSource('markham-hub');
        const newmarket = getSource('newmarket-hub');

        expect(markham.placeRules[0].placeId).toBe('sgc-csd-3519036');
        expect(newmarket.placeRules[0].placeId).toBe('sgc-csd-3519048');
    });

    test('retrieves niagara region municipal hubs with distinct place mappings', () => {
        const niagaraFalls = getSource('niagara-falls-hub');
        const welland = getSource('welland-hub');

        expect(niagaraFalls.placeRules[0].placeId).toBe('sgc-csd-3526043');
        expect(welland.placeRules[0].placeId).toBe('sgc-csd-3526032');
    });

    test('retrieves moncton, guelph, saanich, and belleville hubs with distinct place mappings', () => {
        const moncton = getSource('moncton-hub');
        const guelph = getSource('guelph-hub');
        const saanich = getSource('saanich-hub');
        const belleville = getSource('belleville-hub');

        expect(moncton.placeRules[0].placeId).toBe('sgc-csd-1307022');
        expect(guelph.placeRules[0].placeId).toBe('sgc-csd-3523008');
        expect(saanich.placeRules[0].placeId).toBe('sgc-csd-5917021');
        expect(belleville.placeRules[0].placeId).toBe('sgc-csd-3512005');
    });

    test('retrieves yellowknife, barrie, thunder bay, and chatham-kent hubs with distinct place mappings', () => {
        const yellowknife = getSource('yellowknife-hub');
        const barrie = getSource('barrie-hub');
        const thunderBay = getSource('thunderbay-hub');
        const chathamKent = getSource('chatham-kent-hub');

        expect(yellowknife.placeRules[0].placeId).toBe('sgc-csd-6106023');
        expect(barrie.placeRules[0].placeId).toBe('sgc-csd-3543042');
        expect(thunderBay.placeRules[0].placeId).toBe('sgc-csd-3558004');
        expect(chathamKent.placeRules[0].placeId).toBe('sgc-cd-3536');
    });

    test('retrieves kawartha lakes, summerland, norfolk, and haldimand hubs with distinct place mappings', () => {
        const kawarthaLakes = getSource('kawartha-lakes-hub');
        const summerland = getSource('summerland-hub');
        const norfolk = getSource('norfolk-hub');
        const haldimand = getSource('haldimand-hub');

        expect(kawarthaLakes.placeRules[0].placeId).toBe('sgc-cd-3516');
        expect(summerland.placeRules[0].placeId).toBe('sgc-csd-5907035');
        expect(norfolk.placeRules[0].placeId).toBe('sgc-csd-3528052');
        expect(haldimand.placeRules[0].placeId).toBe('sgc-csd-3528018');
    });

    test('retrieves lethbridge, medicine hat, airdrie, canmore, penticton, and langley city hubs with distinct place mappings', () => {
        const lethbridge = getSource('lethbridge-hub');
        const medicineHat = getSource('medicine-hat-hub');
        const airdrie = getSource('airdrie-hub');
        const canmore = getSource('canmore-hub');
        const penticton = getSource('penticton-hub');
        const langleyCity = getSource('langley-city-hub');

        expect(lethbridge.placeRules[0].placeId).toBe('sgc-csd-4802012');
        expect(medicineHat.placeRules[0].placeId).toBe('sgc-csd-4801006');
        expect(airdrie.placeRules[0].placeId).toBe('sgc-csd-4806021');
        expect(canmore.placeRules[0].placeId).toBe('sgc-csd-4815023');
        expect(penticton.placeRules[0].placeId).toBe('sgc-csd-5907041');
        expect(langleyCity.placeRules[0].placeId).toBe('sgc-csd-5915001');
    });

    test('retrieves huron county and cumberland county hubs with distinct place mappings', () => {
        const huron = getSource('huron-hub');
        const cumberland = getSource('cumberland-hub');

        expect(huron.placeRules[0].placeId).toBe('sgc-cd-3540');
        expect(huron.placeRules[0].includesDescendants).toBe(true);

        expect(cumberland.placeRules[0].placeId).toBe('sgc-cd-1211');
        expect(cumberland.placeRules[0].includesDescendants).toBe(true);
    });

    test('retrieves 9 Données Québec municipal CKAN sources with correct place mappings and licenses', () => {
        const qcSources = [
            { id: 'gatineau-open-data', org: 'ville-de-gatineau', placeId: 'sgc-csd-2481017' },
            { id: 'trois-rivieres-open-data', org: 'ville-de-trois-rivieres', placeId: 'sgc-csd-2437067' },
            { id: 'repentigny-open-data', org: 'ville-de-repentigny', placeId: 'sgc-csd-2460013' },
            { id: 'longueuil-open-data', org: 'ville-de-longueuil', placeId: 'sgc-csd-2458227' },
            { id: 'saguenay-open-data', org: 'ville-de-saguenay', placeId: 'sgc-csd-2494068' },
            { id: 'rimouski-open-data', org: 'ville-de-rimouski', placeId: 'sgc-csd-2410043' },
            { id: 'shawinigan-open-data', org: 'ville-de-shawinigan', placeId: 'sgc-csd-2436033' },
            { id: 'levis-open-data', org: 'ville-de-levis', placeId: 'sgc-csd-2425213' },
            { id: 'sherbrooke-open-data', org: 'ville-de-sherbrooke', placeId: 'sgc-csd-2443027' }
        ];

        for (const expected of qcSources) {
            const src = getSource(expected.id);
            expect(src).not.toBeNull();
            expect(src.kind).toBe('ckan');
            expect(src.upstreamHost).toBe('www.donneesquebec.ca');
            expect(src.catalogOrganization).toBe(expected.org);
            expect(src.metadataLanguage).toBe('fr');
            expect(src.directGeoJsonMaps).toBe(true);
            expect(src.placeRules[0].placeId).toBe(expected.placeId);
            expect(src.placeRules[0].relationship).toBe('direct');
            expect(src.placeRules[0].includesDescendants).toBe(false);
            expect(src.licenseRules[0].licenseTitle).toBe('Attribution (CC-BY 4.0)');
        }
    });

    test('retrieves saint-john-hub with correct place mapping and license', () => {
        const saintJohn = getSource('saint-john-hub');
        expect(saintJohn).not.toBeNull();
        expect(saintJohn.kind).toBe('arcgis-hub');
        expect(saintJohn.upstreamHost).toBe('catalogue-saintjohn.opendata.arcgis.com');
        expect(saintJohn.placeRules[0].placeId).toBe('sgc-csd-1301006');
        expect(saintJohn.placeRules[0].relationship).toBe('direct');
        expect(saintJohn.placeRules[0].includesDescendants).toBe(false);
        expect(saintJohn.licenseRules[0].license.titleEn).toBe('Open Government Licence – City of Saint John');
    });

    test('retrieves 10 v34 capital and municipal expansion sources with correct place mappings and licenses', () => {
        const v34Sources = [
            { id: 'whitehorse-hub', host: 'data-whitehorse.opendata.arcgis.com', placeId: 'sgc-csd-6001009', licenseTitle: 'City of Whitehorse Open Data Licence' },
            { id: 'st-johns-hub', host: 'map-stjohns.opendata.arcgis.com', placeId: 'sgc-csd-1001519', licenseTitle: 'Open Government Licence – City of St. John\'s' },
            { id: 'charlottetown-hub', host: 'city-charlottetown.opendata.arcgis.com', placeId: 'sgc-csd-1102075', licenseTitle: 'City of Charlottetown Open Data Licence' },
            { id: 'regina-hub', host: 'open-regina.hub.arcgis.com', placeId: 'sgc-csd-4706027', licenseTitle: 'City of Regina Open Data Licence' },
            { id: 'windsor-hub', host: 'opendata.citywindsor.ca', placeId: 'sgc-csd-3537039', licenseTitle: 'City of Windsor Open Data Licence' },
            { id: 'kingston-hub', host: 'data.cityofkingston.ca', placeId: 'sgc-csd-3510010', licenseTitle: 'City of Kingston Open Data Licence' },
            { id: 'red-deer-hub', host: 'data-reddeer.opendata.arcgis.com', placeId: 'sgc-csd-4808011', licenseTitle: 'City of Red Deer Open Data Licence' },
            { id: 'kamloops-hub', host: 'data-kamloops.opendata.arcgis.com', placeId: 'sgc-csd-5933042', licenseTitle: 'City of Kamloops Open Data Licence' },
            { id: 'nanaimo-hub', host: 'data-nanaimo.opendata.arcgis.com', placeId: 'sgc-csd-5921007', licenseTitle: 'City of Nanaimo Open Data Licence' },
            { id: 'abbotsford-hub', host: 'data-abbotsford.opendata.arcgis.com', placeId: 'sgc-csd-5909052', licenseTitle: 'City of Abbotsford Open Data Licence' }
        ];

        for (const expected of v34Sources) {
            const src = getSource(expected.id);
            expect(src).not.toBeNull();
            expect(src.kind).toBe('arcgis-hub');
            expect(src.upstreamHost).toBe(expected.host);
            expect(src.placeRules[0].placeId).toBe(expected.placeId);
            expect(src.placeRules[0].relationship).toBe('direct');
            expect(src.placeRules[0].includesDescendants).toBe(false);
            expect(src.licenseRules[0].license.titleEn).toBe(expected.licenseTitle);
        }
    });
});
