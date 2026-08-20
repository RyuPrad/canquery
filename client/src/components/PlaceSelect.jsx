import { MapPinIcon } from './Icons.jsx';
import { useLang } from '../i18n.jsx';

export default function PlaceSelect({ value, onChange, places, loading = false, className = '' }) {
  const { lang, t } = useLang();
  const sorted = (rows) => [...rows].sort((a, b) =>
    (a.name?.[lang] || a.name?.en || '').localeCompare(b.name?.[lang] || b.name?.en || '')
  );
  const rows = places || [];
  const regions = sorted(rows.filter(place => place.kind === 'region'));
  const regionIds = new Set(regions.map(place => place.id));
  const municipalityGroups = regions.map(region => ({
    key: 'municipalities-' + region.id,
    label: t('places.municipalities_in') + ' ' + (region.name?.[lang] || region.name?.en),
    rows: sorted(rows.filter(place => place.kind === 'municipality' && regionIds.has(place.parent?.id) && place.parent.id === region.id))
  }));
  const groups = [
    { key: 'region', label: t('places.featured_region'), rows: regions },
    ...municipalityGroups,
    {
      key: 'city', label: t('places.featured_cities'),
      rows: sorted(rows.filter(place => place.kind === 'municipality' && !regionIds.has(place.parent?.id)))
    },
    { key: 'other', label: t('places.other_places'), rows: sorted(rows.filter(place => !['region', 'municipality'].includes(place.kind))) },
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
