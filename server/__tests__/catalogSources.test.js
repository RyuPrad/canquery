const { sources, getSource } = require('../config/catalogSources');

describe('configured municipal catalogue sources', () => {
    test('syncs city portals before the authoritative portal in each regional cluster', () => {
        expect(sources.map(source => source.id)).toEqual([
            'toronto-open-data', 'montreal-open-data', 'quebec-city-open-data',
            'gatineau-open-data', 'trois-rivieres-open-data', 'repentigny-open-data',
            'longueuil-open-data', 'saguenay-open-data', 'rimouski-open-data',
            'shawinigan-open-data', 'levis-open-data', 'sherbrooke-open-data',
            'laval-open-data',
            'ottawa-hub', 'vancouver-open-data',
            'calgary-open-data', 'edmonton-open-data', 'winnipeg-open-data', 'halifax-hub',
            'hamilton-hub', 'surrey-hub',
            'oshawa-hub', 'ajax-hub', 'pickering-hub', 'whitby-hub', 'durham-hub',
            'mississauga-hub', 'brampton-hub', 'peel-hub',
            'victoria-hub', 'waterloo-region-hub', 'london-hub', 'kelowna-hub', 'fredericton-hub',
            'burlington-hub', 'oakville-hub', 'milton-hub', 'sudbury-hub', 'burnaby-hub', 'saskatoon-hub',
            'markham-hub', 'newmarket-hub', 'niagara-falls-hub', 'welland-hub', 'moncton-hub',
            'guelph-hub', 'saanich-hub', 'belleville-hub',
            'yellowknife-hub', 'barrie-hub', 'thunderbay-hub', 'chatham-kent-hub', 'kawartha-lakes-hub',
            'summerland-hub', 'norfolk-hub', 'haldimand-hub',
            'lethbridge-hub', 'medicine-hat-hub', 'airdrie-hub', 'canmore-hub',
            'penticton-hub', 'langley-city-hub', 'huron-hub', 'cumberland-hub',
            'saint-john-hub',
            'whitehorse-hub', 'st-johns-hub', 'charlottetown-hub', 'regina-hub',
            'windsor-hub', 'kingston-hub', 'red-deer-hub', 'kamloops-hub',
            'nanaimo-hub', 'abbotsford-hub'
        ]);
    });

    test('configures Victoria as an exact-publisher ArcGIS source under its portal licence', () => {
        const victoria = getSource('victoria-hub');
        expect(victoria).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'opendata.victoria.ca',
            catalogUrl: 'https://opendata.victoria.ca/api/feed/dcat-us/1.1.json'
        }));
        expect(victoria.licenseRules).toEqual(expect.arrayContaining([
            expect.objectContaining({
                publisher: expect.any(RegExp),
                license: expect.objectContaining({
                    url: 'https://opendata.victoria.ca/pages/open-data-licence'
                })
            })
        ]));
        expect(victoria.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-5917034', relationship: 'direct',
            includesDescendants: false
        })]);
    });

    test('configures Waterloo Region as a multi-jurisdiction regional ArcGIS hub', () => {
        const waterloo = getSource('waterloo-region-hub');
        expect(waterloo).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'rowopendata-rmw.opendata.arcgis.com',
            catalogUrl: 'https://rowopendata-rmw.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(waterloo.publisherAliases).toHaveLength(4);
        expect(waterloo.authoritativePublishers).toHaveLength(4);
        expect(waterloo.licenseRules).toHaveLength(4);
        expect(waterloo.placeRules).toHaveLength(4);
        expect(waterloo.placeRules).toEqual(expect.arrayContaining([
            expect.objectContaining({ placeId: 'sgc-cd-3530', relationship: 'direct', includesDescendants: true }),
            expect.objectContaining({ placeId: 'sgc-csd-3530013', relationship: 'direct', includesDescendants: false }),
            expect.objectContaining({ placeId: 'sgc-csd-3530016', relationship: 'direct', includesDescendants: false }),
            expect.objectContaining({ placeId: 'sgc-csd-3530010', relationship: 'direct', includesDescendants: false })
        ]));
    });

    test('configures London as a City publisher ArcGIS hub resolving item owners', () => {
        const london = getSource('london-hub');
        expect(london).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'open-london.opendata.arcgis.com',
            catalogUrl: 'https://open-london.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(london.publisherAliases).toEqual(expect.arrayContaining([
            expect.objectContaining({ name: 'City of London' })
        ]));
        expect(london.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-3539036', relationship: 'direct', includesDescendants: false
        })]);
    });

    test('configures Kelowna as an exact-publisher ArcGIS source under its portal licence', () => {
        const kelowna = getSource('kelowna-hub');
        expect(kelowna).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'opendata.kelowna.ca',
            catalogUrl: 'https://opendata.kelowna.ca/api/feed/dcat-us/1.1.json'
        }));
        expect(kelowna.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-5935010', relationship: 'direct', includesDescendants: false
        })]);
    });

    test('configures Fredericton as an exact-publisher ArcGIS source under its portal licence', () => {
        const fredericton = getSource('fredericton-hub');
        expect(fredericton).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-fredericton.opendata.arcgis.com',
            catalogUrl: 'https://data-fredericton.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(fredericton.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-1310032', relationship: 'direct', includesDescendants: false
        })]);
    });

    test('configures Halifax as an exact-publisher ArcGIS source under its portal licence', () => {
        const halifax = getSource('halifax-hub');
        expect(halifax).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-hrm.hub.arcgis.com',
            catalogUrl: 'https://data-hrm.hub.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(halifax.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-1209034', relationship: 'direct', includesDescendants: false
        })]);
    });

    test('configures Calgary as a strict record-licensed Socrata city source', () => {
        const calgary = getSource('calgary-open-data');
        expect(calgary).toEqual(expect.objectContaining({
            kind: 'socrata', upstreamHost: 'data.calgary.ca',
            catalogUrl: 'https://data.calgary.ca/api/catalog/v1'
        }));
        expect(calgary.placeId).toBe('sgc-csd-4806016');
    });

    test('configures Edmonton and Winnipeg with independent fail-closed Socrata policies', () => {
        const edmonton = getSource('edmonton-open-data');
        const winnipeg = getSource('winnipeg-open-data');
        expect(edmonton).toEqual(expect.objectContaining({
            kind: 'socrata', upstreamHost: 'data.edmonton.ca'
        }));
        expect(winnipeg).toEqual(expect.objectContaining({
            kind: 'socrata', upstreamHost: 'data.winnipeg.ca'
        }));
        expect(edmonton.placeId).toBe('sgc-csd-4811061');
        expect(winnipeg.placeId).toBe('sgc-csd-4611040');
    });

    test('configures Hamilton as an allowlisted City publisher under its portal licence', () => {
        const hamilton = getSource('hamilton-hub');
        expect(hamilton).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'open.hamilton.ca',
            catalogUrl: 'https://open.hamilton.ca/api/feed/dcat-us/1.1.json'
        }));
        expect(hamilton.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-cd-3525', relationship: 'direct', includesDescendants: false
        })]);
    });

    test('configures Vancouver as a record-licensed Opendatasoft city source', () => {
        const vancouver = getSource('vancouver-open-data');
        expect(vancouver).toEqual(expect.objectContaining({
            kind: 'opendatasoft', upstreamHost: 'opendata.vancouver.ca',
            catalogUrl: 'https://opendata.vancouver.ca/api/explore/v2.1'
        }));
        expect(vancouver.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-5915022', relationship: 'direct', includesDescendants: false
        })]);
    });

    test('configures Ottawa as a canonical city with Police licence precedence', () => {
        const ottawa = getSource('ottawa-hub');
        expect(ottawa).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'open.ottawa.ca',
            catalogUrl: 'https://open.ottawa.ca/api/feed/dcat-us/1.1.json'
        }));
        expect(ottawa.licenseRules.length).toBeGreaterThan(0);
        expect(ottawa.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-cd-3506', relationship: 'direct', includesDescendants: false
        })]);
    });

    test('configures Surrey as an exact-publisher ArcGIS source under its portal licence', () => {
        const surrey = getSource('surrey-hub');
        expect(surrey).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'opendata-surrey.hub.arcgis.com',
            catalogUrl: 'https://opendata-surrey.hub.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(surrey.licenseRules).toEqual(expect.arrayContaining([
            expect.objectContaining({
                publisher: expect.any(RegExp),
                license: expect.objectContaining({
                    url: 'https://opendata-surrey.hub.arcgis.com/pages/open-data-licence'
                })
            })
        ]));
        expect(surrey.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-5915004', relationship: 'direct', includesDescendants: false
        })]);
    });

    test('configures Toronto as an authoritative CKAN city source', () => {
        const toronto = getSource('toronto-open-data');
        expect(toronto).toEqual(expect.objectContaining({
            kind: 'ckan', upstreamHost: 'ckan0.cf.opendata.inter.prod-toronto.ca',
            catalogUrl: 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action'
        }));
        expect(toronto.placeId).toBe('sgc-cd-3520');
    });

    test('configures Montréal as a French-first, record-licensed CKAN source', () => {
        const montreal = getSource('montreal-open-data');
        expect(montreal).toEqual(expect.objectContaining({
            kind: 'ckan', upstreamHost: 'donnees.montreal.ca',
            catalogUrl: 'https://donnees.montreal.ca/api/3/action'
        }));
        expect(montreal.placeRules).toEqual(expect.arrayContaining([expect.objectContaining({
            placeId: 'sgc-csd-2466023', relationship: 'direct', includesDescendants: false
        })]));
    });

    test('configures Québec City and Laval as filtered shared CKAN sources', () => {
        const quebec = getSource('quebec-city-open-data');
        const laval = getSource('laval-open-data');
        expect(quebec).toEqual(expect.objectContaining({
            kind: 'ckan', upstreamHost: 'www.donneesquebec.ca'
        }));
        expect(laval).toEqual(expect.objectContaining({
            kind: 'ckan', upstreamHost: 'www.donneesquebec.ca'
        }));
        expect(quebec.placeRules[0].placeId).toBe('sgc-csd-2423027');
        expect(laval.placeRules[0].placeId).toBe('sgc-cd-2465');
    });

    test('covers each direct feed without inventing a Clarington source', () => {
        const oshawa = getSource('oshawa-hub');
        const ajax = getSource('ajax-hub');
        const pickering = getSource('pickering-hub');
        const whitby = getSource('whitby-hub');
        const durham = getSource('durham-hub');

        expect(oshawa).toBeDefined();
        expect(ajax).toBeDefined();
        expect(pickering).toBeDefined();
        expect(whitby).toBeDefined();
        expect(durham).toBeDefined();

        expect(getSource('clarington-hub')).toBeNull();

        expect(oshawa.placeRules[0].placeId).toBe('ca-on-oshawa');
        expect(ajax.placeRules[0].placeId).toBe('sgc-csd-3518005');
        expect(pickering.placeRules[0].placeId).toBe('sgc-csd-3518001');
        expect(whitby.placeRules[0].placeId).toBe('sgc-csd-3518009');
        expect(durham.placeRules[0].placeId).toBe('ca-on-durham');
        expect(durham.placeRules[0].includesDescendants).toBe(true);
    });

    test('keeps Whitby fail-closed and requires explicit open-licence evidence', () => {
        const whitby = getSource('whitby-hub');
        expect(whitby.licenseRules.length).toBeGreaterThan(0);
        expect(whitby.restrictedLicensePatterns.length).toBeGreaterThan(0);
    });

    test('configures the Peel cluster with direct city and descendant regional coverage', () => {
        const mississauga = getSource('mississauga-hub');
        const brampton = getSource('brampton-hub');
        const peel = getSource('peel-hub');

        expect(mississauga.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3521005', relationship: 'direct', includesDescendants: false
        }));
        expect(brampton.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3521010', relationship: 'direct', includesDescendants: false
        }));
        expect(peel.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-cd-3521', relationship: 'direct', includesDescendants: true
        }));
    });

    test('keeps Brampton and Peel fail-closed while allowing Mississauga portal-wide terms', () => {
        const mississauga = getSource('mississauga-hub');
        const brampton = getSource('brampton-hub');
        const peel = getSource('peel-hub');

        expect(mississauga.licenseRules.length).toBeGreaterThan(0);
        expect(brampton.licenseRules.length).toBeGreaterThan(0);
        expect(peel.licenseRules.length).toBeGreaterThan(0);
    });

    test('configures Burlington, Oakville, and Milton within Halton Region', () => {
        const burlington = getSource('burlington-hub');
        const oakville = getSource('oakville-hub');
        const milton = getSource('milton-hub');

        expect(burlington.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3524002', relationship: 'direct', includesDescendants: false
        }));
        expect(oakville.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3524001', relationship: 'direct', includesDescendants: false
        }));
        expect(milton.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3524009', relationship: 'direct', includesDescendants: false
        }));
    });

    test('configures Greater Sudbury as a single-tier city source', () => {
        const sudbury = getSource('sudbury-hub');
        expect(sudbury).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'opendata.greatersudbury.ca'
        }));
        expect(sudbury.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-cd-3553', relationship: 'direct', includesDescendants: false
        }));
    });

    test('configures Burnaby and Saskatoon as standalone municipal sources', () => {
        const burnaby = getSource('burnaby-hub');
        const saskatoon = getSource('saskatoon-hub');

        expect(burnaby.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-5915025', relationship: 'direct', includesDescendants: false
        }));
        expect(saskatoon.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-4711066', relationship: 'direct', includesDescendants: false
        }));
    });

    test('configures Markham and Newmarket within York Region', () => {
        const markham = getSource('markham-hub');
        const newmarket = getSource('newmarket-hub');

        expect(markham.placeRules).toEqual(expect.arrayContaining([expect.objectContaining({
            placeId: 'sgc-csd-3519036', relationship: 'direct', includesDescendants: false
        })]));
        expect(newmarket.placeRules).toEqual(expect.arrayContaining([expect.objectContaining({
            placeId: 'sgc-csd-3519048', relationship: 'direct', includesDescendants: false
        })]));
    });

    test('configures Niagara Falls and Welland within Niagara Region', () => {
        const niagaraFalls = getSource('niagara-falls-hub');
        const welland = getSource('welland-hub');

        expect(niagaraFalls.placeRules).toEqual(expect.arrayContaining([expect.objectContaining({
            placeId: 'sgc-csd-3526043', relationship: 'direct', includesDescendants: false
        })]));
        expect(welland.placeRules).toEqual(expect.arrayContaining([expect.objectContaining({
            placeId: 'sgc-csd-3526032', relationship: 'direct', includesDescendants: false
        })]));
    });

    test('configures Moncton, Guelph, Saanich, and Belleville sources', () => {
        const moncton = getSource('moncton-hub');
        const guelph = getSource('guelph-hub');
        const saanich = getSource('saanich-hub');
        const belleville = getSource('belleville-hub');

        expect(moncton).toEqual(expect.objectContaining({
            kind: 'arcgis-hub',
            upstreamHost: 'open.moncton.ca'
        }));
        expect(moncton.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-1307022', relationship: 'direct', includesDescendants: false
        }));

        expect(guelph).toEqual(expect.objectContaining({
            kind: 'arcgis-hub',
            upstreamHost: 'geodatahub-cityofguelph.opendata.arcgis.com'
        }));
        expect(guelph.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3523008', relationship: 'direct', includesDescendants: false
        }));

        expect(saanich).toEqual(expect.objectContaining({
            kind: 'arcgis-hub',
            upstreamHost: 'opendata-saanich.hub.arcgis.com'
        }));
        expect(saanich.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-5917021', relationship: 'direct', includesDescendants: false
        }));

        expect(belleville).toEqual(expect.objectContaining({
            kind: 'arcgis-hub',
            upstreamHost: 'opendata-bellevillegis.hub.arcgis.com'
        }));
        expect(belleville.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3512005', relationship: 'direct', includesDescendants: false
        }));
    });

    test('configures Yellowknife, Barrie, Thunder Bay, Chatham-Kent, Kawartha Lakes, Summerland, Norfolk, and Haldimand sources', () => {
        const yellowknife = getSource('yellowknife-hub');
        const barrie = getSource('barrie-hub');
        const thunderbay = getSource('thunderbay-hub');
        const chathamKent = getSource('chatham-kent-hub');
        const kawarthaLakes = getSource('kawartha-lakes-hub');
        const summerland = getSource('summerland-hub');
        const norfolk = getSource('norfolk-hub');
        const haldimand = getSource('haldimand-hub');

        expect(yellowknife).toEqual(expect.objectContaining({
            kind: 'arcgis-hub',
            upstreamHost: 'data-yellowknife.hub.arcgis.com'
        }));
        expect(yellowknife.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-6106023', relationship: 'direct', includesDescendants: false
        }));

        expect(barrie).toEqual(expect.objectContaining({
            kind: 'arcgis-hub',
            upstreamHost: 'opendata.barrie.ca'
        }));
        expect(barrie.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3543042', relationship: 'direct', includesDescendants: false
        }));

        expect(thunderbay).toEqual(expect.objectContaining({
            kind: 'arcgis-hub',
            upstreamHost: 'opendata-thunderbay.hub.arcgis.com'
        }));
        expect(thunderbay.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3558004', relationship: 'direct', includesDescendants: false
        }));

        expect(chathamKent).toEqual(expect.objectContaining({
            kind: 'arcgis-hub',
            upstreamHost: 'opendata.chatham-kent.ca'
        }));
        expect(chathamKent.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-cd-3536', relationship: 'direct', includesDescendants: false
        }));

        expect(kawarthaLakes).toEqual(expect.objectContaining({
            kind: 'arcgis-hub',
            upstreamHost: 'open-data-kawartha.hub.arcgis.com'
        }));
        expect(kawarthaLakes.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-cd-3516', relationship: 'direct', includesDescendants: false
        }));

        expect(summerland).toEqual(expect.objectContaining({
            kind: 'arcgis-hub',
            upstreamHost: 'open-data-summerland.hub.arcgis.com'
        }));
        expect(summerland.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-5907035', relationship: 'direct', includesDescendants: false
        }));

        expect(norfolk).toEqual(expect.objectContaining({
            kind: 'arcgis-hub',
            upstreamHost: 'data-norfolk.opendata.arcgis.com'
        }));
        expect(norfolk.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3528052', relationship: 'direct', includesDescendants: false
        }));

        expect(haldimand).toEqual(expect.objectContaining({
            kind: 'arcgis-hub',
            upstreamHost: 'opendata-haldimand.hub.arcgis.com'
        }));
        expect(haldimand.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3528018', relationship: 'direct', includesDescendants: false
        }));
    });

    test('configures v32 multi-province sources with official licences and direct place rules', () => {
        const lethbridge = getSource('lethbridge-hub');
        const medicineHat = getSource('medicine-hat-hub');
        const airdrie = getSource('airdrie-hub');
        const canmore = getSource('canmore-hub');
        const penticton = getSource('penticton-hub');
        const langleyCity = getSource('langley-city-hub');
        const huron = getSource('huron-hub');
        const cumberland = getSource('cumberland-hub');

        expect(lethbridge).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'opendata.lethbridge.ca',
            catalogUrl: 'https://opendata.lethbridge.ca/api/feed/dcat-us/1.1.json'
        }));
        expect(lethbridge.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-4802012', relationship: 'direct', includesDescendants: false
        })]);

        expect(medicineHat).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'opendata.medicinehat.ca',
            catalogUrl: 'https://opendata.medicinehat.ca/api/feed/dcat-us/1.1.json'
        }));
        expect(medicineHat.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-4801006', relationship: 'direct', includesDescendants: false
        })]);

        expect(airdrie).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-airdrie.opendata.arcgis.com',
            catalogUrl: 'https://data-airdrie.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(airdrie.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-4806021', relationship: 'direct', includesDescendants: false
        })]);

        expect(canmore).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'opendata-canmore.opendata.arcgis.com',
            catalogUrl: 'https://opendata-canmore.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(canmore.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-4815023', relationship: 'direct', includesDescendants: false
        })]);

        expect(penticton).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'open.penticton.ca',
            catalogUrl: 'https://open.penticton.ca/api/feed/dcat-us/1.1.json'
        }));
        expect(penticton.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-5907041', relationship: 'direct', includesDescendants: false
        })]);

        expect(langleyCity).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-langleycity.opendata.arcgis.com',
            catalogUrl: 'https://data-langleycity.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(langleyCity.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-5915001', relationship: 'direct', includesDescendants: false
        })]);

        expect(huron).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-huron.opendata.arcgis.com',
            catalogUrl: 'https://data-huron.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(huron.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-cd-3540', relationship: 'direct', includesDescendants: true
        })]);

        expect(cumberland).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-cumberlandns.opendata.arcgis.com',
            catalogUrl: 'https://data-cumberlandns.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(cumberland.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-cd-1211', relationship: 'direct', includesDescendants: true
        })]);
    });

    test('configures v33 Quebec and Atlantic Canada sources with official licences and direct place rules', () => {
        const expectedSources = [
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

        for (const item of expectedSources) {
            const source = getSource(item.id);
            expect(source).toBeDefined();
            expect(source.kind).toBe('ckan');
            expect(source.upstreamHost).toBe('www.donneesquebec.ca');
            expect(source.catalogOrganization).toBe(item.org);
            expect(source.placeRules[0].placeId).toBe(item.placeId);
            expect(source.placeRules[0].relationship).toBe('direct');
            expect(source.defaultOrganizationTitleFr).toBeDefined();
        }

        const saintJohn = getSource('saint-john-hub');
        expect(saintJohn).toBeDefined();
        expect(saintJohn.kind).toBe('arcgis-hub');
        expect(saintJohn.upstreamHost).toBe('catalogue-saintjohn.opendata.arcgis.com');
        expect(saintJohn.placeRules[0].placeId).toBe('sgc-csd-1301006');
        expect(saintJohn.placeRules[0].relationship).toBe('direct');
        expect(saintJohn.licenseRules[0].license.titleEn).toBe('Open Government Licence – City of Saint John');
    });

    test('configures v34 capital cities and municipal expansion sources with official licences and direct place rules', () => {
        const whitehorse = getSource('whitehorse-hub');
        const stJohns = getSource('st-johns-hub');
        const charlottetown = getSource('charlottetown-hub');
        const regina = getSource('regina-hub');
        const windsor = getSource('windsor-hub');
        const kingston = getSource('kingston-hub');
        const redDeer = getSource('red-deer-hub');
        const kamloops = getSource('kamloops-hub');
        const nanaimo = getSource('nanaimo-hub');
        const abbotsford = getSource('abbotsford-hub');

        expect(whitehorse).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-whitehorse.opendata.arcgis.com',
            catalogUrl: 'https://data-whitehorse.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(whitehorse.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-6001009', relationship: 'direct', includesDescendants: false
        })]);

        expect(stJohns).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'map-stjohns.opendata.arcgis.com',
            catalogUrl: 'https://map-stjohns.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(stJohns.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-1001519', relationship: 'direct', includesDescendants: false
        })]);

        expect(charlottetown).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'city-charlottetown.opendata.arcgis.com',
            catalogUrl: 'https://city-charlottetown.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(charlottetown.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-1102075', relationship: 'direct', includesDescendants: false
        })]);

        expect(regina).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'open-regina.hub.arcgis.com',
            catalogUrl: 'https://open-regina.hub.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(regina.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-4706027', relationship: 'direct', includesDescendants: false
        })]);

        expect(windsor).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'opendata.citywindsor.ca',
            catalogUrl: 'https://opendata.citywindsor.ca/api/feed/dcat-us/1.1.json'
        }));
        expect(windsor.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-3537039', relationship: 'direct', includesDescendants: false
        })]);

        expect(kingston).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data.cityofkingston.ca',
            catalogUrl: 'https://data.cityofkingston.ca/api/feed/dcat-us/1.1.json'
        }));
        expect(kingston.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-3510010', relationship: 'direct', includesDescendants: false
        })]);

        expect(redDeer).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-reddeer.opendata.arcgis.com',
            catalogUrl: 'https://data-reddeer.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(redDeer.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-4808011', relationship: 'direct', includesDescendants: false
        })]);

        expect(kamloops).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-kamloops.opendata.arcgis.com',
            catalogUrl: 'https://data-kamloops.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(kamloops.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-5933042', relationship: 'direct', includesDescendants: false
        })]);

        expect(nanaimo).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-nanaimo.opendata.arcgis.com',
            catalogUrl: 'https://data-nanaimo.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(nanaimo.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-5921007', relationship: 'direct', includesDescendants: false
        })]);

        expect(abbotsford).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-abbotsford.opendata.arcgis.com',
            catalogUrl: 'https://data-abbotsford.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(abbotsford.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-5909052', relationship: 'direct', includesDescendants: false
        })]);
    });
});
