import { useEffect, useMemo, useState } from 'react';
import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import { fill } from '../utils/text.js';
import { consumeInitialData } from '../utils/initialData.js';
import { loadPortalDirectory, peekPortalDirectory, takePortalInitialData } from '../utils/portalData.js';
import { LEVELS, PLATFORM_NAMES, SORT_KEYS, cataloguePath, dayLabel, filterPortals, formatCount, localName, sortPortals } from '../utils/portals.js';
import Breadcrumbs from '../components/Breadcrumbs.jsx';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import SearchBar from '../components/SearchBar.jsx';
import { ExternalIcon } from '../components/Icons.jsx';
import useMediaQuery from '../hooks/useMediaQuery.js';

// The directory of the open-data portals CanQuery mirrors: one row per portal
// with what is mirrored from it, filters above the table and a sort on its
// columns. The page holds every portal, so filtering and sorting ask nothing of
// the server; the address keeps the filters and the sort (written in place, so
// Back leaves the page).
const FILTERS = ['q', 'level', 'platform', 'province'];

const platformName = (id, t) => PLATFORM_NAMES[id] || t('portals.platform_other');

function Stat({ label, value }) {
  return (
    <div className="cq-card p-4">
      <div className="font-display font-bold text-2xl tabular-nums">{value}</div>
      <div className="text-xs text-base-content/60 mt-1">{label}</div>
    </div>
  );
}

// A column heading that sorts: pressing it again turns the order around.
function SortHeader({ column, label, sort, onSort, numeric = false, t }) {
  const active = sort.key === column;
  return (
    <th scope="col" aria-sort={active ? (sort.descending ? 'descending' : 'ascending') : 'none'} className={numeric ? 'cq-portal-num' : undefined}>
      <button type="button" className="cq-portal-sort" onClick={() => onSort(column)} title={fill(t('portals.sort_by'), { column: label })}>
        {label}
        <span aria-hidden="true" className={active ? '' : 'opacity-0'}>{sort.descending ? '↓' : '↑'}</span>
      </button>
    </th>
  );
}

// What a portal's row and its card both print: its name as a link to the official site, its place on CanQuery,
// each count as a link to those datasets in the catalogue, and its licence.
function portalParts(portal, t, lang) {
  const name = localName(portal.name, lang);
  // The mark of an outside link stays with the name's last word, never alone on a line of its own.
  const words = name.split(' ');
  const last = words.pop();
  const count = (value, key, only) => (value > 0
    ? <Link to={cataloguePath(portal.id, only)} aria-label={fill(t(key), { count: formatCount(value, lang), portal: name })}>{formatCount(value, lang)}</Link>
    : formatCount(value, lang));
  const province = portal.province && portal.place && portal.province.slug !== portal.place.slug ? localName(portal.province.name, lang) : '';
  return {
    name: portal.homepage_url ? (
      <a href={portal.homepage_url} target="_blank" rel="noopener noreferrer" className="link link-hover"
        title={fill(t('portals.official_site'), { portal: name })}>
        {words.length > 0 && words.join(' ') + ' '}
        <span className="whitespace-nowrap">{last}<ExternalIcon size={11} className="inline-block ml-1 opacity-50" /></span>
      </a>
    ) : name,
    place: portal.level === 'federal' ? t('portals.canada') : portal.place ? (
      <>
        <Link to={'/places/' + encodeURIComponent(portal.place.slug)} className="link link-hover">{localName(portal.place.name, lang)}</Link>
        {province && <span className="text-base-content/55">, {province}</span>}
      </>
    ) : null,
    platform: platformName(portal.platform, t),
    datasets: count(portal.datasets, 'portals.datasets_of'),
    tables: count(portal.tables, 'portals.tables_of', 'queryable'),
    maps: count(portal.maps, 'portals.maps_of', 'mappable'),
    licence: !portal.licence ? <span className="text-base-content/55">{t('portals.licence_each')}</span>
      : portal.licence.url ? (
        <a href={portal.licence.url} target="_blank" rel="noopener noreferrer" className="link link-hover">{localName(portal.licence.title, lang)}</a>
      ) : localName(portal.licence.title, lang),
    read: dayLabel(portal.last_synced_at, lang)
  };
}

function PortalRow({ portal, t, lang }) {
  const parts = portalParts(portal, t, lang);
  return (
    <tr>
      <th scope="row">{parts.name}</th>
      <td className="cq-portal-place">{parts.place}</td>
      <td>{parts.platform}</td>
      <td className="cq-portal-num">{parts.datasets}</td>
      <td className="cq-portal-num">{parts.tables}</td>
      <td className="cq-portal-num">{parts.maps}</td>
      <td className="cq-portal-wrap">{parts.licence}</td>
      <td className="cq-portal-num">{parts.read}</td>
    </tr>
  );
}

// On a phone or a tablet a row of eight columns would hide its figures off screen: each portal is a card there.
function PortalCard({ portal, t, lang }) {
  const parts = portalParts(portal, t, lang);
  const figure = (label, value) => (
    <div>
      <dt className="text-[0.6875rem] text-base-content/55">{label}</dt>
      <dd className="text-sm font-medium tabular-nums">{value}</dd>
    </div>
  );
  return (
    <li className="cq-card p-4">
      <h3 className="font-medium leading-snug break-words">{parts.name}</h3>
      <p className="text-sm text-base-content/70 mt-1">
        {parts.place}{parts.place ? ' · ' : ''}{parts.platform}
      </p>
      <dl className="cq-portal-figures grid grid-cols-3 gap-3 mt-3">
        {figure(t('portals.col_datasets'), parts.datasets)}
        {figure(t('portals.col_tables'), parts.tables)}
        {figure(t('portals.col_maps'), parts.maps)}
      </dl>
      <dl className="text-xs text-base-content/70 mt-3 space-y-1">
        <div><dt className="inline text-base-content/55">{t('portals.card_licence')} </dt><dd className="inline break-words">{parts.licence}</dd></div>
        {parts.read && <div><dt className="inline text-base-content/55">{t('portals.card_read')} </dt><dd className="inline">{parts.read}</dd></div>}
      </dl>
    </li>
  );
}

// Portals and datasets per group, with a bar scaled to the group with the most portals.
function Groups({ title, rows, label, t, lang }) {
  const max = Math.max(1, ...rows.map((row) => row.portals));
  return (
    <section className="cq-card p-5">
      <h3 className="font-display font-semibold">{title}</h3>
      <ul className="mt-2">
        {rows.map((row) => (
          <li key={row.id} className="py-1.5">
            <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5 text-sm">
              <span className="min-w-0 break-words">{label(row)}</span>
              <span className="ml-auto font-mono text-xs text-base-content/65">
                {row.portals === 1 ? fill(t('portals.group_count_one'), { datasets: formatCount(row.datasets, lang) })
                  : fill(t('portals.group_count'), { portals: formatCount(row.portals, lang), datasets: formatCount(row.datasets, lang) })}
              </span>
            </div>
            <div className="h-1.5 mt-1 rounded-full bg-base-content/10 overflow-hidden" aria-hidden="true">
              <div className="h-full rounded-full bg-primary/70" style={{ width: Math.max(2, Math.round((row.portals / max) * 100)) + '%' }} />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export default function PortalsPage() {
  const { t, lang } = useLang();
  const location = useLocation();
  const [params, setParams] = useSearchParams();
  const [page, setPage] = useState(() => {
    takePortalInitialData({ location });
    const known = peekPortalDirectory(Date.now(), { stale: true });
    return known ? { status: 'ready', data: known } : { status: 'loading' };
  });
  const [attempt, setAttempt] = useState(0);
  // The exceptional layout is the matching case: without matchMedia the table is drawn.
  const narrow = useMediaQuery('(max-width: 1023px)');
  useEffect(() => { consumeInitialData(); }, []);
  useEffect(() => {
    let current = true;
    // What is here is shown at once; when it is no longer fresh it is read again behind the page.
    if (peekPortalDirectory()) return undefined;
    loadPortalDirectory()
      .then((data) => { if (current) setPage({ status: 'ready', data }); })
      .catch((error) => {
        if (!current) return;
        setPage((previous) => (previous.status === 'ready' ? previous
          : { status: error && error.status === 503 ? 'unavailable' : 'error' }));
      });
    return () => { current = false; };
  }, [attempt]);

  const filters = { q: params.get('q') || '', level: params.get('level') || '', platform: params.get('platform') || '',
    province: params.get('province') || '' };
  const sortKey = SORT_KEYS.includes(params.get('sort')) ? params.get('sort') : 'datasets';
  const sort = { key: sortKey, descending: params.has('order') ? params.get('order') !== 'asc' : sortKey !== 'name' };
  const update = (changes) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value); else next.delete(key);
    }
    setParams(next, { replace: true });
  };
  const onSort = (key) => {
    const descending = sort.key === key ? !sort.descending : key !== 'name';
    // The order a column starts with is not written: only a turned one is.
    update({ sort: key === 'datasets' ? '' : key, order: descending === (key !== 'name') ? '' : descending ? 'desc' : 'asc' });
  };
  const filtered = FILTERS.some((key) => params.get(key));

  const data = page.status === 'ready' ? page.data : null;
  const rows = useMemo(() => (data ? sortPortals(filterPortals(data.portals, filters), sort, lang) : []),
    [data, filters.q, filters.level, filters.platform, filters.province, sort.key, sort.descending, lang]); // eslint-disable-line react-hooks/exhaustive-deps

  const crumbs = [{ label: 'CanQuery', to: '/' }, { label: t('portals.crumb') }];
  if (page.status === 'loading') return <LoadingSpinner label={t('portals.loading')} />;
  if (page.status === 'error') {
    return (
      <div className="max-w-5xl mx-auto px-4 py-8">
        <div className="alert alert-error flex flex-wrap justify-between gap-3">
          <span>{t('portals.error')}</span>
          <button type="button" className="btn btn-sm" onClick={() => { setPage({ status: 'loading' }); setAttempt((value) => value + 1); }}>
            {t('portals.retry')}
          </button>
        </div>
      </div>
    );
  }
  const level = (id) => (data.levels.find((row) => row.id === id) || { portals: 0 }).portals;
  return (
    <div className="max-w-6xl mx-auto px-4 py-8 cq-fade">
      <Breadcrumbs className="mb-5" label={t('breadcrumbs.label')} items={crumbs} />
      <div className="cq-card p-6 sm:p-8 overflow-hidden relative">
        <div className="absolute inset-0 cq-grid-bg opacity-40 pointer-events-none" />
        <div className="relative">
          <span className="cq-chip">{t('portals.chip')}</span>
          <h1 className="text-3xl sm:text-4xl font-bold font-display mt-3">{t('portals.title')}</h1>
          <p className="text-base-content/70 mt-3 leading-relaxed max-w-3xl">
            {!data ? t('portals.unavailable') : fill(t(data.totals.portals === 1 ? 'portals.intro_one' : 'portals.intro'), {
              portals: formatCount(data.totals.portals, lang), federal: formatCount(level('federal'), lang),
              provincial: formatCount(level('provincial'), lang), municipal: formatCount(level('municipal'), lang),
              datasets: formatCount(data.totals.datasets, lang)
            })}
          </p>
        </div>
      </div>

      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 mt-6 lg:grid-cols-4">
            <Stat label={t('portals.stat_portals')} value={formatCount(data.totals.portals, lang)} />
            <Stat label={t('portals.stat_datasets')} value={formatCount(data.totals.datasets, lang)} />
            <Stat label={t('portals.stat_provinces')} value={formatCount(data.totals.provinces, lang)} />
            <Stat label={t('portals.stat_read')} value={dayLabel(data.updated_at, lang) || '—'} />
          </div>

          <section className="mt-8" aria-labelledby="portals-table">
            <h2 id="portals-table" className="font-display font-semibold text-xl">{t('portals.table_title')}</h2>
            <div className="grid gap-3 mt-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_repeat(3,minmax(0,1fr))]">
              <SearchBar value={filters.q} onChange={(value) => update({ q: value })} placeholder={t('portals.search_placeholder')} maxLength={80} />
              <select className="select select-bordered w-full" aria-label={t('portals.level_label')} value={filters.level}
                onChange={(event) => update({ level: event.target.value })}>
                <option value="">{t('portals.level_any')}</option>
                {LEVELS.filter((id) => data.levels.some((row) => row.id === id)).map((id) => <option key={id} value={id}>{t('portals.level_' + id)}</option>)}
              </select>
              <select className="select select-bordered w-full" aria-label={t('portals.platform_label')} value={filters.platform}
                onChange={(event) => update({ platform: event.target.value })}>
                <option value="">{t('portals.platform_any')}</option>
                {data.platforms.map((row) => <option key={row.id} value={row.id}>{platformName(row.id, t)}</option>)}
              </select>
              <select className="select select-bordered w-full" aria-label={t('portals.province_label')} value={filters.province}
                onChange={(event) => update({ province: event.target.value })}>
                <option value="">{t('portals.province_any')}</option>
                {[...data.provinces].sort((a, b) => localName(a.name, lang).localeCompare(localName(b.name, lang), lang))
                  .map((row) => <option key={row.id} value={row.id}>{localName(row.name, lang)}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 text-sm text-base-content/65">
              <p role="status">
                {rows.length !== data.portals.length
                  ? fill(t('portals.showing'), { count: formatCount(rows.length, lang), total: formatCount(data.portals.length, lang) })
                  : data.portals.length === 1 ? t('portals.showing_all_one')
                    : fill(t('portals.showing_all'), { total: formatCount(data.portals.length, lang) })}
              </p>
              {filtered && (
                <button type="button" className="link link-hover" onClick={() => update({ q: '', level: '', platform: '', province: '' })}>
                  {t('portals.clear')}
                </button>
              )}
            </div>
            {rows.length === 0 ? (
              <p className="mt-4 text-sm">{t('portals.none')}</p>
            ) : narrow ? (
              <>
                <label className="flex items-center gap-2 mt-3 text-sm sm:max-w-xs">
                  <span className="text-base-content/65 shrink-0">{t('portals.sort_label')}</span>
                  <select className="select select-bordered select-sm w-full" value={sort.key + ':' + (sort.descending ? 'desc' : 'asc')}
                    onChange={(event) => {
                      const [key, order] = event.target.value.split(':');
                      const descending = order === 'desc';
                      update({ sort: key === 'datasets' ? '' : key, order: descending === (key !== 'name') ? '' : order });
                    }}>
                    {[['datasets', 'desc', 'col_datasets'], ['name', 'asc', 'col_portal'], ['tables', 'desc', 'col_tables'],
                      ['maps', 'desc', 'col_maps'], ['read', 'desc', 'col_read']].map(([key, order, label]) => (
                      <option key={key} value={key + ':' + order}>{t('portals.' + label)}</option>
                    ))}
                    {/* A turned order chosen on a wider screen stays selectable, so the list never shows a choice it does not have. */}
                    {sort.descending !== (sort.key !== 'name') && (
                      <option value={sort.key + ':' + (sort.descending ? 'desc' : 'asc')}>
                        {t('portals.col_' + { datasets: 'datasets', name: 'portal', tables: 'tables', maps: 'maps', read: 'read' }[sort.key])} {sort.descending ? '↓' : '↑'}
                      </option>
                    )}
                  </select>
                </label>
                <ul className="grid gap-3 mt-3 sm:grid-cols-2" aria-label={t('portals.table_title')}>
                  {rows.map((portal) => <PortalCard key={portal.id} portal={portal} t={t} lang={lang} />)}
                </ul>
              </>
            ) : (
              <div className="overflow-x-auto cq-card mt-3" tabIndex={0} role="region" aria-label={t('portals.table_label')}>
                <table className="cq-portal-table">
                  <thead>
                    <tr>
                      <SortHeader column="name" label={t('portals.col_portal')} sort={sort} onSort={onSort} t={t} />
                      <th scope="col">{t('portals.col_place')}</th>
                      <th scope="col">{t('portals.col_platform')}</th>
                      <SortHeader column="datasets" label={t('portals.col_datasets')} sort={sort} onSort={onSort} numeric t={t} />
                      <SortHeader column="tables" label={t('portals.col_tables')} sort={sort} onSort={onSort} numeric t={t} />
                      <SortHeader column="maps" label={t('portals.col_maps')} sort={sort} onSort={onSort} numeric t={t} />
                      <th scope="col">{t('portals.col_licence')}</th>
                      <SortHeader column="read" label={t('portals.col_read')} sort={sort} onSort={onSort} numeric t={t} />
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((portal) => <PortalRow key={portal.id} portal={portal} t={t} lang={lang} />)}
                  </tbody>
                </table>
              </div>
            )}
          </section>

          <div className="grid gap-4 mt-8 lg:grid-cols-3">
            <Groups title={t('portals.by_level')} rows={data.levels} label={(row) => t('portals.level_' + row.id)} t={t} lang={lang} />
            <Groups title={t('portals.by_platform')} rows={data.platforms} label={(row) => platformName(row.id, t)} t={t} lang={lang} />
            <Groups title={t('portals.by_province')} rows={data.provinces} label={(row) => localName(row.name, lang)} t={t} lang={lang} />
          </div>

          <section className="mt-8 max-w-3xl" aria-labelledby="portals-method">
            <h2 id="portals-method" className="font-display font-semibold text-xl">{t('portals.method_title')}</h2>
            {['method_datasets', 'method_tables', 'method_licence'].map((key) => (
              <p key={key} className="text-sm text-base-content/75 mt-3 leading-relaxed">{t('portals.' + key)}</p>
            ))}
            <div className="flex flex-wrap gap-2 mt-4">
              <Link to="/about#data-sources" className="cq-chip !whitespace-normal max-w-full break-words hover:border-primary/40">{t('portals.method_link')}</Link>
              <Link to="/places" className="cq-chip !whitespace-normal max-w-full break-words hover:border-primary/40">{t('portals.explore_places')}</Link>
              <Link to="/organizations" className="cq-chip !whitespace-normal max-w-full break-words hover:border-primary/40">{t('portals.explore_organizations')}</Link>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
