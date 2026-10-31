import { useEffect, useRef, useState } from 'react';
import { useLang } from '../i18n.jsx';
import { fill } from '../utils/text.js';
import { yearLabel } from '../utils/datasetFileFilter.js';
import { SearchIcon } from './Icons.jsx';

const SELECT_CLASS = 'select select-sm bg-base-200 border-base-content/10 rounded-lg w-auto max-w-full';

// Narrows one dataset's list of files. The search box is always there; a
// dropdown appears only when its choices can narrow the list. Everything is an
// input, never a link, so filtered lists open no crawl paths.
export default function DatasetFileFilter({ query, onQuery, filter, facets, total, shown, active, onSelect, onClear }) {
  const { t, lang } = useLang();
  const searchRef = useRef(null);
  const number = (value) => value.toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA');
  const showing = fill(t(total === 1 ? 'dataset.filter.showing_one' : 'dataset.filter.showing'), {
    shown: number(shown),
    total: number(total),
  });
  // Screen readers hear the new count once typing or choosing settles; the
  // count a page opens with is not announced, and clearing silences it at once.
  const message = active ? showing : '';
  const [announcement, setAnnouncement] = useState('');
  const settledRef = useRef(false);
  useEffect(() => {
    if (!settledRef.current) {
      settledRef.current = true;
      return undefined;
    }
    if (!message) {
      setAnnouncement('');
      return undefined;
    }
    const timer = setTimeout(() => setAnnouncement(message), 500);
    return () => clearTimeout(timer);
  }, [message]);
  const groups = [
    { key: 'year', label: t('dataset.filter.year'), all: t('dataset.filter.year_all'), name: yearLabel },
    { key: 'format', label: t('filters.format'), all: t('dataset.filter.format_all'), name: (value) => value },
    {
      key: 'language',
      label: t('dataset.filter.language'),
      all: t('dataset.filter.language_all'),
      name: (value) => t(value === 'other' ? 'dataset.filter.language_other' : 'preview.language_' + value),
    },
  ];
  const clear = () => {
    onClear();
    searchRef.current?.focus();
  };

  return (
    <form role="search" aria-label={t('dataset.filter.label')} className="space-y-2" onSubmit={(event) => event.preventDefault()}>
      <div className="flex flex-wrap items-center gap-2">
        <div className="cq-search cq-search-sm w-full sm:w-72">
          <SearchIcon size={14} className="opacity-40 shrink-0" />
          <input
            ref={searchRef}
            type="text"
            enterKeyHint="search"
            placeholder={t('dataset.filter.search')}
            aria-label={t('dataset.filter.search')}
            value={query}
            maxLength={200}
            onChange={(event) => onQuery(event.target.value)}
          />
        </div>
        {groups.map(({ key, label, all, name }) => {
          const group = facets[key];
          if (!group.shown) return null;
          const selected = filter[key] || '';
          return (
            <select
              key={key}
              className={SELECT_CLASS}
              aria-label={label}
              value={selected}
              onChange={(event) => onSelect(key, event.target.value)}
            >
              <option value="">{all}</option>
              {group.options.map((option) => (
                <option key={option.value} value={option.value} disabled={option.count === 0 && option.value !== selected}>
                  {name(option.value)} ({number(option.count)})
                </option>
              ))}
            </select>
          );
        })}
      </div>
      {active && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-base-content/70">
          <span>{showing}</span>
          <button type="button" className="btn btn-xs btn-ghost" onClick={clear}>
            {t('dataset.filter.clear')}
          </button>
        </div>
      )}
      <p className="sr-only" role="status">{announcement}</p>
    </form>
  );
}
