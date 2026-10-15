import { useId, useState } from 'react';
import { useLang } from '../i18n.jsx';
import PlaceSelect from './PlaceSelect.jsx';
import { FilterIcon } from './Icons.jsx';
import { CATALOG_LEVELS } from '../utils/catalogSearchState.js';
import './CatalogFilters.css';

// Shown until the first counts arrive, so the most common formats are one
// click away even when counts are unavailable.
const DEFAULT_FORMATS = ['CSV', 'XLSX', 'JSON', 'GEOJSON', 'PDF', 'XML'];
const VISIBLE_OPTIONS = 8;

const fold = (value) =>
  String(value || '')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase();

function FilterGroup({ title, selectedCount, defaultOpen = false, onOpen, children }) {
  const { t } = useLang();
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      className="cq-filter-group"
      open={open}
      onToggle={(event) => {
        setOpen(event.currentTarget.open);
        if (event.currentTarget.open && onOpen) onOpen();
      }}
    >
      <summary>
        <span className="cq-filter-group-title">{title}</span>
        {selectedCount > 0 && (
          <span className="cq-filter-selected">
            {selectedCount}
            <span className="sr-only"> {t('filters.selected')}</span>
          </span>
        )}
      </summary>
      <div className="cq-filter-body">{children}</div>
    </details>
  );
}

function OptionList({ legend, options, selected, onToggle, findLabel }) {
  const { t, lang } = useLang();
  const id = useId();
  const [expanded, setExpanded] = useState(false);
  const [needle, setNeedle] = useState('');
  const number = (value) => value.toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA');
  const datasets = (count) =>
    t(
      count === 1 || (lang === 'fr' && count === 0)
        ? 'catalogue.results_count_one'
        : 'catalogue.results_count'
    ).replace('{count}', number(count));
  const isSelected = (value) => selected.includes(value);
  const shown = expanded
    ? options.filter(
        (option) => !needle || isSelected(option.value) || fold(option.label).includes(fold(needle))
      )
    : options.filter((option, index) => index < VISIBLE_OPTIONS || isSelected(option.value));
  return (
    <fieldset className="cq-filter-options">
      <legend className="sr-only">{legend}</legend>
      {expanded && findLabel && (
        <input
          type="search"
          className="cq-filter-input cq-filter-find"
          value={needle}
          onChange={(event) => setNeedle(event.target.value)}
          placeholder={findLabel}
          aria-label={findLabel}
        />
      )}
      <ul>
        {shown.map((option, index) => {
          const countId = id + '-count-' + index;
          return (
            <li key={option.value}>
              <label className="cq-filter-option">
                <input
                  type="checkbox"
                  checked={isSelected(option.value)}
                  onChange={() => onToggle(option.value)}
                  aria-describedby={option.count == null ? undefined : countId}
                />
                <span className="cq-filter-label">{option.label}</span>
                {option.count != null && (
                  <span className="cq-filter-count" aria-hidden="true">
                    {number(option.count)}
                  </span>
                )}
              </label>
              {option.count != null && (
                <span id={countId} className="sr-only">
                  {datasets(option.count)}
                </span>
              )}
            </li>
          );
        })}
      </ul>
      {expanded && shown.length === 0 && <p className="cq-filter-empty">{t('filters.no_match')}</p>}
      {options.length > VISIBLE_OPTIONS && (
        <button
          type="button"
          className="cq-filter-more"
          aria-expanded={expanded}
          onClick={() => {
            setExpanded((value) => !value);
            setNeedle('');
          }}
        >
          {expanded
            ? t('filters.show_fewer')
            : t('filters.show_all').replace('{count}', number(options.length))}
        </button>
      )}
    </fieldset>
  );
}

export default function CatalogFilters({
  search,
  facets,
  status = 'idle',
  stale = false,
  onToggle,
  onFlag,
  onReset,
  onRetry,
  canReset = true,
  showPlace = false,
  places = [],
  placesLoading = false,
  onPlace,
  onPlaceOpen
}) {
  const { t, lang } = useLang();
  const counted = Boolean(facets);
  /** @param {{ value: string, label?: { en?: string | null, fr?: string | null } }} item */
  const labelOf = (item) =>
    (item.label && (item.label[lang] || item.label.en || item.label.fr)) || item.value;
  const countOf = (group, value) => {
    const hit = facets && facets[group] ? facets[group].find((item) => item.value === value) : null;
    return hit ? hit.count : counted ? 0 : null;
  };
  // Selected values always stay visible so they can be cleared, even when the
  // API did not count them.
  const listed = (group, values, fallback = []) => {
    const rows = facets && facets[group] ? facets[group] : fallback.map((value) => ({ value }));
    const options = rows.map((item) => ({
      value: item.value,
      label: labelOf(item),
      count: Number.isSafeInteger(item.count) ? item.count : countOf(group, item.value)
    }));
    for (const value of values) {
      if (!options.some((option) => option.value === value)) {
        options.push({ value, label: value, count: countOf(group, value) });
      }
    }
    return options;
  };
  const access = [
    ...(search.queryable ? ['queryable'] : []),
    ...(search.mappable ? ['mappable'] : [])
  ];
  const organizations = listed('organization', search.org);
  const sources = listed('source', search.source);
  const keywords = listed('keyword', search.keyword);

  return (
    <div className="cq-filter-panel" aria-busy={status === 'loading'}>
      <h2 className="cq-filter-heading">
        <FilterIcon size={15} className="cq-fg-red" />
        {t('filters.title')}
      </h2>
      {status === 'unavailable' && (
        <p role="status" className="cq-filter-note">
          {t('filters.unavailable')}{' '}
          {onRetry && (
            <button type="button" className="link" onClick={onRetry}>
              {t('common.retry')}
            </button>
          )}
        </p>
      )}
      <div className={'cq-filter-groups' + (stale && counted ? ' cq-filter-stale' : '')}>
        {showPlace && (
          <FilterGroup
            title={t('filters.place')}
            selectedCount={search.place ? 1 : 0}
            defaultOpen={Boolean(search.place)}
            onOpen={onPlaceOpen}
          >
            <PlaceSelect
              value={search.place}
              onChange={onPlace}
              places={places}
              loading={placesLoading}
              className="cq-filter-place"
            />
          </FilterGroup>
        )}
        <FilterGroup title={t('filters.level')} selectedCount={search.level.length} defaultOpen>
          <OptionList
            legend={t('filters.level')}
            options={CATALOG_LEVELS.map((value) => ({
              value,
              label: t('filters.level_' + value),
              count: countOf('level', value)
            }))}
            selected={search.level}
            onToggle={(value) => onToggle('level', value)}
          />
        </FilterGroup>
        <FilterGroup title={t('filters.access')} selectedCount={access.length} defaultOpen>
          <OptionList
            legend={t('filters.access')}
            options={['queryable', 'mappable'].map((value) => ({
              value,
              label: t('filters.access_' + value),
              count: countOf('access', value)
            }))}
            selected={access}
            onToggle={onFlag}
          />
        </FilterGroup>
        <FilterGroup title={t('filters.format')} selectedCount={search.format.length} defaultOpen>
          <OptionList
            legend={t('filters.format')}
            options={listed('format', search.format, DEFAULT_FORMATS)}
            selected={search.format}
            onToggle={(value) => onToggle('format', value)}
            findLabel={t('filters.find_format')}
          />
        </FilterGroup>
        {organizations.length > 0 && (
          <FilterGroup
            title={t('filters.organization')}
            selectedCount={search.org.length}
            defaultOpen
          >
            <OptionList
              legend={t('filters.organization')}
              options={organizations}
              selected={search.org}
              onToggle={(value) => onToggle('org', value)}
              findLabel={t('filters.find_organization')}
            />
          </FilterGroup>
        )}
        {sources.length > 0 && (
          <FilterGroup
            title={t('filters.source')}
            selectedCount={search.source.length}
            defaultOpen={search.source.length > 0}
          >
            <OptionList
              legend={t('filters.source')}
              options={sources}
              selected={search.source}
              onToggle={(value) => onToggle('source', value)}
              findLabel={t('filters.find_source')}
            />
          </FilterGroup>
        )}
        {keywords.length > 0 && (
          <FilterGroup
            title={t('filters.keyword')}
            selectedCount={search.keyword.length}
            defaultOpen={search.keyword.length > 0}
          >
            <OptionList
              legend={t('filters.keyword')}
              options={keywords}
              selected={search.keyword}
              onToggle={(value) => onToggle('keyword', value)}
              findLabel={t('filters.find_keyword')}
            />
          </FilterGroup>
        )}
      </div>
      <button
        type="button"
        className="btn btn-sm cq-filter-reset"
        onClick={onReset}
        disabled={!canReset}
      >
        {t('filters.reset')}
      </button>
    </div>
  );
}
