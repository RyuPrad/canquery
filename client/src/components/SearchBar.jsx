

import { useLang } from '../i18n.jsx';

export default function SearchBar({ value, onChange, placeholder }) {
  const { t } = useLang();
  const ph = placeholder || t('home.search_placeholder');
  return (
    <div className="form-control w-full">
      <input
        type="search"
        className="input input-bordered input-lg w-full"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={ph}
      />
    </div>
  );
}
