const { sources, getSource } = require('../config/catalogSources');

describe('configured municipal catalogue sources', () => {
    test('syncs municipal mirrors before the authoritative Durham portal', () => {
        expect(sources.map(source => source.id)).toEqual([
            'toronto-open-data', 'oshawa-hub', 'ajax-hub', 'pickering-hub', 'whitby-hub', 'durham-hub'
        ]);
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
});
