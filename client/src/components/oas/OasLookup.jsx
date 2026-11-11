import { useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { fill } from '../../utils/text.js';
import { track } from '../../utils/analytics.js';
import { oasPath } from '../../utils/localizedRoutes.js';
import { loadOasTable, peekOasTable } from '../../utils/oasData.js';
import {
  ALLOWANCE, AMOUNT, FROM, OAS_TABLES, TO, WITH_65, WITH_75, amountKind, dateLabel, findBand, formatBand, formatDollars,
  formatMoney, hasAllowance, hasPension, parseIncome, periodLabel
} from '../../utils/oas.js';

// What the visitor typed and chose, kept with this history entry (never in the
// address), so a reload, Back and the other language's page all start from it.
const remembered = (state) => (state && typeof state === 'object' && state.oas && typeof state.oas === 'object' ? state.oas : {});

// One quarter's rows of one table: what the page already holds, otherwise asked
// for once the visitor starts using the lookup.
function useTableRows(period, table, wanted) {
  const key = period + ':' + table;
  const [loaded, setLoaded] = useState({ key: '', rows: null, failed: false });
  const [attempt, setAttempt] = useState(0);
  const known = peekOasTable(period, table);
  const missing = !known;
  useEffect(() => {
    if (!missing || !wanted) return undefined;
    let cancelled = false;
    loadOasTable(period, table)
      .then((data) => { if (!cancelled) setLoaded({ key, rows: data.rows, failed: false }); })
      .catch(() => { if (!cancelled) setLoaded({ key, rows: null, failed: true }); });
    return () => { cancelled = true; };
  }, [key, wanted, missing, attempt]); // eslint-disable-line react-hooks/exhaustive-deps
  const mine = loaded.key === key ? loaded : { rows: null, failed: false };
  return {
    rows: known ? known.rows : mine.rows,
    failed: missing && mine.failed,
    retry: () => { setLoaded({ key: '', rows: null, failed: false }); setAttempt((value) => value + 1); }
  };
}

// The amounts of one band, as a short list.
function Amounts({ table, row, lang, t }) {
  const monthly = (cents) => fill(t('oas.per_month'), { amount: formatMoney(cents, lang) });
  const lines = [[t('oas.col_' + amountKind(table)), row[AMOUNT]]];
  if (hasAllowance(table)) lines.push([t('oas.col_allowance'), row[ALLOWANCE]]);
  if (hasPension(table)) lines.push([t('oas.col_with65'), row[WITH_65]], [t('oas.col_with75'), row[WITH_75]]);
  return (
    <dl className="mt-2">
      {lines.map(([label, cents], index) => (
        <div key={label} className="flex flex-wrap items-baseline justify-between gap-x-4 border-b border-base-content/10 py-1.5">
          <dt className="text-sm text-base-content/70">{label}</dt>
          <dd className={'ml-auto font-mono tabular-nums whitespace-nowrap ' + (index === 0 ? 'text-lg font-semibold' : 'text-sm')}>{monthly(cents)}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * The lookup: a situation (one of the five tables, fixed on a table's page), a yearly
 * income, and the monthly amount the official table gives for it. Everything happens
 * in the browser; the income is never part of a request, the address or analytics.
 * @param {{
 *   summary: any, lang: string, t: (key: string) => string, table?: number | null,
 *   upcoming?: boolean, onShowRow?: (line: number) => void
 * }} props
 */
export default function OasLookup({ summary, lang, t, table = null, upcoming = false, onShowRow }) {
  const location = useLocation();
  const navigate = useNavigate();
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const saved = remembered(location.state);
  const [selected, setSelected] = useState(() => table || (OAS_TABLES.includes(saved.table) ? saved.table : 1));
  const [income, setIncome] = useState(() => (typeof saved.income === 'string' ? saved.income.slice(0, 20) : ''));
  const [touched, setTouched] = useState(false);
  const period = summary.period;
  const previous = upcoming && summary.previous ? summary.previous.period : null;
  const parsed = parseIncome(income);
  const wanted = touched || !('empty' in parsed);
  const now = useTableRows(period.key, selected, wanted);
  const before = useTableRows(previous ? previous.key : period.key, selected, wanted && Boolean(previous));

  // Keep the income and the situation with this history entry, after a pause in typing.
  useEffect(() => {
    const kept = remembered(location.state);
    if ((kept.income || '') === income && (kept.table || (table ? table : 1)) === selected) return undefined;
    const timer = setTimeout(() => {
      navigate(location.pathname + location.search + location.hash, {
        replace: true, state: { ...(location.state && typeof location.state === 'object' ? location.state : {}), oas: { income, table: selected } }
      });
    }, 300);
    return () => clearTimeout(timer);
  }, [income, selected, location.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const found = 'cents' in parsed && now.rows ? findBand(now.rows, parsed.cents) : null;
  const foundBefore = 'cents' in parsed && previous && before.rows ? findBand(before.rows, parsed.cents) : null;
  const figures = summary.tables.find((entry) => entry.table === selected);
  const outcome = 'invalid' in parsed ? 'invalid' : 'cents' in parsed && now.rows ? (found ? 'amount' : 'above') : null;

  // One count per table and outcome while the page is open; never the amount.
  const counted = useRef(new Set());
  useEffect(() => {
    if (!outcome) return undefined;
    const key = selected + ':' + outcome;
    if (counted.current.has(key)) return undefined;
    const timer = setTimeout(() => {
      counted.current.add(key);
      track('oas_lookup', { table: selected, language: lang, placement: table ? 'table' : 'hub', outcome });
    }, 800);
    return () => clearTimeout(timer);
  }, [outcome, selected]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalid = 'invalid' in parsed;
  const typed = 'cents' in parsed ? formatMoney(parsed.cents, lang) : '';
  return (
    <section className="cq-card p-5 sm:p-6 mt-8" aria-labelledby={inputId + '-title'}>
      <h2 id={inputId + '-title'} className="font-display font-semibold text-xl">{t('oas.lookup_title')}</h2>
      <div className={'grid gap-5 mt-4 ' + (table ? '' : 'lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]')}>
        {!table && (
          <fieldset>
            <legend className="text-sm font-medium">{t('oas.situation_label')}</legend>
            <div className="mt-2 space-y-1.5">
              {OAS_TABLES.map((number) => (
                <label key={number} className={'flex items-start gap-3 rounded-lg border px-3 py-2 text-sm cursor-pointer ' +
                  (selected === number ? 'border-primary/50 bg-primary/5' : 'border-base-content/10 hover:border-base-content/25')}>
                  <input type="radio" className="radio radio-sm radio-primary mt-0.5" name={inputId + '-situation'} value={number}
                    checked={selected === number} onChange={() => { setSelected(number); setTouched(true); }} />
                  <span>
                    <span className="block">{t('oas.situation_' + number)}</span>
                    <span className="block text-xs text-base-content/55">{t('oas.table_word')} {number}</span>
                  </span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div>
          <label htmlFor={inputId} className="text-sm font-medium">{t('oas.income_label')}</label>
          <input id={inputId} type="text" inputMode="decimal" autoComplete="off" maxLength={20}
            className={'input input-bordered w-full mt-2 font-mono' + (invalid ? ' input-error' : '')}
            placeholder={t('oas.income_placeholder')} value={income}
            aria-invalid={invalid} aria-describedby={hintId + (invalid ? ' ' + errorId : '')}
            onFocus={() => setTouched(true)} onChange={(event) => setIncome(event.target.value)} />
          <p id={hintId} className="text-xs text-base-content/60 mt-1.5">
            {fill(t('oas.income_hint'), { definition: t('oas.income_' + selected), year: period.income_year })}
          </p>
          {invalid && <p id={errorId} className="text-xs text-error mt-1">{t('oas.income_invalid')}</p>}
          <p className="text-xs text-base-content/55 mt-1.5">{t('oas.private')}</p>

          {/* The answer keeps its place, so typing never moves the page. */}
          <div className="mt-4 min-h-[9.5rem]" role="status" aria-live="polite">
            {'empty' in parsed && <p className="text-sm text-base-content/60">{t('oas.result_empty')}</p>}
            {'cents' in parsed && !now.rows && !now.failed && <p className="text-sm text-base-content/60">{t('oas.result_loading')}</p>}
            {'cents' in parsed && now.failed && (
              <p className="text-sm text-error">
                {t('oas.result_error')}{' '}
                <button type="button" className="link" onClick={now.retry}>{t('oas.retry')}</button>
              </p>
            )}
            {'cents' in parsed && now.rows && !found && (
              <p className="text-sm">{fill(t('oas.result_none'), { income: typed, end: formatDollars(figures.ends_at_cents, lang) })}</p>
            )}
            {found && (
              <div>
                <p className="text-sm font-medium">{fill(t('oas.result_for'), { income: typed })}</p>
                <p className="text-xs text-base-content/60">
                  {fill(t('oas.result_band'), { band: formatBand(found.row[FROM], found.row[TO], lang) })}
                  {' · '}{t('oas.table_word')} {selected}{' · '}{periodLabel(period, lang)}
                </p>
                {previous && <p className="text-xs font-semibold uppercase tracking-wide text-base-content/50 mt-3">
                  {fill(t('oas.from_date'), { date: dateLabel(period.start, lang) })}</p>}
                <Amounts table={selected} row={found.row} lang={lang} t={t} />
                {previous && foundBefore && (
                  <>
                    <p className="text-xs font-semibold uppercase tracking-wide text-base-content/50 mt-4">
                      {fill(t('oas.until_then'), { period: periodLabel(previous, lang) })}</p>
                    <Amounts table={selected} row={foundBefore.row} lang={lang} t={t} />
                  </>
                )}
                <p className="mt-3">
                  {table && onShowRow
                    ? <button type="button" className="btn btn-sm btn-outline" onClick={() => onShowRow(found.line)}>{t('oas.show_row')}</button>
                    : <Link className="btn btn-sm btn-outline" to={oasPath(lang, selected)} state={{ oas: { income, table: selected } }}>{t('oas.open_table')}</Link>}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
