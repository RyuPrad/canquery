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
        expect(waterloo.publisherAliases).toHaveLength(20);
        expect(waterloo.authoritativePublishers).toHaveLength(20);
        expect(waterloo.licenseRules).toHaveLength(4);
        expect(waterloo.placeRules).toHaveLength(8);
        expect(waterloo.placeRules).toEqual(expect.arrayContaining([
            expect.objectContaining({ placeId: 'sgc-cd-3530', relationship: 'direct', includesDescendants: true }),
            expect.objectContaining({ placeId: 'sgc-csd-3530013', relationship: 'direct', includesDescendants: false }),
            expect.objectContaining({ placeId: 'sgc-csd-3530010', relationship: 'direct', includesDescendants: false }),
            expect.objectContaining({ placeId: 'sgc-csd-3530016', relationship: 'direct', includesDescendants: false })
        ]));
    });

    test('configures London as a City publisher ArcGIS hub resolving item owners', () => {
        const london = getSource('london-hub');
        expect(london).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-london.opendata.arcgis.com',
            catalogUrl: 'https://data-london.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(london.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp),
            license: expect.objectContaining({
                url: 'https://data-london.opendata.arcgis.com/pages/terms-of-use'
            })
        })]);
        expect(london.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-3539036', relationship: 'direct',
            includesDescendants: false
        })]);
    });

    test('configures Kelowna as an exact-publisher ArcGIS source under its portal licence', () => {
        const kelowna = getSource('kelowna-hub');
        expect(kelowna).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-kelowna.opendata.arcgis.com',
            catalogUrl: 'https://data-kelowna.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(kelowna.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp),
            license: expect.objectContaining({
                url: 'https://data-kelowna.opendata.arcgis.com/pages/licence'
            })
        })]);
        expect(kelowna.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-5935010', relationship: 'direct',
            includesDescendants: false
        })]);
    });

    test('configures Fredericton as an exact-publisher ArcGIS source under its portal licence', () => {
        const fredericton = getSource('fredericton-hub');
        expect(fredericton).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-fredericton.opendata.arcgis.com',
            catalogUrl: 'https://data-fredericton.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(fredericton.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp),
            license: expect.objectContaining({
                url: 'https://data-fredericton.opendata.arcgis.com/pages/open-government-licence-fredericton'
            })
        })]);
        expect(fredericton.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-1310032', relationship: 'direct',
            includesDescendants: false
        })]);
    });

    test('configures Halifax as an exact-publisher ArcGIS source under its portal licence', () => {
        const halifax = getSource('halifax-hub');
        expect(halifax).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'catalogue-hrm.opendata.arcgis.com',
            catalogUrl: 'https://catalogue-hrm.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(halifax.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp),
            license: expect.objectContaining({
                url: 'https://www.halifax.ca/home/open-data/open-data-licence'
            })
        })]);
        expect(halifax.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-1209034', relationship: 'direct',
            includesDescendants: false
        })]);
    });

    test('configures Calgary as a strict record-licensed Socrata city source', () => {
        const calgary = getSource('calgary-open-data');
        expect(calgary).toEqual(expect.objectContaining({
            kind: 'socrata', upstreamHost: 'data.calgary.ca',
            catalogUrl: 'https://data.calgary.ca/api/views',
            vectorTileMaps: true
        }));
        expect(calgary.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp),
            licenseId: 'Open Government Licence - City of Calgary',
            licenseUrl: 'https://data.calgary.ca/stories/s/Open-Calgary-Terms-of-Use/u45n-7awa/'
        })]);
        expect(calgary.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-4806016', relationship: 'direct',
            includesDescendants: false
        })]);
    });

    test('configures Edmonton and Winnipeg with independent fail-closed Socrata policies', () => {
        const edmonton = getSource('edmonton-open-data');
        const winnipeg = getSource('winnipeg-open-data');

        expect(edmonton).toEqual(expect.objectContaining({
            kind: 'socrata', upstreamHost: 'data.edmonton.ca',
            vectorTileMaps: true, licenseMode: 'portal-wide'
        }));
        expect(edmonton.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp),
            license: expect.objectContaining({
                url: 'https://data.edmonton.ca/stories/s/City-of-Edmonton-Open-Data-Terms-of-Use/msh8-if28/'
            })
        })]);
        expect(edmonton.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-4811061', relationship: 'direct', includesDescendants: false
        })]);

        expect(winnipeg).toEqual(expect.objectContaining({
            kind: 'socrata', upstreamHost: 'data.winnipeg.ca',
            vectorTileMaps: true, licenseMode: 'record-explicit'
        }));
        expect(winnipeg.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp),
            licenseId: 'Open Government Licence – Winnipeg',
            licenseUrl: 'https://data.winnipeg.ca/stories/s/Open-Data-Terms-of-Use/e5c6-c956/'
        })]);
        expect(winnipeg.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-4611040', relationship: 'direct', includesDescendants: false
        })]);
    });

    test('configures Hamilton as an allowlisted City publisher under its portal licence', () => {
        const hamilton = getSource('hamilton-hub');
        expect(hamilton).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'open.hamilton.ca',
            catalogUrl: 'https://open.hamilton.ca/api/feed/dcat-us/1.1.json'
        }));
        expect(hamilton.publisherAliases).toHaveLength(14);
        expect(hamilton.authoritativePublishers).toHaveLength(14);
        expect(hamilton.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp),
            license: expect.objectContaining({
                url: 'https://open.hamilton.ca/pages/open-data-licence'
            })
        })]);
        expect(hamilton.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-cd-3525', relationship: 'direct', includesDescendants: false
        })]);
    });

    test('configures Vancouver as a record-licensed Opendatasoft city source', () => {
        const vancouver = getSource('vancouver-open-data');
        expect(vancouver).toEqual(expect.objectContaining({
            kind: 'opendatasoft', upstreamHost: 'opendata.vancouver.ca',
            catalogUrl: 'https://opendata.vancouver.ca/api/explore/v2.1/catalog/datasets',
            directGeoJsonMaps: true, licenseMode: 'record-explicit'
        }));
        expect(vancouver.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp),
            licenseId: 'Open Government Licence - Vancouver',
            licenseUrl: 'https://opendata.vancouver.ca/pages/licence/'
        })]);
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
        expect(ottawa.licenseRules).toHaveLength(2);
        expect(ottawa.licenseRules[0].license.url).toBe('https://data.ottawapolice.ca/pages/open-data-licence');
        expect(ottawa.licenseRules[1].license.url).toBe(
            'https://ottawa.ca/en/city-hall/open-transparent-and-accountable-government/open-data/open-data-licence-version-20'
        );
        expect(ottawa.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-cd-3506', relationship: 'direct', includesDescendants: false
        })]);
    });

    test('configures Surrey as an exact-publisher ArcGIS source under its portal licence', () => {
        const surrey = getSource('surrey-hub');
        expect(surrey).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data.surrey.ca',
            catalogUrl: 'https://data.surrey.ca/api/feed/dcat-us/1.1.json'
        }));
        expect(surrey.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp),
            license: expect.objectContaining({
                url: 'https://data.surrey.ca/pages/open-government-licence-surrey'
            })
        })]);
        expect(surrey.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-5915004', relationship: 'direct', includesDescendants: false
        })]);
    });

    test('configures Toronto as an authoritative CKAN city source', () => {
        const toronto = getSource('toronto-open-data');
        expect(toronto).toEqual(expect.objectContaining({
            kind: 'ckan', upstreamHost: 'ckan0.cf.opendata.inter.prod-toronto.ca',
            catalogUrl: 'https://ckan0.cf.opendata.inter.prod-toronto.ca/api/3/action',
            datastoreProxy: true
        }));
        expect(toronto.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp),
            licenseId: 'Open Government Licence – Toronto',
            licenseUrl: 'https://open.toronto.ca/open-data-licence/'
        })]);
        expect(toronto.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-cd-3520', relationship: 'direct', includesDescendants: false
        })]);
    });

    test('configures Montréal as a French-first, record-licensed CKAN source', () => {
        const montreal = getSource('montreal-open-data');
        expect(montreal).toEqual(expect.objectContaining({
            kind: 'ckan', upstreamHost: 'donnees.montreal.ca',
            catalogUrl: 'https://donnees.montreal.ca/api/3/action',
            metadataLanguage: 'fr', directGeoJsonMaps: true,
            licenseMode: 'record-explicit'
        }));
        expect(montreal.licenseRules).toHaveLength(2);
        expect(montreal.licenseRules[0]).toEqual(expect.objectContaining({
            licenseId: 'cc-by', licenseUrl: 'https://creativecommons.org/licenses/by/4.0/'
        }));
        expect(montreal.licenseRules[1]).toEqual(expect.objectContaining({
            licenseId: 'ca-ogl-lgo', licenseUrl: 'https://open.canada.ca/en/open-government-licence-canada'
        }));
        expect(montreal.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-2466023', relationship: 'direct', includesDescendants: false
        })]);
    });

    test('configures Québec City and Laval as filtered shared CKAN sources', () => {
        const quebec = getSource('quebec-city-open-data');
        const laval = getSource('laval-open-data');

        expect(quebec).toEqual(expect.objectContaining({
            kind: 'ckan', upstreamHost: 'www.donneesquebec.ca',
            catalogOrganization: 'ville-de-quebec', metadataLanguage: 'fr',
            directGeoJsonMaps: true, licenseMode: 'record-explicit'
        }));
        expect(quebec.authoritativePublishers).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp)
        })]);
        expect(quebec.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp), licenseId: 'cc-by',
            licenseUrl: 'https://www.donneesquebec.ca/licence/#cc-by'
        })]);
        expect(quebec.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-2423027', relationship: 'direct', includesDescendants: false
        })]);

        expect(laval).toEqual(expect.objectContaining({
            kind: 'ckan', upstreamHost: 'www.donneesquebec.ca',
            catalogOrganization: 'ville-de-laval', metadataLanguage: 'fr',
            directGeoJsonMaps: true, licenseMode: 'record-explicit'
        }));
        expect(laval.authoritativePublishers).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp)
        })]);
        expect(laval.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp), licenseId: 'cc-by',
            licenseUrl: 'https://www.donneesquebec.ca/licence/#cc-by'
        })]);
        expect(laval.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-cd-2465', relationship: 'direct', includesDescendants: false
        })]);
    });

    test('covers each direct feed without inventing a Clarington source', () => {
        const oshawa = getSource('oshawa-hub');
        const ajax = getSource('ajax-hub');
        const pickering = getSource('pickering-hub');
        const whitby = getSource('whitby-hub');
        const durham = getSource('durham-hub');

        expect(oshawa).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-oshawa.opendata.arcgis.com',
            catalogUrl: 'https://data-oshawa.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(ajax).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'townofajax.maps.arcgis.com',
            catalogUrl: 'https://townofajax.maps.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(pickering).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-pickering.opendata.arcgis.com',
            catalogUrl: 'https://data-pickering.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(whitby).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'whitby.maps.arcgis.com',
            catalogUrl: 'https://whitby.maps.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(durham).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'opendata.durham.ca',
            catalogUrl: 'https://opendata.durham.ca/api/feed/dcat-us/1.1.json'
        }));

        expect(getSource('clarington-hub')).toBeNull();
    });

    test('keeps Whitby fail-closed and requires explicit open-licence evidence', () => {
        const whitby = getSource('whitby-hub');
        expect(whitby.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp),
            license: expect.objectContaining({
                url: 'https://whitby.maps.arcgis.com/sharing/rest/content/items/223810efc31c40b3aff99dd74f809a97/data'
            })
        })]);
    });

    test('configures the Peel cluster with direct city and descendant regional coverage', () => {
        const mississauga = getSource('mississauga-hub');
        const brampton = getSource('brampton-hub');
        const peel = getSource('peel-hub');

        expect(mississauga.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-3521005', relationship: 'direct', includesDescendants: false
        })]);
        expect(brampton.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-3521010', relationship: 'direct', includesDescendants: false
        })]);
        expect(peel.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-cd-3521', relationship: 'direct', includesDescendants: true
        })]);
    });

    test('keeps Brampton and Peel fail-closed while allowing Mississauga portal-wide terms', () => {
        const mississauga = getSource('mississauga-hub');
        const brampton = getSource('brampton-hub');
        const peel = getSource('peel-hub');

        expect(mississauga.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp),
            license: expect.objectContaining({
                url: 'https://data.mississauga.ca/pages/terms-of-use'
            })
        })]);
        expect(brampton.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp),
            license: expect.objectContaining({
                url: 'https://www.ontario.ca/page/open-government-licence-ontario'
            })
        })]);
        expect(peel.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp),
            license: expect.objectContaining({
                url: 'https://data.peelregion.ca/pages/terms-of-use'
            })
        })]);
    });

    test('configures Burlington, Oakville, and Milton within Halton Region', () => {
        const burlington = getSource('burlington-hub');
        const oakville = getSource('oakville-hub');
        const milton = getSource('milton-hub');

        expect(burlington).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'navigatenew-burlington.opendata.arcgis.com',
            catalogUrl: 'https://navigatenew-burlington.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(burlington.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-3524002', relationship: 'direct', includesDescendants: false
        })]);

        expect(oakville).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-oakville.opendata.arcgis.com',
            catalogUrl: 'https://data-oakville.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(oakville.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-3524001', relationship: 'direct', includesDescendants: false
        })]);

        expect(milton).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-milton.opendata.arcgis.com',
            catalogUrl: 'https://data-milton.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(milton.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-3524009', relationship: 'direct', includesDescendants: false
        })]);
    });

    test('configures Greater Sudbury as a single-tier city source', () => {
        const sudbury = getSource('sudbury-hub');
        expect(sudbury).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-greatersudbury.opendata.arcgis.com',
            catalogUrl: 'https://data-greatersudbury.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(sudbury.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-cd-3553', relationship: 'direct', includesDescendants: false
        })]);
    });

    test('configures Burnaby and Saskatoon as standalone municipal sources', () => {
        const burnaby = getSource('burnaby-hub');
        const saskatoon = getSource('saskatoon-hub');

        expect(burnaby).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-burnaby.opendata.arcgis.com',
            catalogUrl: 'https://data-burnaby.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(burnaby.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-5915025', relationship: 'direct', includesDescendants: false
        })]);

        expect(saskatoon).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-saskatoon.opendata.arcgis.com',
            catalogUrl: 'https://data-saskatoon.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(saskatoon.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-4711066', relationship: 'direct', includesDescendants: false
        })]);
    });

    test('configures Markham and Newmarket within York Region', () => {
        const markham = getSource('markham-hub');
        const newmarket = getSource('newmarket-hub');

        expect(markham).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-markham.opendata.arcgis.com',
            catalogUrl: 'https://data-markham.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(markham.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-3519036', relationship: 'direct', includesDescendants: false
        })]);

        expect(newmarket).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-newmarket.opendata.arcgis.com',
            catalogUrl: 'https://data-newmarket.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(newmarket.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-3519048', relationship: 'direct', includesDescendants: false
        })]);
    });

    test('configures Niagara Falls and Welland within Niagara Region', () => {
        const niagaraFalls = getSource('niagara-falls-hub');
        const welland = getSource('welland-hub');

        expect(niagaraFalls).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-niagarafalls.opendata.arcgis.com',
            catalogUrl: 'https://data-niagarafalls.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(niagaraFalls.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-3526043', relationship: 'direct', includesDescendants: false
        })]);

        expect(welland).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-welland.opendata.arcgis.com',
            catalogUrl: 'https://data-welland.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(welland.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-3526032', relationship: 'direct', includesDescendants: false
        })]);
    });

    test('configures Moncton, Guelph, Saanich, and Belleville sources', () => {
        const moncton = getSource('moncton-hub');
        const guelph = getSource('guelph-hub');
        const saanich = getSource('saanich-hub');
        const belleville = getSource('belleville-hub');

        expect(moncton).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-moncton.opendata.arcgis.com',
            catalogUrl: 'https://data-moncton.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(moncton.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-1307022', relationship: 'direct', includesDescendants: false
        })]);

        expect(guelph).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-guelph.opendata.arcgis.com',
            catalogUrl: 'https://data-guelph.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(guelph.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-3523008', relationship: 'direct', includesDescendants: false
        })]);

        expect(saanich).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-saanich.opendata.arcgis.com',
            catalogUrl: 'https://data-saanich.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(saanich.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-5917021', relationship: 'direct', includesDescendants: false
        })]);

        expect(belleville).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-belleville.opendata.arcgis.com',
            catalogUrl: 'https://data-belleville.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(belleville.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-3512005', relationship: 'direct', includesDescendants: false
        })]);
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
            kind: 'arcgis-hub', upstreamHost: 'data-yellowknife.opendata.arcgis.com',
            catalogUrl: 'https://data-yellowknife.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(yellowknife.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-6106023', relationship: 'direct', includesDescendants: false
        })]);

        expect(barrie).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-barrie.opendata.arcgis.com',
            catalogUrl: 'https://data-barrie.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(barrie.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-3543042', relationship: 'direct', includesDescendants: false
        })]);

        expect(thunderbay).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-thunderbay.opendata.arcgis.com',
            catalogUrl: 'https://data-thunderbay.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(thunderbay.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-3558004', relationship: 'direct', includesDescendants: false
        })]);

        expect(chathamKent).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-chatham-kent.opendata.arcgis.com',
            catalogUrl: 'https://data-chatham-kent.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(chathamKent.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-cd-3536', relationship: 'direct', includesDescendants: false
        })]);

        expect(kawarthaLakes).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-kawarthalakes.opendata.arcgis.com',
            catalogUrl: 'https://data-kawarthalakes.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(kawarthaLakes.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-cd-3516', relationship: 'direct', includesDescendants: false
        })]);

        expect(summerland).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-summerland.opendata.arcgis.com',
            catalogUrl: 'https://data-summerland.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(summerland.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-5907035', relationship: 'direct', includesDescendants: false
        })]);

        expect(norfolk).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-norfolk.opendata.arcgis.com',
            catalogUrl: 'https://data-norfolk.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(norfolk.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-3528052', relationship: 'direct', includesDescendants: false
        })]);

        expect(haldimand).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-haldimand.opendata.arcgis.com',
            catalogUrl: 'https://data-haldimand.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(haldimand.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-3528018', relationship: 'direct', includesDescendants: false
        })]);
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
            kind: 'arcgis-hub', upstreamHost: 'data-lethbridge.opendata.arcgis.com',
            catalogUrl: 'https://data-lethbridge.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(lethbridge.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-4802012', relationship: 'direct', includesDescendants: false
        })]);

        expect(medicineHat).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-medicinehat.opendata.arcgis.com',
            catalogUrl: 'https://data-medicinehat.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
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
            kind: 'arcgis-hub', upstreamHost: 'data-canmore.opendata.arcgis.com',
            catalogUrl: 'https://data-canmore.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(canmore.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-4815023', relationship: 'direct', includesDescendants: false
        })]);

        expect(penticton).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-penticton.opendata.arcgis.com',
            catalogUrl: 'https://data-penticton.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
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
        const gatineau = getSource('gatineau-open-data');
        const troisRivieres = getSource('trois-rivieres-open-data');
        const repentigny = getSource('repentigny-open-data');
        const longueuil = getSource('longueuil-open-data');
        const saguenay = getSource('saguenay-open-data');
        const rimouski = getSource('rimouski-open-data');
        const shawinigan = getSource('shawinigan-open-data');
        const levis = getSource('levis-open-data');
        const sherbrooke = getSource('sherbrooke-open-data');
        const saintJohn = getSource('saint-john-hub');

        expect(gatineau).toEqual(expect.objectContaining({
            kind: 'ckan', upstreamHost: 'www.donneesquebec.ca',
            catalogOrganization: 'ville-de-gatineau', metadataLanguage: 'fr',
            directGeoJsonMaps: true, licenseMode: 'record-explicit'
        }));
        expect(gatineau.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-2481017', relationship: 'direct', includesDescendants: false
        })]);

        expect(troisRivieres).toEqual(expect.objectContaining({
            kind: 'ckan', upstreamHost: 'www.donneesquebec.ca',
            catalogOrganization: 'ville-de-trois-rivieres', metadataLanguage: 'fr',
            directGeoJsonMaps: true, licenseMode: 'record-explicit'
        }));
        expect(troisRivieres.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-2437067', relationship: 'direct', includesDescendants: false
        })]);

        expect(repentigny).toEqual(expect.objectContaining({
            kind: 'ckan', upstreamHost: 'www.donneesquebec.ca',
            catalogOrganization: 'ville-de-repentigny', metadataLanguage: 'fr',
            directGeoJsonMaps: true, licenseMode: 'record-explicit'
        }));
        expect(repentigny.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-2460013', relationship: 'direct', includesDescendants: false
        })]);

        expect(longueuil).toEqual(expect.objectContaining({
            kind: 'ckan', upstreamHost: 'www.donneesquebec.ca',
            catalogOrganization: 'ville-de-longueuil', metadataLanguage: 'fr',
            directGeoJsonMaps: true, licenseMode: 'record-explicit'
        }));
        expect(longueuil.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-2458227', relationship: 'direct', includesDescendants: false
        })]);

        expect(saguenay).toEqual(expect.objectContaining({
            kind: 'ckan', upstreamHost: 'www.donneesquebec.ca',
            catalogOrganization: 'ville-de-saguenay', metadataLanguage: 'fr',
            directGeoJsonMaps: true, licenseMode: 'record-explicit'
        }));
        expect(saguenay.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-2494068', relationship: 'direct', includesDescendants: false
        })]);

        expect(rimouski).toEqual(expect.objectContaining({
            kind: 'ckan', upstreamHost: 'www.donneesquebec.ca',
            catalogOrganization: 'ville-de-rimouski', metadataLanguage: 'fr',
            directGeoJsonMaps: true, licenseMode: 'record-explicit'
        }));
        expect(rimouski.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-2410043', relationship: 'direct', includesDescendants: false
        })]);

        expect(shawinigan).toEqual(expect.objectContaining({
            kind: 'ckan', upstreamHost: 'www.donneesquebec.ca',
            catalogOrganization: 'ville-de-shawinigan', metadataLanguage: 'fr',
            directGeoJsonMaps: true, licenseMode: 'record-explicit'
        }));
        expect(shawinigan.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-2436033', relationship: 'direct', includesDescendants: false
        })]);

        expect(levis).toEqual(expect.objectContaining({
            kind: 'ckan', upstreamHost: 'www.donneesquebec.ca',
            catalogOrganization: 'ville-de-levis', metadataLanguage: 'fr',
            directGeoJsonMaps: true, licenseMode: 'record-explicit'
        }));
        expect(levis.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-2425213', relationship: 'direct', includesDescendants: false
        })]);

        expect(sherbrooke).toEqual(expect.objectContaining({
            kind: 'ckan', upstreamHost: 'www.donneesquebec.ca',
            catalogOrganization: 'ville-de-sherbrooke', metadataLanguage: 'fr',
            directGeoJsonMaps: true, licenseMode: 'record-explicit'
        }));
        expect(sherbrooke.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-2443027', relationship: 'direct', includesDescendants: false
        })]);

        expect(saintJohn).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'catalogue-saintjohn.opendata.arcgis.com',
            catalogUrl: 'https://catalogue-saintjohn.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(saintJohn.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-1301006', relationship: 'direct', includesDescendants: false
        })]);
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
