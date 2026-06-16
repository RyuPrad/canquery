const { toAbsoluteUrl } = require('../utils/resolveUrl');

describe('toAbsoluteUrl', () => {
    it('resolves a relative portal download path against the upstream origin', () => {
        expect(toAbsoluteUrl('/data/dataset/d/resource/r/download/file.csv'))
            .toBe('https://open.canada.ca/data/dataset/d/resource/r/download/file.csv');
    });

    it('leaves an absolute URL unchanged (including external hosts)', () => {
        expect(toAbsoluteUrl('https://example.org/path/file.csv')).toBe('https://example.org/path/file.csv');
        expect(toAbsoluteUrl('https://open.canada.ca/x/y.csv')).toBe('https://open.canada.ca/x/y.csv');
    });

    it('returns non-string / empty input unchanged', () => {
        expect(toAbsoluteUrl(null)).toBe(null);
        expect(toAbsoluteUrl(undefined)).toBe(undefined);
        expect(toAbsoluteUrl('')).toBe('');
    });
});
