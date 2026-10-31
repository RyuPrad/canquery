import { describe, expect, test } from 'vitest';
import {
  EMPTY_FILE_FILTER,
  fileFacets,
  fileFilterKey,
  fileYears,
  filterFiles,
  hasFileFilter,
  indexFiles,
  readFileFilter,
  writeFileFilter,
  yearLabel
} from './datasetFileFilter.js';

const file = (name, extra = {}) => ({ name: { en: name, fr: null }, ...extra });
const titled = (en, fr = null) => ({ name: { en: null, fr: null }, presentation: { title: { en, fr } } });

describe('fileYears', () => {
  test('a name that starts with a year is about that year', () => {
    expect(fileYears(file('2002 Argentine'))).toEqual(['2002']);
    // LMIA: the NOC edition and the quarter text must not add 2011.
    expect(
      fileYears(
        file(
          '2022Q2-Employers Who Were Issued a Positive Labour Market Impact Assessment (LMIA) by Program Stream, National Occupational Classification (NOC) 2011 and Business Location, April to June 2022'
        )
      )
    ).toEqual(['2022']);
    expect(fileYears(file('2017Q1Q2 Employers'))).toEqual(['2017']);
    expect(fileYears(file('2022T2-Employeurs'))).toEqual(['2022']);
  });

  test('otherwise every year the names mention, skipping classification editions', () => {
    expect(fileYears(file('April 2023 WSA Report'))).toEqual(['2023']);
    expect(fileYears(file('Projected change in temperature: 2031-2050'))).toEqual(['2031-2050']);
    expect(fileYears(file('Counts by NOC 2021 for 2019 and 2020'))).toEqual(['2019', '2020']);
    expect(fileYears(file('Emplois selon le SCIAN 2017, 2018'))).toEqual(['2018']);
  });

  test('reads fiscal years, dates and digit runs like the server', () => {
    expect(fileYears(file('Public accounts 2006-07'))).toEqual(['2006-07']);
    expect(fileYears(file('Public accounts 2006–2007'))).toEqual(['2006-07']);
    expect(fileYears(file('Budget 2024/25'))).toEqual(['2024-25']);
    expect(fileYears(file('Expenditures FY2023-24'))).toEqual(['2023-24']);
    expect(fileYears(file('Report 1999_00'))).toEqual(['1999-00']);
    expect(fileYears(file('Snapshot 2024-01-15'))).toEqual(['2024']);
    expect(fileYears(file('Extract 20240115'))).toEqual([]);
    expect(fileYears(file('Libraries 100001 to 250000'))).toEqual([]);
    expect(fileYears(file('Trend 2010-2015'))).toEqual(['2010-2015']);
    expect(fileYears(file('The 1990s'))).toEqual([]);
  });

  test('falls back to years the titles add beyond the dataset title', () => {
    const datasetYears = new Set(['2019', '2023']);
    expect(fileYears(titled('Student achievement 2026 (French, CSV)'), datasetYears)).toEqual([
      '2026'
    ]);
    expect(fileYears(titled('Table 1 (2019 to 2023 tax years)'), datasetYears)).toEqual([]);
  });

  test('labels use an en dash', () => {
    expect(yearLabel('2006-07')).toBe('2006–07');
    expect(yearLabel('2024')).toBe('2024');
  });
});

describe('filtering', () => {
  const files = [
    {
      id: 'a',
      name: { en: '2002 Sébaste', fr: '2002 Sébaste FR' },
      presentation: {
        title: { en: '2002 Redfish (English, CSV)', fr: '2002 Sébaste (anglais, CSV)' },
        formats: ['CSV'],
        languages: ['en']
      }
    },
    {
      id: 'b',
      name: { en: '2003 Skate', fr: null },
      presentation: { title: { en: '2003 Skate (French, XLSX)' }, formats: ['XLSX'], languages: ['fr'] }
    },
    {
      id: 'c',
      name: { en: '2003 Skate summary', fr: null },
      format: 'csv',
      language: 'en, fr'
    },
    {
      id: 'd',
      name: { en: 'Method notes', fr: null },
      presentation: { title: { en: 'Method notes' }, formats: [], languages: [] },
      format: 'pdf'
    }
  ];
  const indexed = indexFiles(files, [{ en: 'Commercial fisheries', fr: 'Pêches commerciales' }]);

  test('reads formats and languages, with the raw fields as a fallback', () => {
    expect(indexed.map((entry) => entry.format)).toEqual(['CSV', 'XLSX', 'CSV', 'PDF']);
    expect(indexed.map((entry) => entry.languages)).toEqual([['en'], ['fr'], ['en', 'fr'], ['other']]);
  });

  test('search ignores case and accents, and every word must match', () => {
    const ids = (filter) => filterFiles(indexed, filter).map((entry) => entry.id);
    expect(ids({ q: 'sebaste' })).toEqual(['a']);
    expect(ids({ q: 'REDFISH' })).toEqual(['a']);
    expect(ids({ q: 'skate summary' })).toEqual(['c']);
    expect(ids({ q: '  ' })).toEqual(['a', 'b', 'c', 'd']);
  });

  test('groups combine, and a bilingual file counts under both languages', () => {
    const ids = (filter) => filterFiles(indexed, filter).map((entry) => entry.id);
    expect(ids({ year: '2003' })).toEqual(['b', 'c']);
    expect(ids({ year: '2003', language: 'en' })).toEqual(['c']);
    expect(ids({ language: 'fr' })).toEqual(['b', 'c']);
    expect(ids({ language: 'other' })).toEqual(['d']);
    expect(ids({ format: 'CSV', language: 'fr' })).toEqual(['c']);
  });

  test('each group counts the files the other groups allow', () => {
    const facets = fileFacets(indexed, { q: '', year: '2003', format: '', language: 'en' });
    expect(facets.year.options).toEqual([
      { value: '2003', count: 1 },
      { value: '2002', count: 1 }
    ]);
    expect(facets.language.options).toEqual([
      { value: 'en', count: 1 },
      { value: 'fr', count: 2 },
      { value: 'other', count: 0 }
    ]);
    expect(facets.format.options).toEqual([
      { value: 'CSV', count: 1 },
      { value: 'PDF', count: 0 },
      { value: 'XLSX', count: 0 }
    ]);
  });

  test('a group shows only when it can narrow the list, or holds a choice', () => {
    const allCsv = indexFiles([
      { name: { en: '2001 A' }, presentation: { formats: ['CSV'], languages: ['en'] } },
      { name: { en: '2002 B' }, presentation: { formats: ['CSV'], languages: ['en', 'fr'] } }
    ]);
    const facets = fileFacets(allCsv, EMPTY_FILE_FILTER);
    expect(facets.year.shown).toBe(true);
    expect(facets.format.shown).toBe(false);
    expect(facets.language.shown).toBe(true);
    const chosen = fileFacets(allCsv, { format: 'PDF' });
    expect(chosen.format.shown).toBe(true);
    expect(chosen.format.options).toContainEqual({ value: 'PDF', count: 0 });
    expect(fileFacets(indexFiles([files[0]]), EMPTY_FILE_FILTER).year.shown).toBe(false);
  });

  test('years are listed newest first', () => {
    const facets = fileFacets(
      indexFiles([file('2023 a'), file('2023-24 b'), file('2009 c'), file('2031-2050 d')]),
      EMPTY_FILE_FILTER
    );
    expect(facets.year.options.map((option) => option.value)).toEqual([
      '2031-2050',
      '2023',
      '2023-24',
      '2009'
    ]);
  });
});

describe('the address', () => {
  test('reads valid values and drops the rest', () => {
    expect(
      readFileFilter(new URLSearchParams('q=%20Skate&year=2006-07&format=csv&language=fr&page=2'))
    ).toEqual({ q: ' Skate', year: '2006-07', format: 'CSV', language: 'fr' });
    expect(
      readFileFilter(new URLSearchParams('year=1850&format=%3Cb%3E&language=de&q=' + 'x'.repeat(300)))
    ).toEqual({ q: 'x'.repeat(200), year: '', format: '', language: '' });
  });

  test('writes the filter and keeps page, highlight and other parameters', () => {
    const next = writeFileFilter(new URLSearchParams('page=3&highlight=r1&lang=fr&year=2001'), {
      q: 'skate ',
      year: '',
      format: 'CSV',
      language: 'en'
    });
    expect(next.toString()).toBe('page=3&highlight=r1&lang=fr&q=skate+&format=CSV&language=en');
    expect(writeFileFilter(next, EMPTY_FILE_FILTER).toString()).toBe('page=3&highlight=r1&lang=fr');
    expect(writeFileFilter(new URLSearchParams(), { q: '   ' }).toString()).toBe('');
  });

  test('knows when a filter is active and keys each one', () => {
    expect(hasFileFilter(EMPTY_FILE_FILTER)).toBe(false);
    expect(hasFileFilter({ q: '  ' })).toBe(false);
    expect(hasFileFilter({ q: 'a' })).toBe(true);
    expect(hasFileFilter({ language: 'other' })).toBe(true);
    expect(fileFilterKey({ q: ' Sébaste  RED ' })).toBe(fileFilterKey({ q: 'sebaste red' }));
    expect(fileFilterKey({ year: '2001' })).not.toBe(fileFilterKey({ year: '2002' }));
  });
});
