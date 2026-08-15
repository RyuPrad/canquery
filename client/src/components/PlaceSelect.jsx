import { MapPinIcon } from './Icons.jsx';
import { useLang } from '../i18n.jsx';

const KIND_ORDER = { municipality: 0, region: 1, province: 2, territory: 2, country: 3 };

export default function PlaceSelect({ value, onChange, places, loading = false, className = '' }) {
  const { lang, t } = useLang();
  const options = [...(places || [])].sort((a, b) =>
    (KIND_ORDER[a.kind] ?? 9) - (KIND_ORDER[b.kind] ?? 9) ||
    (a.name?.[lang] || a.name?.en || '').localeCompare(b.name?.[lang] || b.name?.en || '')
  );
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
        {options.map(place => (
          <option key={place.id} value={place.slug}>
            {place.name?.[lang] || place.name?.en || place.slug} ({place.dataset_count})
          </option>
        ))}
      </select>
    </label>
  );
}
