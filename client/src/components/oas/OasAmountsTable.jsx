import { memo } from 'react';
import { fill } from '../../utils/text.js';
import { FROM, bandSections, formatBand } from '../../utils/oas.js';
import { bandCells, bandHeaders } from './bandCells.js';

/**
 * Some bands of a table, as a table. `first` is the line of the first row, so every
 * row can be found by its line; `caption` names the table to assistive technology.
 * @param {{ table: number, rows: number[][], lang: string, t: (key: string) => string, first?: number, caption?: string }} props
 */
export function BandTable({ table, rows, lang, t, first = 1, caption }) {
  return (
    <div className="overflow-x-auto cq-card mt-2" tabIndex={0} role="region" aria-label={caption}>
      <table className="cq-oas-table">
        {caption && <caption className="sr-only">{caption}</caption>}
        <thead>
          <tr>{bandHeaders(table, t).map((header) => <th key={header} scope="col">{header}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, index) => {
            const [band, ...amounts] = bandCells(table, row, lang);
            return (
              <tr key={row[FROM]} data-line={first + index} tabIndex={-1}>
                <th scope="row">{band}</th>
                {amounts.map((amount, column) => <td key={column}>{amount}</td>)}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Every band of a table, in sections under their income ranges, as the server's HTML
 * has them. Drawn once per table and language: finding a row never draws it again.
 * Every row is laid out at once (about 50 ms for the longest table on a desktop), so
 * the page's height is exact: a saved position, a link to a range and the browser's
 * own find all land where they should.
 * @param {{ table: number, rows: number[][], lang: string, t: (key: string) => string }} props
 */
function OasAmountsTable({ table, rows, lang, t }) {
  const groups = bandSections(rows);
  return (
    <>
      <nav aria-label={t('oas.jump')} className="mt-8">
        <h2 className="font-display font-semibold text-xl">{t('oas.jump')}</h2>
        <ul className="flex flex-wrap gap-2 mt-3">
          {groups.map((group) => (
            <li key={group.id}>
              <a href={'#' + group.id} className="cq-chip cq-chip-mono hover:border-primary/40">{formatBand(group.from, group.to, lang)}</a>
            </li>
          ))}
        </ul>
      </nav>
      {groups.map((group) => {
        const heading = fill(t('oas.range'), { band: formatBand(group.from, group.to, lang) });
        return (
          <section key={group.id} id={group.id} className="mt-8 scroll-mt-24">
            <h2 className="font-display font-semibold text-lg">{heading}</h2>
            <BandTable table={table} rows={group.rows} lang={lang} t={t} first={group.first} caption={heading} />
          </section>
        );
      })}
    </>
  );
}

export default memo(OasAmountsTable);
