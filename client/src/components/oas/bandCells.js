import {
  ALLOWANCE, AMOUNT, FROM, TO, WITH_65, WITH_75, amountKind, formatBand, formatMoney, hasAllowance, hasPension
} from '../../utils/oas.js';

/** The column headings of a table's bands. @param {number} table @param {(key: string) => string} t */
export function bandHeaders(table, t) {
  return [t('oas.col_income'), t('oas.col_' + amountKind(table)), ...(hasAllowance(table) ? [t('oas.col_allowance')] : []),
    ...(hasPension(table) ? [t('oas.col_with65'), t('oas.col_with75')] : [])];
}
/** The cells of one band, the income range first. @param {number} table @param {number[]} row @param {string} lang */
export function bandCells(table, row, lang) {
  return [formatBand(row[FROM], row[TO], lang), formatMoney(row[AMOUNT], lang),
    ...(hasAllowance(table) ? [formatMoney(row[ALLOWANCE], lang)] : []),
    ...(hasPension(table) ? [formatMoney(row[WITH_65], lang), formatMoney(row[WITH_75], lang)] : [])];
}
