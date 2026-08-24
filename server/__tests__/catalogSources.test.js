const { sources, getSource } = require('../config/catalogSources');

describe('configured municipal catalogue sources', () => {
    test('syncs city portals before the authoritative portal in each regional cluster', () => {
        expect(sources.map(source => source.id)).toEqual([
            'toronto-open-data', 'ottawa-hub',
            'oshawa-hub', 'ajax-hub', 'pickering-hub', 'whitby-hub', 'durham-hub',
            'mississauga-hub', 'brampton-hub', 'peel-hub'
        ]);
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

    test('configures Toronto as an authoritative CKAN city source', () => {
        expect(getSource('toronto-open-data')).toEqual(expect.objectContaining({
            kind: 'ckan', placeId: 'sgc-cd-3520',
            defaultLicenseUrl: 'https://open.toronto.ca/open-data-licence/'
        }));
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
});
