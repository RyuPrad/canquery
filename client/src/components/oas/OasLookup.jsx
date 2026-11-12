import { useCallback, useEffect, useId, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { fill } from '../../utils/text.js';
import { track } from '../../utils/analytics.js';
import { oasPath } from '../../utils/localizedRoutes.js';
import { loadOasTable, peekOasTable } from '../../utils/oasData.js';
import {
  ALLOWANCE, AMOUNT, FROM, OAS_TABLES, TO, WITH_65, WITH_75, amountKind, dateLabel, findBand, formatBand, formatDollars,
  formatMoney, hasAllowance, hasPension, parseIncome, periodLabel, periodState, today
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

const Quarter = ({ children }) => <p className="text-xs font-semibold uppercase tracking-wide text-base-content/50 mt-3">{children}</p>;

/**
 * The lookup: a situation (one of the five tables, fixed on a table's page), a yearly
 * income, and the monthly amount the official table gives for it. Everything happens
 * in the browser; the income is never part of a request, the address or analytics.
 * When the quarter shown has not started, the amount in effect until then is given
 * beside it. `onFound` hears which line of the table holds the income (null for none),
 * and `onShowRow` brings that line into view.
 * @param {{
 *   summary: any, lang: string, t: (key: string) => string, table?: number | null,
 *   onFound?: (line: number | null) => void, onShowRow?: () => void
 * }} props
 */
export default function OasLookup({ summary, lang, t, table = null, onFound, onShowRow }) {
  const location = useLocation();
  const navigate = useNavigate();
  const inputId = useId();
  const hintId = useId();
  const errorId = useId();
  const saved = remembered(location.state);
  const [selected, setSelected] = useState(() => table || (OAS_TABLES.includes(saved.table) ? saved.table : 1));
  const [income, setIncome] = useState(() => (typeof saved.income === 'string' ? saved.income.slice(0, 24) : ''));
  // Asked for the table's rows (on focus), and changed something here (a lookup worth counting).
  const [touched, setTouched] = useState(false);
  const [acted, setActed] = useState(false);
  const period = summary.period;
  // A quarter that has not started is shown beside the one running today, when that one is loaded.
  const day = today();
  const earlier = periodState(period, day) === 'upcoming' && summary.previous && periodState(summary.previous.period, day) === 'current'
    ? summary.previous : null;
  const parsed = parseIncome(income);
  const wanted = touched || !('empty' in parsed);
  const now = useTableRows(period.key, selected, wanted);
  const then = useTableRows(earlier ? earlier.period.key : period.key, selected, wanted && Boolean(earlier));

  // Keep the income and the situation with this history entry: after a pause in typing,
  // and at once when the box is left (a link or the language switch is about to be used).
  const latest = useRef({ income, selected, location });
  useEffect(() => { latest.current = { income, selected, location }; });
  const save = useCallback(() => {
    const current = latest.current;
    const kept = remembered(current.location.state);
    if ((kept.income || '') === current.income && (kept.table || (table ? table : 1)) === current.selected) return;
    const state = current.location.state && typeof current.location.state === 'object' ? current.location.state : {};
    navigate(current.location.pathname + current.location.search + current.location.hash, {
      replace: true, state: { ...state, oas: { income: current.income, table: current.selected } }
    });
  }, [navigate, table]);
  useEffect(() => {
    const timer = setTimeout(save, 300);
    return () => clearTimeout(timer);
  }, [income, selected, location.key, save]);

  const found = 'cents' in parsed && now.rows ? findBand(now.rows, parsed.cents) : null;
  const foundEarlier = 'cents' in parsed && earlier && then.rows ? findBand(then.rows, parsed.cents) : null;
  const figures = summary.tables.find((entry) => entry.table === selected);
  const figuresEarlier = earlier ? earlier.tables.find((entry) => entry.table === selected) : null;
  const line = found ? found.line : null;
  useEffect(() => { if (onFound) onFound(line); }, [line, onFound]);

  // One count per table and outcome while the page is open, only for something the visitor
  // did here (an income restored by Back or a reload is not a new lookup). Never the amount,
  // and not whether the table lists it.
  const outcome = 'invalid' in parsed ? 'invalid' : 'cents' in parsed && now.rows ? 'answer' : null;
  const counted = useRef(new Set());
  useEffect(() => {
    if (!outcome || !acted) return undefined;
    const key = selected + ':' + outcome;
    if (counted.current.has(key)) return undefined;
    const timer = setTimeout(() => {
      counted.current.add(key);
      track('oas_lookup', { table: selected, language: lang, placement: table ? 'table' : 'hub', outcome });
    }, 800);
    return () => clearTimeout(timer);
  }, [outcome, selected, acted]); // eslint-disable-line react-hooks/exhaustive-deps

  const invalid = 'invalid' in parsed;
  const none = (end) => <p className="text-sm mt-2">{fill(t('oas.result_none'), { income: formatMoney(parsed.cents, lang), end: formatDollars(end, lang) })}</p>;
  // The longest answer this table can give, drawn out of sight under the real one: the space is
  // kept from the start, so nothing below moves when an answer appears or changes.
  const widest = [figures.ends_at_cents - 1, figures.ends_at_cents - 1, figures.max_amount_cents, figures.max_allowance_cents || 0,
    figures.max_amount_cents + (summary.oas ? summary.oas.age_65_cents : figures.max_amount_cents),
    figures.max_amount_cents + (summary.oas ? summary.oas.age_75_cents : figures.max_amount_cents)];
  const answer = ({ row, rowEarlier, ghost = false }) => (
    <div>
      <p className="text-sm font-medium">{fill(t('oas.result_for'), { income: formatMoney(ghost ? figures.ends_at_cents - 1 : parsed.cents, lang) })}</p>
      <p className="text-xs text-base-content/60">
        {row && <>{fill(t('oas.result_band'), { band: formatBand(row[FROM], row[TO], lang) })}{' · '}</>}
        {t('oas.table_word')} {selected}{!earlier && <>{' · '}{periodLabel(period, lang)}</>}
      </p>
      {earlier && <Quarter>{fill(t('oas.from_date'), { date: dateLabel(period.start, lang) })}</Quarter>}
      {row ? <Amounts table={selected} row={row} lang={lang} t={t} /> : none(figures.ends_at_cents)}
      {earlier && (
        <>
          <Quarter>
            {earlier.period.income_year === period.income_year
              ? fill(t('oas.until_then'), { period: periodLabel(earlier.period, lang) })
              : fill(t('oas.until_then_year'), { period: periodLabel(earlier.period, lang), year: earlier.period.income_year })}
          </Quarter>
          {rowEarlier ? <Amounts table={selected} row={rowEarlier} lang={lang} t={t} />
            : then.failed ? (
              <p className="text-sm text-error mt-2">
                {t('oas.result_error_then')}{' '}
                <button type="button" className="link" onClick={then.retry}>{t('oas.retry')}</button>
              </p>
            ) : !then.rows ? <p className="text-sm text-base-content/60 mt-2">{t('oas.result_loading')}</p>
              : <p className="text-sm mt-2">{fill(t('oas.result_none_then'), { end: formatDollars(figuresEarlier.ends_at_cents, lang) })}</p>}
        </>
      )}
      <p className="mt-3">
        {ghost ? <span className="btn btn-sm btn-outline">{t(table ? 'oas.show_row' : 'oas.open_table')}</span>
          : table ? (row && onShowRow ? <button type="button" className="btn btn-sm btn-outline" onClick={onShowRow}>{t('oas.show_row')}</button> : null)
            : <Link className="btn btn-sm btn-outline" to={oasPath(lang, selected)} state={{ oas: { income, table: selected } }}>{t('oas.open_table')}</Link>}
      </p>
    </div>
  );
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
                    checked={selected === number} onChange={() => { setActed(true); setSelected(number); setTouched(true); }} />
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
          {/* Nothing typed here goes to a spelling or completion service either. */}
          <input id={inputId} type="text" inputMode="decimal" autoComplete="off" autoCorrect="off" autoCapitalize="off" spellCheck={false}
            className={'input input-bordered w-full mt-2 font-mono' + (invalid ? ' input-error' : '')}
            placeholder={t('oas.income_placeholder')} value={income}
            aria-invalid={invalid} aria-describedby={hintId + (invalid ? ' ' + errorId : '')}
            onFocus={() => setTouched(true)} onBlur={save}
            onChange={(event) => { setActed(true); setIncome(event.target.value.replace(/^\s+/, '').slice(0, 24)); }} />
          <p id={hintId} className="text-xs text-base-content/60 mt-1.5">
            {fill(t('oas.income_hint'), { definition: t('oas.income_' + selected), year: period.income_year })}
          </p>
          {/* The line is always there, so the answer below does not move when it shows. */}
          <p id={errorId} className={'text-xs text-error mt-1' + (invalid ? '' : ' invisible')} aria-hidden={!invalid}>{t('oas.income_invalid')}</p>
          <p className="text-xs text-base-content/55 mt-1.5">{t('oas.private')}</p>

          <div className="mt-4 grid">
            <div className="col-start-1 row-start-1 invisible" aria-hidden="true" data-oas-reserve="true">
              {answer({ row: widest, rowEarlier: earlier ? widest : null, ghost: true })}
            </div>
            <div className="col-start-1 row-start-1" role="status" aria-live="polite">
              {'empty' in parsed && <p className="text-sm text-base-content/60">{t('oas.result_empty')}</p>}
              {'cents' in parsed && !now.rows && !now.failed && <p className="text-sm text-base-content/60">{t('oas.result_loading')}</p>}
              {'cents' in parsed && now.failed && (
                <p className="text-sm text-error">
                  {t('oas.result_error')}{' '}
                  <button type="button" className="link" onClick={now.retry}>{t('oas.retry')}</button>
                </p>
              )}
              {'cents' in parsed && now.rows && answer({ row: found ? found.row : null, rowEarlier: foundEarlier ? foundEarlier.row : null })}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
