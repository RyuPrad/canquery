const { sources, getSource } = require('../config/catalogSources');

describe('configured municipal catalogue sources', () => {
    test('syncs city portals before the authoritative portal in each regional cluster', () => {
        expect(sources.map(source => source.id)).toEqual([
            'toronto-open-data', 'montreal-open-data', 'quebec-city-open-data', 'laval-open-data',
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
            'summerland-hub', 'norfolk-hub', 'haldimand-hub'
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
            expect.objectContaining({ placeId: 'sgc-csd-3530010', relationship: 'direct', includesDescendants: false }),
            expect.objectContaining({ placeId: 'sgc-csd-3530016', relationship: 'direct', includesDescendants: false })
        ]));
    });

    test('configures London as a City publisher ArcGIS hub resolving item owners', () => {
        const london = getSource('london-hub');
        expect(london).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'open-london.opendata.arcgis.com',
            catalogUrl: 'https://open-london.opendata.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(london.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp),
            license: expect.objectContaining({
                url: 'https://open.london.ca/pages/open-data-licence'
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
            kind: 'arcgis-hub', upstreamHost: 'opendata.kelowna.ca',
            catalogUrl: 'https://opendata.kelowna.ca/api/feed/dcat-us/1.1.json'
        }));
        expect(kelowna.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp),
            license: expect.objectContaining({
                titleEn: 'Open Government Licence – City of Kelowna'
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
                url: 'https://data-fredericton.opendata.arcgis.com/pages/open-data-licence'
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
            kind: 'arcgis-hub', upstreamHost: 'data-hrm.hub.arcgis.com',
            catalogUrl: 'https://data-hrm.hub.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(halifax.restrictedLicensePatterns).toEqual(expect.arrayContaining([
            expect.any(RegExp)
        ]));
        expect(halifax.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp),
            license: expect.objectContaining({
                url: 'https://data-hrm.hub.arcgis.com/pages/open-data-licence'
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
            placeId: 'sgc-csd-4806016',
            defaultLicenseUrl: expect.stringContaining('Open-Calgary-Terms-of-Use')
        }));
        expect(calgary.socrataPolicy).toEqual({
            publisher: expect.objectContaining({
                mode: 'custom-field', allowed: ['The City of Calgary']
            }),
            license: expect.objectContaining({
                mode: 'custom-field', comparison: 'url',
                allowed: expect.arrayContaining([expect.stringContaining('Open-Data-Terms')])
            })
        });
    });

    test('configures Edmonton and Winnipeg with independent fail-closed Socrata policies', () => {
        const edmonton = getSource('edmonton-open-data');
        const winnipeg = getSource('winnipeg-open-data');

        expect(edmonton).toEqual(expect.objectContaining({
            kind: 'socrata', upstreamHost: 'data.edmonton.ca',
            placeId: 'sgc-csd-4811061',
            defaultLicenseUrl: expect.stringContaining('City-of-Edmonton-Open-Data-Terms-of-Use')
        }));
        expect(edmonton.socrataPolicy).toEqual({
            publisher: expect.objectContaining({
                mode: 'attribution',
                allowed: ['City of Edmonton', 'The City of Edmonton']
            }),
            license: expect.objectContaining({
                mode: 'view-license-name', allowed: ['See Terms of Use']
            })
        });

        expect(winnipeg).toEqual(expect.objectContaining({
            kind: 'socrata', upstreamHost: 'data.winnipeg.ca',
            placeId: 'sgc-csd-4611040',
            defaultLicenseUrl: 'https://data.winnipeg.ca/open-data-licence'
        }));
        expect(winnipeg.socrataPolicy.publisher).toEqual(expect.objectContaining({
            mode: 'attribution', allowBlank: true,
            allowed: expect.arrayContaining(['City of Winnipeg', 'Winnipeg Transit'])
        }));
        expect(winnipeg.socrataPolicy.license).toEqual(expect.objectContaining({
            mode: 'custom-field', section: 'Licence', field: 'Licence',
            allowed: ['Open Government Licence - Winnipeg']
        }));
    });

    test('configures Hamilton as an allowlisted City publisher under its portal licence', () => {
        const hamilton = getSource('hamilton-hub');
        expect(hamilton).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'open.hamilton.ca',
            catalogUrl: 'https://open.hamilton.ca/api/feed/dcat-us/1.1.json'
        }));
        expect(hamilton.publisherAliases).toHaveLength(11);
        expect(hamilton.restrictedLicensePatterns).toEqual(expect.arrayContaining([
            expect.any(RegExp)
        ]));
        expect(hamilton.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp),
            license: expect.objectContaining({
                url: expect.stringContaining('/open-data-licence-terms-and-conditions'),
                attributionEn: 'Contains public sector Data made available under the City of Hamilton’s Open Data Licence'
            })
        })]);
        expect(hamilton.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-cd-3525', relationship: 'direct',
            includesDescendants: false
        })]);
    });

    test('configures Vancouver as a record-licensed Opendatasoft city source', () => {
        const vancouver = getSource('vancouver-open-data');
        expect(vancouver).toEqual(expect.objectContaining({
            kind: 'opendatasoft', metadataLanguage: 'en',
            licenseMode: 'record-explicit', timezone: 'America/Vancouver',
            upstreamHost: 'opendata.vancouver.ca'
        }));
        expect(vancouver.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp),
            licenseTitle: expect.any(RegExp),
            licenseUrl: expect.any(RegExp),
            license: expect.objectContaining({
                url: 'https://opendata.vancouver.ca/pages/licence/'
            })
        })]);
        expect(vancouver.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-5915022', relationship: 'direct',
            includesDescendants: false
        })]);
    });

    test('configures Ottawa as a canonical city with Police licence precedence', () => {
        const ottawa = getSource('ottawa-hub');
        expect(ottawa).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'open.ottawa.ca'
        }));
        expect(ottawa.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-cd-3506', relationship: 'direct', includesDescendants: false
        }));
        expect(ottawa.licenseRules[0]).toEqual(expect.objectContaining({
            licensePattern: expect.any(RegExp),
            license: expect.objectContaining({
                url: 'https://data.ottawapolice.ca/pages/open-data-licence'
            })
        }));
        expect(ottawa.licenseRules[1]).toEqual(expect.objectContaining({
            publisher: expect.any(RegExp),
            license: expect.objectContaining({
                url: expect.stringContaining('/open-data-licence-version-20')
            })
        }));
    });

    test('configures Surrey as an exact-publisher ArcGIS source under its portal licence', () => {
        const surrey = getSource('surrey-hub');
        expect(surrey).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'opendata-surrey.hub.arcgis.com',
            catalogUrl: 'https://opendata-surrey.hub.arcgis.com/api/feed/dcat-us/1.1.json'
        }));
        expect(surrey.restrictedLicensePatterns).toEqual(expect.arrayContaining([
            expect.any(RegExp)
        ]));
        expect(surrey.licenseRules).toEqual([expect.objectContaining({
            publisher: expect.any(RegExp),
            license: expect.objectContaining({
                titleEn: 'Open Government License – Surrey',
                url: expect.stringContaining('/pages/55089a19491a4fe59a41e059fd8af708'),
                attributionEn: 'Contains information licensed under the Open Government License – City of Surrey.'
            })
        })]);
        expect(surrey.placeRules).toEqual([expect.objectContaining({
            placeId: 'sgc-csd-5915004', relationship: 'direct',
            includesDescendants: false
        })]);
    });

    test('configures Toronto as an authoritative CKAN city source', () => {
        expect(getSource('toronto-open-data')).toEqual(expect.objectContaining({
            kind: 'ckan', placeId: 'sgc-cd-3520',
            defaultLicenseUrl: 'https://open.toronto.ca/open-data-licence/'
        }));
    });

    test('configures Montréal as a French-first, record-licensed CKAN source', () => {
        const montreal = getSource('montreal-open-data');
        expect(montreal).toEqual(expect.objectContaining({
            kind: 'ckan', metadataLanguage: 'fr', licenseMode: 'record-explicit',
            upstreamHost: 'donnees.montreal.ca', directGeoJsonMaps: true
        }));
        expect(montreal.licenseRules.map(rule => rule.license.url)).toEqual([
            'https://creativecommons.org/licenses/by/4.0/',
            'https://open.canada.ca/en/open-government-licence-canada'
        ]);
        expect(montreal.placeRules).toEqual([
            expect.objectContaining({
                placeId: 'sgc-csd-2466023', relationship: 'direct',
                publisher: expect.any(RegExp)
            }),
            expect.objectContaining({
                placeId: 'sgc-csd-2466023', relationship: 'coverage'
            })
        ]);
    });

    test('configures Québec City and Laval as filtered shared CKAN sources', () => {
        for (const [id, organization, publisher, placeId] of [
            ['quebec-city-open-data', 'ville-de-quebec', 'Ville de Québec', 'sgc-csd-2423027'],
            ['laval-open-data', 'ville-de-laval', 'Ville de Laval', 'sgc-cd-2465']
        ]) {
            const source = getSource(id);
            expect(source).toEqual(expect.objectContaining({
                kind: 'ckan', metadataLanguage: 'fr', directGeoJsonMaps: true,
                upstreamHost: 'www.donneesquebec.ca',
                catalogUrl: 'https://www.donneesquebec.ca/recherche/api/3/action',
                catalogOrganization: organization,
                datasetBaseUrl: 'https://www.donneesquebec.ca/recherche/dataset',
                licenseMode: 'record-explicit'
            }));
            expect(source.authoritativePublishers).toEqual([
                { publisher: expect.any(RegExp) }
            ]);
            expect(source.licenseRules).toEqual([expect.objectContaining({
                publisher: expect.any(RegExp), licenseId: 'cc-by',
                licenseTitle: 'Attribution (CC-BY 4.0)',
                licenseUrl: 'https://www.donneesquebec.ca/licence/#cc-by'
            })]);
            expect(source.placeRules).toEqual([expect.objectContaining({
                placeId, relationship: 'direct', includesDescendants: false
            })]);
            expect(source.authoritativePublishers[0].publisher.test(publisher)).toBe(true);
        }
    });

    test('covers each direct feed without inventing a Clarington source', () => {
        expect(getSource('ajax-hub').placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3518005', relationship: 'direct'
        }));
        expect(getSource('pickering-hub').placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3518001', relationship: 'direct'
        }));
        expect(getSource('whitby-hub').placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3518009', relationship: 'direct'
        }));
        expect(getSource('clarington-hub')).toBeNull();
    });

    test('keeps Whitby fail-closed and requires explicit open-licence evidence', () => {
        const whitby = getSource('whitby-hub');
        expect(whitby.licenseMode).toBe('record-explicit');
        expect(whitby.restrictedLicensePatterns).toHaveLength(1);
        expect(whitby.licenseRules[0].licensePattern).toBeInstanceOf(RegExp);
    });

    test('configures the Peel cluster with direct city and descendant regional coverage', () => {
        expect(getSource('mississauga-hub').placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3521005', relationship: 'direct', includesDescendants: false
        }));
        expect(getSource('brampton-hub').placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3521010', relationship: 'direct', includesDescendants: false
        }));
        expect(getSource('peel-hub').placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-cd-3521', relationship: 'direct', includesDescendants: true
        }));
    });

    test('keeps Brampton and Peel fail-closed while allowing Mississauga portal-wide terms', () => {
        const mississauga = getSource('mississauga-hub');
        const brampton = getSource('brampton-hub');
        const peel = getSource('peel-hub');

        expect(mississauga.licenseRules[1]).toEqual(expect.objectContaining({
            publisher: expect.any(RegExp), license: expect.objectContaining({
                url: 'https://www.mississauga.ca/file/COM/CityOfMississaugaTermsOfUse.pdf'
            })
        }));
        expect(brampton).toEqual(expect.objectContaining({
            licenseMode: 'record-explicit', restrictedLicensePatterns: expect.any(Array)
        }));
        expect(peel).toEqual(expect.objectContaining({
            licenseMode: 'record-explicit', restrictedLicensePatterns: expect.any(Array)
        }));
        expect(brampton.licenseRules.some(rule => rule.license.url === 'https://creativecommons.org/licenses/by/4.0/')).toBe(true);
        expect(peel.licenseRules.some(rule => rule.license.url === 'https://data.peelregion.ca/pages/license')).toBe(true);
    });

    test('configures Burlington, Oakville, and Milton within Halton Region', () => {
        const burlington = getSource('burlington-hub');
        const oakville = getSource('oakville-hub');
        const milton = getSource('milton-hub');

        expect(burlington).toEqual(expect.objectContaining({
            kind: 'arcgis-hub',
            upstreamHost: 'navburl-burlington.opendata.arcgis.com'
        }));
        expect(burlington.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3524002', relationship: 'direct', includesDescendants: false
        }));

        expect(oakville).toEqual(expect.objectContaining({
            kind: 'arcgis-hub',
            upstreamHost: 'portal-exploreoakville.opendata.arcgis.com'
        }));
        expect(oakville.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3524001', relationship: 'direct', includesDescendants: false
        }));

        expect(milton).toEqual(expect.objectContaining({
            kind: 'arcgis-hub',
            upstreamHost: 'discover-milton.hub.arcgis.com'
        }));
        expect(milton.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3524009', relationship: 'direct', includesDescendants: false
        }));
    });

    test('configures Greater Sudbury as a single-tier city source', () => {
        const sudbury = getSource('sudbury-hub');
        expect(sudbury).toEqual(expect.objectContaining({
            kind: 'arcgis-hub',
            upstreamHost: 'opendata.greatersudbury.ca'
        }));
        expect(sudbury.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-cd-3553', relationship: 'direct', includesDescendants: false
        }));
    });

    test('configures Burnaby and Saskatoon as standalone municipal sources', () => {
        const burnaby = getSource('burnaby-hub');
        const saskatoon = getSource('saskatoon-hub');

        expect(burnaby).toEqual(expect.objectContaining({
            kind: 'arcgis-hub',
            upstreamHost: 'data.burnaby.ca'
        }));
        expect(burnaby.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-5915025', relationship: 'direct', includesDescendants: false
        }));

        expect(saskatoon).toEqual(expect.objectContaining({
            kind: 'arcgis-hub',
            upstreamHost: 'opendata.saskatoon.ca'
        }));
        expect(saskatoon.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-4711066', relationship: 'direct', includesDescendants: false
        }));
    });

    test('configures Markham and Newmarket within York Region', () => {
        const markham = getSource('markham-hub');
        const newmarket = getSource('newmarket-hub');

        expect(markham).toEqual(expect.objectContaining({
            kind: 'arcgis-hub',
            upstreamHost: 'data-markham.opendata.arcgis.com'
        }));
        expect(markham.placeRules).toEqual(expect.arrayContaining([
            expect.objectContaining({ placeId: 'sgc-csd-3519036', relationship: 'direct', includesDescendants: false }),
            expect.objectContaining({ placeId: 'sgc-cd-3519', relationship: 'direct', includesDescendants: true })
        ]));

        expect(newmarket).toEqual(expect.objectContaining({
            kind: 'arcgis-hub',
            upstreamHost: 'navigate-newmarket.hub.arcgis.com'
        }));
        expect(newmarket.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3519048', relationship: 'direct', includesDescendants: false
        }));
    });

    test('configures Niagara Falls and Welland within Niagara Region', () => {
        const niagaraFalls = getSource('niagara-falls-hub');
        const welland = getSource('welland-hub');

        expect(niagaraFalls).toEqual(expect.objectContaining({
            kind: 'arcgis-hub',
            upstreamHost: 'open.niagarafalls.ca'
        }));
        expect(niagaraFalls.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3526043', relationship: 'direct', includesDescendants: false
        }));

        expect(welland).toEqual(expect.objectContaining({
            kind: 'arcgis-hub',
            upstreamHost: 'open-welland.hub.arcgis.com'
        }));
        expect(welland.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3526032', relationship: 'direct', includesDescendants: false
        }));
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
        const chatham = getSource('chatham-kent-hub');
        const kawartha = getSource('kawartha-lakes-hub');
        const summerland = getSource('summerland-hub');
        const norfolk = getSource('norfolk-hub');
        const haldimand = getSource('haldimand-hub');

        expect(yellowknife).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-yellowknife.hub.arcgis.com'
        }));
        expect(yellowknife.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-6106023', relationship: 'direct', includesDescendants: false
        }));

        expect(barrie).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'opendata.barrie.ca'
        }));
        expect(barrie.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3543042', relationship: 'direct', includesDescendants: false
        }));

        expect(thunderbay).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'opendata-thunderbay.hub.arcgis.com'
        }));
        expect(thunderbay.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3558004', relationship: 'direct', includesDescendants: false
        }));

        expect(chatham).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'opendata.chatham-kent.ca'
        }));
        expect(chatham.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-cd-3536', relationship: 'direct', includesDescendants: false
        }));

        expect(kawartha).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'open-data-kawartha.hub.arcgis.com'
        }));
        expect(kawartha.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-cd-3516', relationship: 'direct', includesDescendants: false
        }));

        expect(summerland).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'open-data-summerland.hub.arcgis.com'
        }));
        expect(summerland.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-5907035', relationship: 'direct', includesDescendants: false
        }));

        expect(norfolk).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'data-norfolk.opendata.arcgis.com'
        }));
        expect(norfolk.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3528052', relationship: 'direct', includesDescendants: false
        }));

        expect(haldimand).toEqual(expect.objectContaining({
            kind: 'arcgis-hub', upstreamHost: 'opendata-haldimand.hub.arcgis.com'
        }));
        expect(haldimand.placeRules[0]).toEqual(expect.objectContaining({
            placeId: 'sgc-csd-3528018', relationship: 'direct', includesDescendants: false
        }));
    });
});
