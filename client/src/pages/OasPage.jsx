import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { STRINGS, useLang } from '../i18n.jsx';
import { fill } from '../utils/text.js';
import { consumeInitialData } from '../utils/initialData.js';
import { loadOasSummary, loadOasTable, peekOasSummary, peekOasTable, takeOasInitialData } from '../utils/oasData.js';
import { oasPath } from '../utils/localizedRoutes.js';
import { documentWasRestored, itemOnScreen } from '../utils/scrollMemory.js';
import {
  OAS_DATASET_ID, OAS_GUIDE, OAS_OFFICIAL_LINKS, OAS_TABLES, amountKind, dateLabel, formatChange, formatCount, formatDollars,
  formatMoney, hasAllowance, hasPension, periodLabel, periodState, today
} from '../utils/oas.js';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import OasLookup from '../components/oas/OasLookup.jsx';
import OasAmountsTable, { BandTable } from '../components/oas/OasAmountsTable.jsx';

// The OAS benefit amounts pages: the hub (/oas, /fr/sv) with the lookup, the quarter's
// key figures and a short version of each official table, and one page per table
// (/oas/table-N, /fr/sv/tableau-N) with every income band. Each address is written
// in one language, like a guide, and the page speaks it whatever the interface was.

const tableTitle = (table, lang, t) => t('oas.table_word') + ' ' + table + (lang === 'fr' ? ' : ' : ': ') + t('oas.table_' + table);
const monthly = (cents, lang, t) => fill(t('oas.per_month'), { amount: formatMoney(cents, lang) });
// A table's largest amounts, as the key figures show them.
function maximumText(entry, lang, t) {
  const amount = monthly(entry.max_amount_cents, lang, t);
  return hasAllowance(entry.table) ? fill(t('oas.both'), { gis: amount, allowance: monthly(entry.max_allowance_cents, lang, t) }) : amount;
}
// The line a page shows when its quarter has not started or has ended.
function periodNote(period, lang, t) {
  const state = periodState(period, today());
  if (state === 'upcoming') return fill(t('oas.upcoming'), { date: dateLabel(period.start, lang) });
  if (state === 'ended') return fill(t('oas.ended'), { period: periodLabel(period, lang) });
  return '';
}

function Hero({ chip, heading, intro, note, lang, t, table, children }) {
  const location = useLocation();
  const other = lang === 'fr' ? 'en' : 'fr';
  return (
    <div className="cq-card p-6 sm:p-8 overflow-hidden relative">
      <div className="absolute inset-0 cq-grid-bg opacity-40 pointer-events-none" />
      <div className="relative">
        <span className="cq-chip !whitespace-normal">{chip}</span>
        <h1 className="text-3xl sm:text-4xl font-bold font-display mt-3 break-words">{heading}</h1>
        <p className="text-base-content/70 mt-3 leading-relaxed max-w-3xl">{intro}</p>
        <p className="text-sm text-base-content/60 mt-3 leading-relaxed max-w-3xl">{t('oas.caveat')}</p>
        {note && <p className="text-sm mt-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 max-w-3xl">{note}</p>}
        <div className="flex flex-wrap gap-2 mt-4">
          {children}
          <Link to={OAS_GUIDE[lang === 'fr' ? 'fr' : 'en']} className="cq-chip !whitespace-normal max-w-full break-words hover:border-primary/40">{t('oas.guide_link')}</Link>
          {/* The other language's page keeps what was typed here. */}
          <Link to={oasPath(other, table)} hrefLang={other} lang={other} state={location.state}
            className="cq-chip !whitespace-normal max-w-full break-words hover:border-primary/40">{t('oas.twin')}</Link>
        </div>
      </div>
    </div>
  );
}

function Sources({ summary, lang, t, table = null }) {
  const files = table ? summary.tables.filter((entry) => entry.table === table) : summary.tables;
  return (
    <div className="grid md:grid-cols-2 gap-4 mt-10">
      <section className="cq-card p-5">
        <h2 className="font-semibold">{t('oas.files_title')}</h2>
        <ul className="mt-2 space-y-1.5 text-sm">
          <li><Link className="link link-hover" to={'/datasets/' + OAS_DATASET_ID}>{t('oas.dataset_link')}</Link></li>
          {files.map((entry) => (
            <li key={entry.table}>
              <Link className="link link-hover" to={'/resources/' + encodeURIComponent(entry.resource_id)}>{fill(t('oas.file_link'), { table: entry.table })}</Link>
            </li>
          ))}
        </ul>
      </section>
      <section className="cq-card p-5">
        <h2 className="font-semibold">{t('oas.official_title')}</h2>
        <ul className="mt-2 space-y-1.5 text-sm">
          {OAS_OFFICIAL_LINKS[lang === 'fr' ? 'fr' : 'en'].map(([href, label]) => (
            <li key={href}><a className="link link-hover" href={href} target="_blank" rel="noopener noreferrer">{label}</a></li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function Hub({ summary, lang, t }) {
  const { period, previous } = summary;
  const long = periodLabel(period, lang);
  const upcoming = periodState(period, today()) === 'upcoming';
  const changes = [];
  if (previous) {
    for (const entry of summary.tables) {
      const old = previous.tables.find((item) => item.table === entry.table);
      if (!old) continue;
      changes.push([fill(t('oas.change_' + amountKind(entry.table)), { table: entry.table }), old.max_amount_cents, entry.max_amount_cents]);
      if (hasAllowance(entry.table)) changes.push([fill(t('oas.change_allowance'), { table: entry.table }), old.max_allowance_cents, entry.max_allowance_cents]);
    }
    if (summary.oas && previous.oas) {
      changes.push([t('oas.oas65'), previous.oas.age_65_cents, summary.oas.age_65_cents]);
      changes.push([t('oas.oas75'), previous.oas.age_75_cents, summary.oas.age_75_cents]);
    }
  }
  return (
    <>
      <Hero chip={t('oas.chip') + ' · ' + long} heading={t('oas.title') + ', ' + long} lang={lang} t={t} table={null}
        intro={fill(t('oas.intro'), { period: long, year: period.income_year })} note={periodNote(period, lang, t)}>
        {summary.oas && <span className="cq-chip cq-chip-mono !whitespace-normal">{t('oas.oas65')} · {monthly(summary.oas.age_65_cents, lang, t)}</span>}
        {summary.oas && <span className="cq-chip cq-chip-mono !whitespace-normal">{t('oas.oas75')} · {monthly(summary.oas.age_75_cents, lang, t)}</span>}
      </Hero>

      <OasLookup summary={summary} lang={lang} t={t} upcoming={upcoming} />

      <section className="mt-10">
        <h2 className="font-display font-semibold text-xl">{fill(t('oas.key_title'), { period: long })}</h2>
        <div className="overflow-x-auto cq-card mt-3">
          {/* On a phone each table is a block with its figures beside their names (index.css). */}
          <table className="cq-oas-table cq-oas-table-wrap cq-oas-key">
            <thead>
              <tr><th scope="col">{t('oas.table_word')}</th><th scope="col">{t('oas.key_max')}</th><th scope="col">{t('oas.key_ends')}</th></tr>
            </thead>
            <tbody>
              {summary.tables.map((entry) => (
                <tr key={entry.table}>
                  <th scope="row"><Link className="link link-hover" to={oasPath(lang, entry.table)}>{tableTitle(entry.table, lang, t)}</Link></th>
                  <td data-label={t('oas.key_max')}>
                    {hasAllowance(entry.table) ? (
                      <span>
                        <span className="block">{t('oas.word_gis')} {monthly(entry.max_amount_cents, lang, t)}</span>
                        <span className="block">{t('oas.word_allowance')} {monthly(entry.max_allowance_cents, lang, t)}</span>
                      </span>
                    ) : monthly(entry.max_amount_cents, lang, t)}
                  </td>
                  <td data-label={t('oas.key_ends')}>{formatDollars(entry.ends_at_cents, lang)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {changes.length > 0 && (
        <section className="mt-10">
          <h2 className="font-display font-semibold text-xl">{fill(t('oas.change_title'), { period: periodLabel(previous.period, lang) })}</h2>
          <div className="overflow-x-auto cq-card mt-3">
            <table className="cq-oas-table cq-oas-table-wrap">
              <thead>
                <tr>
                  <th scope="col">{t('oas.change_amount')}</th><th scope="col">{periodLabel(previous.period, lang)}</th>
                  <th scope="col">{long}</th><th scope="col">{t('oas.change_change')}</th>
                </tr>
              </thead>
              <tbody>
                {changes.map(([label, before, after]) => (
                  <tr key={label}>
                    <th scope="row">{label}</th><td>{formatMoney(before, lang)}</td><td>{formatMoney(after, lang)}</td>
                    <td>{formatChange(after, before, lang)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {summary.tables.map((entry) => (
        <section key={entry.table} id={'table-' + entry.table} className="mt-10 scroll-mt-24">
          <h2 className="font-display font-semibold text-xl">{tableTitle(entry.table, lang, t)}</h2>
          <p className="text-sm text-base-content/65 mt-1">
            {fill(t('oas.table_summary'), { income: t('oas.income_' + entry.table), maximum: maximumText(entry, lang, t),
              end: formatDollars(entry.ends_at_cents, lang) })}
          </p>
          <BandTable table={entry.table} rows={entry.condensed} lang={lang} t={t} caption={tableTitle(entry.table, lang, t)} />
          <p className="mt-3">
            <Link className="btn btn-sm btn-outline" to={oasPath(lang, entry.table)}>
              {fill(t('oas.all_bands'), { count: formatCount(entry.row_count, lang), table: entry.table })}
            </Link>
          </p>
        </section>
      ))}

      <Sources summary={summary} lang={lang} t={t} />
    </>
  );
}

// The band the browser left in the middle of the window when it scrolled the server's
// HTML (a search result's link to a row of the table), read before the first draw
// replaces that HTML. A reload or a Back visit returns to its saved position instead,
// and an address that names a range goes to that range.
function bandOnScreen(location) {
  if (location.hash || documentWasRestored()) return null;
  return itemOnScreen(document.querySelectorAll('.cq-seo-snapshot table[data-cq-amounts] tbody tr'));
}

function TablePage({ summary, data, table, lang, t, passage = null }) {
  const period = data.period;
  const long = periodLabel(period, lang);
  const entry = data.table;
  const title = tableTitle(table, lang, t);
  const income = t('oas.income_' + table);
  const body = useRef(null);
  // Finding a row marks it in the table that is already drawn; nothing is drawn again.
  const showRow = useCallback((line) => {
    const root = body.current;
    if (!root) return;
    root.querySelector('tr.cq-oas-found')?.classList.remove('cq-oas-found');
    const row = root.querySelector('tr[data-line="' + line + '"]');
    if (!row) return;
    row.classList.add('cq-oas-found');
    row.scrollIntoView?.({ block: 'center' });
    row.focus({ preventScroll: true });
  }, []);
  // The band a visit arrived at sits at the same height in the table drawn here.
  useLayoutEffect(() => {
    const row = passage ? body.current?.querySelector('tr[data-line="' + (passage.index + 1) + '"]') : null;
    if (row) window.scrollBy(0, row.getBoundingClientRect().top - passage.top);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <>
      <Hero chip={t('oas.chip') + ' · ' + long} heading={title + ', ' + long} lang={lang} t={t} table={table}
        intro={fill(t('oas.table_intro'), { title, period: long, income: income.charAt(0).toLowerCase() + income.slice(1), year: period.income_year })}
        note={periodNote(period, lang, t)}>
        <span className="cq-chip cq-chip-mono !whitespace-normal">{t('oas.max_' + amountKind(table))} · {monthly(entry.max_amount_cents, lang, t)}</span>
        {hasAllowance(table) && <span className="cq-chip cq-chip-mono !whitespace-normal">{t('oas.max_allowance')} · {monthly(entry.max_allowance_cents, lang, t)}</span>}
        <span className="cq-chip cq-chip-mono !whitespace-normal">{t('oas.key_ends')} {formatDollars(entry.ends_at_cents, lang)}</span>
        <span className="cq-chip cq-chip-mono !whitespace-normal">{fill(t('oas.bands'), { count: formatCount(entry.row_count, lang) })}</span>
        {hasPension(table) && data.oas && <span className="cq-chip cq-chip-mono !whitespace-normal">{t('oas.oas65')} · {monthly(data.oas.age_65_cents, lang, t)}</span>}
        {hasPension(table) && data.oas && <span className="cq-chip cq-chip-mono !whitespace-normal">{t('oas.oas75')} · {monthly(data.oas.age_75_cents, lang, t)}</span>}
      </Hero>

      <OasLookup summary={summary} lang={lang} t={t} table={table} onShowRow={showRow} />

      <div ref={body}>
        <OasAmountsTable table={table} rows={data.rows} lang={lang} t={t} />
      </div>

      <section className="mt-10">
        <h2 className="font-display font-semibold text-xl">{t('oas.others_title')}</h2>
        <ul className="mt-3 space-y-1.5 text-sm">
          {OAS_TABLES.filter((other) => other !== table).map((other) => (
            <li key={other}><Link className="link link-hover" to={oasPath(lang, other)}>{tableTitle(other, lang, t)}</Link></li>
          ))}
          <li><Link className="link link-hover" to={oasPath(lang)}>{t('oas.hub_long')}</Link></li>
        </ul>
      </section>

      <Sources summary={summary} lang={lang} t={t} table={table} />
    </>
  );
}

function OasView({ language, table }) {
  const { setLang } = useLang();
  const location = useLocation();
  // The page's words are its address's language, from the first render on.
  const t = useMemo(() => {
    const strings = STRINGS[language] || STRINGS.en;
    return (key) => (strings[key] !== undefined ? strings[key] : STRINGS.en[key] !== undefined ? STRINGS.en[key] : key);
  }, [language]);
  // A direct visit carries its answers in the HTML; anything read earlier in the visit is kept.
  const [summary, setSummary] = useState(() => {
    takeOasInitialData({ language, table, location });
    const known = peekOasSummary();
    return known ? { status: 'ready', data: known } : { status: 'loading' };
  });
  const [rows, setRows] = useState(() => {
    const known = table && summary.status === 'ready' ? peekOasTable(summary.data.period.key, table) : null;
    return known ? { status: 'ready', data: known } : { status: 'loading' };
  });
  const [attempt, setAttempt] = useState(0);
  const first = useRef(true);
  // Read while the server's HTML is still on the page (the first draw replaces it).
  const [passage] = useState(() => (table ? bandOnScreen(location) : null));

  useEffect(() => { setLang(language); }, [language, setLang]);
  useEffect(() => { consumeInitialData(); }, []);
  useEffect(() => {
    const seeded = first.current && summary.status === 'ready' && (!table || rows.status === 'ready');
    first.current = false;
    if (seeded) return undefined;
    let cancelled = false;
    setSummary((current) => (current.status === 'ready' ? current : { status: 'loading' }));
    loadOasSummary()
      .then(async (data) => {
        const found = table ? await loadOasTable(data.period.key, table) : null;
        if (cancelled) return;
        setSummary({ status: 'ready', data });
        if (table) setRows({ status: 'ready', data: found });
      })
      .catch((error) => {
        if (cancelled) return;
        setSummary({ status: error && error.status === 503 ? 'unavailable' : 'error' });
      });
    return () => { cancelled = true; };
  }, [attempt]); // eslint-disable-line react-hooks/exhaustive-deps

  const crumbs = [
    { label: t('nav.datasets'), to: '/datasets' },
    { label: t('oas.crumb_dataset'), to: '/datasets/' + OAS_DATASET_ID },
    table ? { label: t('oas.nav'), to: oasPath(language) } : { label: t('oas.nav') },
    table ? { label: t('oas.table_word') + ' ' + table } : null
  ];
  if (summary.status === 'loading' || (summary.status === 'ready' && table && rows.status !== 'ready')) {
    return <LoadingSpinner label={t('oas.loading')} />;
  }
  if (summary.status === 'error') {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="alert alert-error flex flex-wrap justify-between gap-3">
          <span>{t('oas.error')}</span>
          <button type="button" className="btn btn-sm" onClick={() => setAttempt((value) => value + 1)}>{t('oas.retry')}</button>
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-6xl mx-auto px-4 py-8 cq-fade" lang={language}>
      <Breadcrumbs className="mb-5" label={t('breadcrumbs.label')} items={crumbs} />
      {summary.status === 'unavailable' ? (
        <div className="cq-card p-6 sm:p-8">
          <span className="cq-chip">{t('oas.chip')}</span>
          <h1 className="text-3xl sm:text-4xl font-bold font-display mt-3 break-words">
            {table ? t('oas.table_word') + ' ' + table + (language === 'fr' ? ' : ' : ': ') + t('oas.table_' + table) : t('oas.title')}
          </h1>
          <p className="text-base-content/70 mt-3 leading-relaxed max-w-3xl">{t('oas.unavailable')}</p>
          <p className="mt-4"><Link className="btn btn-sm btn-outline" to={'/datasets/' + OAS_DATASET_ID}>{t('oas.dataset_link')}</Link></p>
        </div>
      ) : table ? (
        <TablePage summary={summary.data} data={rows.data} table={table} lang={language} t={t} passage={passage} />
      ) : (
        <Hub summary={summary.data} lang={language} t={t} />
      )}
      <p className="text-xs text-base-content/55 mt-10">{t('oas.source')}</p>
    </div>
  );
}

/** @param {{ language?: string, table?: number | null }} props */
export default function OasPage({ language = 'en', table = null }) {
  // One instance per page: the hub, each table and each language start afresh.
  return <OasView key={language + ':' + (table || 'hub')} language={language} table={table} />;
}
