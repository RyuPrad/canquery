import { MapPinIcon } from './Icons.jsx';
import { useLang } from '../i18n.jsx';

export default function PlaceSelect({ value, onChange, places, loading = false, className = '' }) {
  const { lang, t } = useLang();
  const sorted = (rows) => [...rows].sort((a, b) =>
    (a.name?.[lang] || a.name?.en || '').localeCompare(b.name?.[lang] || b.name?.en || '')
  );
  const groups = [
    { key: 'region', label: t('places.featured_region'), rows: sorted((places || []).filter(place => place.kind === 'region')) },
    { key: 'municipality', label: t('places.durham_municipalities'), rows: sorted((places || []).filter(place => place.kind === 'municipality')) },
    { key: 'other', label: t('places.other_places'), rows: sorted((places || []).filter(place => !['region', 'municipality'].includes(place.kind))) },
  ].filter(group => group.rows.length > 0);
  return (
    <label className={'cq-place-select ' + className}>
      <MapPinIcon size={15} className="shrink-0 text-secondary" />
      <span className="sr-only">{t('places.choose')}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={loading}
        aria-label={t('places.choose')}
      >
        <option value="">{t('places.all_canada')}</option>
        {groups.map(group => (
          <optgroup key={group.key} label={group.label}>
            {group.rows.map(place => (
              <option key={place.id} value={place.slug}>
                {place.name?.[lang] || place.name?.en || place.slug} ({place.dataset_count})
              </option>
            ))}
          </optgroup>
        ))}
      </select>
    </label>
  );
}
