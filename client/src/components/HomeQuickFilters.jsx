import { useId } from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import { FilterIcon, MapIcon, TableIcon } from './Icons.jsx';
import './HomeQuickFilters.css';

// The filters most searches start from, shown under the homepage search so a
// visitor sees what they can narrow by before typing. Counts follow the
// sidebar's rule: each group is counted without its own filter, so a count
// shows what choosing that value would match.
const QUICK_FILTERS = [
  { group: 'level', key: 'level', value: 'federal', label: 'filters.level_federal' },
  { group: 'level', key: 'level', value: 'provincial', label: 'filters.level_provincial' },
  { group: 'level', key: 'level', value: 'municipal', label: 'filters.level_municipal' },
  { group: 'format', key: 'format', value: 'CSV' },
  {
    group: 'access',
    flag: 'queryable',
    value: 'queryable',
    label: 'filters.access_queryable',
    Icon: TableIcon
  },
  {
    group: 'access',
    flag: 'mappable',
    value: 'mappable',
    label: 'filters.access_mappable',
    Icon: MapIcon
  }
];

export default function HomeQuickFilters({
  search,
  facets,
  total = null,
  stale = false,
  filtering = false,
  onToggle,
  onFlag,
  onAllFilters
}) {
  const { t, lang } = useLang();
  const id = useId();
  const number = (value) => value.toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA');
  const datasets = (count) =>
    t(
      count === 1 || (lang === 'fr' && count === 0)
        ? 'catalogue.results_count_one'
        : 'catalogue.results_count'
    ).replace('{count}', number(count));
  const countOf = (group, value) => {
    if (!facets || !facets[group]) return null;
    const hit = facets[group].find((item) => item.value === value);
    return hit && Number.isSafeInteger(hit.count) ? hit.count : 0;
  };
  // Once a search is running, the label is its result count; the group keeps
  // its name for assistive technology either way.
  const counted = filtering && total != null;

  return (
    <div
      className={'cq-quick' + (stale ? ' cq-quick-stale' : '')}
      role="group"
      aria-label={t('home.quick_label')}
    >
      <span className="cq-quick-label" aria-hidden={counted ? undefined : true}>
        <FilterIcon size={14} className="cq-fg-red" />
        {counted ? datasets(total) : t('home.quick_label')}
      </span>
      <ul className="cq-quick-list">
        {QUICK_FILTERS.map((item, index) => {
          const selected = item.flag
            ? Boolean(search[item.flag])
            : search[item.key].includes(item.value);
          const count = countOf(item.group, item.value);
          // Choosing a value nothing matches would only empty the results.
          const empty = count === 0 && !selected && !stale;
          const countId = id + '-count-' + index;
          const { Icon } = item;
          return (
            <li key={item.group + ':' + item.value}>
              <button
                type="button"
                className={'cq-pill cq-quick-chip' + (selected ? ' cq-pill-active' : '')}
                aria-pressed={selected}
                aria-describedby={count == null ? undefined : countId}
                disabled={empty}
                onClick={() => (item.flag ? onFlag(item.flag) : onToggle(item.key, item.value))}
              >
                {Icon && <Icon size={12} />}
                {item.label ? t(item.label) : item.value}
                {count != null && (
                  <span className="cq-quick-count" aria-hidden="true">
                    {number(count)}
                  </span>
                )}
              </button>
              {count != null && (
                <span id={countId} className="sr-only">
                  {datasets(count)}
                </span>
              )}
            </li>
          );
        })}
        <li>
          {filtering ? (
            <button type="button" className="cq-quick-all" onClick={onAllFilters}>
              {t('home.quick_all')} <span aria-hidden="true">↓</span>
            </button>
          ) : (
            <Link to="/datasets" className="cq-quick-all" onClick={onAllFilters}>
              {t('home.quick_all')} <span aria-hidden="true">→</span>
            </Link>
          )}
        </li>
      </ul>
    </div>
  );
}
