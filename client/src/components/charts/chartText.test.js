import { describe, expect, test } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STRINGS } from '../../i18n.jsx';
import { chartTitle, chartSubtitle, chartNotes, noteText, chartSummary, skipReason, columnReading, blockedText, kpiText, specTitle, pointLabel, chartRows,
  chartRecords, cardView } from './chartText.js';
import { fmtPeriod } from './theme.js';
import { ANALYSIS, SHARE, LINE, MODEL, BLOCKED } from '../../test/chartAnalysis.js';

const tFor = (lang) => (key) => STRINGS[lang][key] ?? key;
const en = tFor('en');
const fr = tFor('fr');

describe('words for the chart engine\'s answers', () => {
  test('titles say what is measured and how it is grouped', () => {
    expect(chartTitle(SHARE, en)).toBe('TOTAL by Province');
    expect(chartTitle(LINE, en)).toBe('TOTAL over time');
    expect(chartTitle({ ...SHARE, y: { agg: 'count' } }, en)).toBe('Records by Province');
    expect(chartTitle({ ...SHARE, y: { agg: 'avg', label: 'Rate' } }, en)).toBe('Average Rate by Province');
    expect(chartTitle({ ...LINE, y: { agg: 'avg', label: 'Rate' } }, fr)).toBe('Rate : moyenne dans le temps');
    // A series with one row per period is its own figure, not an average.
    expect(chartTitle({ ...LINE, single: true, y: { agg: 'avg', label: 'Population' } }, en)).toBe('Population over time');
    expect(chartTitle({ ...LINE, x: { type: 'time', wide: 'w0', grain: 'year' }, y: { agg: 'sum', label: 'budget' } }, en)).toBe('Budget · Total per period');
    expect(chartTitle({ ...LINE, x: { type: 'time', wide: 'w0', grain: 'year' }, y: { agg: 'sum', label: null } }, en)).toBe('Total per period');
  });

  test('subtitles say how much of the table is shown, and when a sum is a floor', () => {
    expect(chartSubtitle(SHARE, en, 'en')).toBe('2 groups · At least: some cells hold no number');
    expect(chartSubtitle({ ...SHARE, y: { ...SHARE.y, lower_bound: false }, scope: { ...SHARE.scope, complete: false, groups_shown: 12, groups_total: 491 } }, en, 'en'))
      .toBe('Largest 12 of 491 groups');
    expect(chartSubtitle({ ...LINE, y: { ...LINE.y, lower_bound: false, unit: 'kcal' } }, en, 'en')).toBe('Jan 2019 – Apr 2019 · kcal');
  });

  test('notes come with their numbers, cautions first, and unknown codes are left out', () => {
    const notes = chartNotes(SHARE, en, 'en');
    expect(notes.map((note) => note.code)).toEqual(['placeholders_left_out', 'numbers_read_from_text', 'not_recorded_group']);
    expect(notes[0]).toEqual({ code: 'placeholders_left_out', caution: true, text: '200 cells hold “--” instead of a number and are left out.' });
    expect(noteText({ code: 'limited_groups', shown: 12, total: 1491 }, en, 'en')).toBe('The 12 largest of 1,491 groups are shown.');
    expect(noteText({ code: 'one_unit_only', by: 'currency', kept: 'CAD', rows: 3 }, fr, 'fr')).toBe('Seulement les lignes où « Currency » vaut « CAD »; 3 autres lignes sont exclues.');
    expect(noteText({ code: 'a_code_from_a_newer_engine' }, en, 'en')).toBeNull();
  });

  test('a sentence for readers who cannot see the chart', () => {
    expect(chartSummary(SHARE, en, 'en')).toBe('2 groups. Largest: Ontario, 600.');
    expect(chartSummary(LINE, en, 'en')).toBe('4 periods, Jan 2019 to Apr 2019. Latest: 30.');
    expect(pointLabel(SHARE.points[2], SHARE, en, 'en')).toBe('Not recorded');
    expect(pointLabel(SHARE.points[2], SHARE, fr, 'fr')).toBe('Non renseigné');
  });

  test('a period with no number keeps its place, as a gap and as a row', () => {
    const gappy = { ...LINE, time: { ...LINE.time, missing: ['2019-03-01'] }, points: LINE.points.filter((point) => point.start !== '2019-03-01') };
    expect(chartRows(gappy).map((row) => [row.start, row.point ? row.point.value : null]))
      .toEqual([['2019-01-01', 10], ['2019-02-01', 20], ['2019-03-01', null], ['2019-04-01', 30]]);
    expect(chartRecords(gappy, en, 'en')).toEqual([{ key: 'Jan 2019', value: 10 }, { key: 'Feb 2019', value: 20 }, { key: 'Mar 2019', value: null },
      { key: 'Apr 2019', value: 30 }]);
    // Groups have no periods to miss.
    expect(chartRows(SHARE).map((row) => row.point)).toEqual(SHARE.points);
  });

  test('a card keeps the five largest bars of a chart and says how many there were', () => {
    const points = Array.from({ length: 8 }, (_, i) => ({ key: 'g' + i, label: 'G' + i, value: 100 - i, rows: 1 }));
    const bars = { ...SHARE, kind: 'bars', points, other: { groups: 3, value: 9 }, scope: { ...SHARE.scope, groups_total: 8, groups_shown: 8, complete: true } };
    const card = cardView(bars);
    expect(card.points).toHaveLength(5);
    expect(card.other).toBeNull();
    expect(chartSubtitle({ ...card, y: { ...card.y, lower_bound: false } }, en, 'en')).toBe('Largest 5 of 8 groups');
    // A donut, a line and a short bar chart are drawn whole.
    expect(cardView(SHARE)).toBe(SHARE);
    expect(cardView(LINE)).toBe(LINE);
    expect(cardView({ ...bars, points: points.slice(0, 5) }).points).toHaveLength(5);
  });

  test('periods are written by their grain', () => {
    expect(fmtPeriod('2021-01-01', 'year', 'en')).toBe('2021');
    expect(fmtPeriod('2015-01-01', 'fiscal_year', 'en')).toBe('2015–16');
    expect(fmtPeriod('1999-01-01', 'fiscal_year', 'en')).toBe('1999–00');
    expect(fmtPeriod('2021-07-01', 'quarter', 'en')).toBe('Q3 2021');
    expect(fmtPeriod('2021-07-01', 'quarter', 'fr')).toBe('T3 2021');
    expect(fmtPeriod('2021-03-01', 'month', 'en')).toBe('Mar 2021');
    expect(fmtPeriod('2021-03-04', 'day', 'en')).toBe('Mar 4, 2021');
    expect(fmtPeriod(null, 'year', 'en')).toBe('-');
    expect(fmtPeriod('soon', 'year', 'en')).toBe('soon');
  });

  test('figures above the charts', () => {
    expect(ANALYSIS.kpis.map((kpi) => kpiText(kpi, en, 'en'))).toEqual([
      { value: '288', label: 'Rows' },
      { value: 'Jan 2019 – Apr 2019', label: 'Time span' },
      { value: '≥ 1,000', label: 'Total', sub: 'TOTAL' },
    ]);
    expect(kpiText({ role: 'avg', column: 'rate', label: 'rate', value: 4.95, percent: true, unit: null }, en, 'en')).toEqual({ value: '4.95 %', label: 'Average', sub: 'Rate' });
    expect(kpiText({ role: 'something_new' }, en, 'en')).toBeNull();
  });

  test('how each column was read, why charts were set aside, and what blocks a measure', () => {
    const reading = (id, t = en) => columnReading(MODEL.columns.find((column) => column.id === id), t);
    expect(reading('TOTAL')).toEqual({ role: 'Numbers', details: ['stored as text', 'added up'] });
    expect(reading('Rate')).toEqual({ role: 'Numbers', details: ['a percentage', 'averaged, not added up'] });
    expect(reading('Province_FR')).toEqual({ role: 'Groups', details: ['same as “Province”, not charted'] });
    expect(reading('Notes', fr)).toEqual({ role: 'Texte', details: [] });
    expect(skipReason('flat', en)).toBe('every value is the same');
    expect(skipReason('numeric_labels', en)).toBe('the groups have no readable names');
    expect(skipReason('something_new', en)).toBe('not needed');
    expect(specTitle(ANALYSIS.skipped[0], MODEL, en)).toBe('Average Rate by Province');
    expect(specTitle({ x: { type: 'time', axis: 't:EN_YEAR+EN_MONTH' }, y: { agg: 'count' } }, MODEL, en)).toBe('Records over time');
    expect(blockedText(BLOCKED.blocked[0], en)).toBe('“Measure Value” is a different measure for each “Data Point Label”, so it is not added up or averaged across them. Choose one:');
    expect(blockedText({ column: 'level', column_label: 'Level', why: 'mixed_levels' }, en)).toMatch(/^“Level” lists totals together with their parts/);
  });
});

// Every code the engine can send has words in both languages: read the codes
// out of the engine's source, so a new one cannot ship without them.
describe('every code of the engine has words in English and French', () => {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const server = (file) => fs.readFileSync(path.resolve(here, '../../../../server/services/charts', file), 'utf8');
  const found = (source, re) => [...new Set([...source.matchAll(re)].map((match) => match[1]))];
  const has = (key) => typeof STRINGS.en[key] === 'string' && STRINGS.en[key] !== '' && typeof STRINGS.fr[key] === 'string' && STRINGS.fr[key] !== '';

  test('notes', () => {
    const notes = found(server('validate.js') + server('chartEngine.js'), /code: '([a-z_]+)', level:/g);
    expect(notes.length).toBeGreaterThan(20);
    expect(notes.filter((code) => !has('chart.note.' + code))).toEqual([]);
  });

  test('column roles', () => {
    // decide(<a role, or a choice between roles>, <confidence>, ...): the words quoted in the first argument.
    const source = server('model.js');
    const firsts = [];
    for (let index = source.indexOf('decide('); index >= 0; index = source.indexOf('decide(', index + 1)) {
      let depth = 0;
      let end = index + 7;
      for (; end < source.length; end += 1) {
        const char = source[end];
        if (char === '(') depth += 1;
        else if (char === ')' && depth-- === 0) break;
        else if (char === ',' && depth === 0) break;
      }
      firsts.push(source.slice(index + 7, end));
    }
    const roles = [...new Set(firsts.flatMap((argument) => [...argument.matchAll(/'([a-z_]+)'/g)].map((match) => match[1])))];
    expect(roles.length).toBeGreaterThanOrEqual(14);
    expect(roles.filter((role) => !has('chart.role.' + role))).toEqual([]);
  });

  test('reasons a chart is set aside', () => {
    const reasons = found(server('validate.js'), /reject\('([a-z_]+)'/g)
      .concat(found(server('chartEngine.js'), /reason: '([a-z_]+)'/g), found(server('chartEngine.js'), /skipOf\([^,]+, '([a-z_]+)'\)/g));
    const internal = new Set(['not_tried', 'not_recomputed', 'inconsistent_counts']);
    expect(reasons.length).toBeGreaterThan(15);
    expect(reasons.filter((reason) => !internal.has(reason) && skipReason(reason, en) === en('chart.skip.other'))).toEqual([]);
  });

  test('grains, aggregations and the rest of the Chart tab\'s strings exist in both languages', () => {
    for (const grain of ['day', 'month', 'quarter', 'year', 'fiscal_year']) expect(has('chart.grain.' + grain)).toBe(true);
    for (const agg of ['count', 'sum', 'avg', 'min', 'max']) expect(has('chart.agg.' + agg)).toBe(true);
    const english = Object.keys(STRINGS.en).filter((key) => key.startsWith('chart.'));
    expect(english.filter((key) => !(key in STRINGS.fr))).toEqual([]);
    expect(Object.keys(STRINGS.fr).filter((key) => key.startsWith('chart.') && !(key in STRINGS.en))).toEqual([]);
  });
});
