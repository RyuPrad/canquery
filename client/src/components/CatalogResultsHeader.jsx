import { useId } from 'react';
import { useLang } from '../i18n.jsx';
import { XIcon } from './Icons.jsx';

// Without search text the default order is already the most recently
// updated first, so "Best match" only appears for a search.
function sortOptions(hasQuery) {
  return hasQuery
    ? ['relevance', 'updated', 'title', 'title_desc']
    : ['relevance', 'title', 'title_desc'];
}

export default function CatalogResultsHeader({
  total,
  stale = false,
  sort,
  hasQuery,
  onSort,
  chips = [],
  onRemove
}) {
  const { t, lang } = useLang();
  const sortId = useId();
  const number = (value) => value.toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA');
  const singular = total === 1 || (lang === 'fr' && total === 0);
  const count =
    total == null
      ? t('catalogue.results_unknown')
      : t(singular ? 'catalogue.results_count_one' : 'catalogue.results_count').replace(
          '{count}',
          number(total)
        );
  const selected = !hasQuery && sort === 'updated' ? 'relevance' : sort;
  const optionLabel = (value) =>
    value === 'relevance' ? t(hasQuery ? 'sort.relevance' : 'sort.updated') : t('sort.' + value);
  return (
    <div className="cq-results-header">
      <div className="cq-results-bar">
        <p
          className={'cq-results-count' + (stale ? ' cq-results-stale' : '')}
          role="status"
          aria-live="polite"
        >
          {count}
        </p>
        <div className="cq-sort">
          <label htmlFor={sortId}>{t('sort.label')}</label>
          <select
            id={sortId}
            className="select select-sm bg-base-200 border-base-content/10 rounded-lg"
            value={selected}
            onChange={(event) => onSort(event.target.value)}
          >
            {sortOptions(hasQuery).map((value) => (
              <option key={value} value={value}>
                {optionLabel(value)}
              </option>
            ))}
          </select>
        </div>
      </div>
      {chips.length > 0 && (
        <ul className="cq-results-chips" aria-label={t('filters.active')}>
          {chips.map((chip) => (
            <li key={chip.key + ':' + chip.value}>
              <button
                type="button"
                className="cq-pill cq-pill-active inline-flex items-center gap-1.5"
                onClick={() => onRemove(chip)}
                aria-label={t('filters.remove').replace('{label}', chip.label)}
              >
                {chip.label}
                <XIcon size={11} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
