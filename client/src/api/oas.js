import { getJSON } from './client.js';

// The /oas pages' reads: website only (/web-api/v1), cached for five minutes. The
// income a visitor looks up is never part of a request: the page finds its band in
// the table it was sent.
const record = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const cents = (value) => Number.isInteger(value) && value >= 0;
const period = (value) =>
  record(value) && Number.isInteger(value.key) && Number.isInteger(value.year) && [1, 2, 3, 4].includes(value.quarter) &&
  Number.isInteger(value.income_year) && typeof value.start === 'string' && typeof value.end === 'string';
// A band: income from and to, the table's amount, then the columns only some tables have.
const band = (row) =>
  Array.isArray(row) && row.length === 6 && cents(row[0]) && cents(row[1]) && cents(row[2]) &&
  row.slice(3).every((value) => value === null || cents(value));
const figures = (value) =>
  record(value) && [1, 2, 3, 4, 5].includes(value.table) && typeof value.resource_id === 'string' &&
  Number.isInteger(value.row_count) && cents(value.max_amount_cents) && cents(value.ends_at_cents);
const pension = (value) => value === null || (record(value) && cents(value.age_65_cents) && cents(value.age_75_cents));

/** The summary of the quarter shown. @param {{ data: any }} envelope */
export const oasSummaryResponse = ({ data }) =>
  record(data) && period(data.period) && pension(data.oas) && Array.isArray(data.tables) && data.tables.length === 5 &&
  data.tables.every((table, index) => figures(table) && table.table === index + 1 && Array.isArray(table.condensed) && table.condensed.every(band)) &&
  (data.previous === null || (record(data.previous) && period(data.previous.period) && pension(data.previous.oas) &&
    Array.isArray(data.previous.tables) && data.previous.tables.every(figures)));

/** One table of a quarter, with every income band. @param {{ data: any }} envelope */
export const oasTableResponse = ({ data }) =>
  record(data) && period(data.period) && pension(data.oas) && figures(data.table) && Array.isArray(data.rows) &&
  data.rows.length > 0 && data.rows.every(band);

/** @param {{ signal?: AbortSignal }} [options] */
export function fetchOasSummary(options = {}) {
  return getJSON('/web-api/v1/oas/summary', undefined, { ...options, validate: oasSummaryResponse });
}

/**
 * @param {number} table 1 to 5
 * @param {number} period the quarter's key, from the summary, so a table of one quarter never joins a summary of another
 * @param {{ signal?: AbortSignal }} [options]
 */
export function fetchOasTable(table, period, options = {}) {
  return getJSON('/web-api/v1/oas/tables/' + encodeURIComponent(table), { period }, { ...options, validate: oasTableResponse });
}
