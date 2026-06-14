import { useEffect, useRef } from 'react';
import { useLang } from '../i18n.jsx';
import { SearchIcon } from './Icons.jsx';

export default function SearchBar({ value, onChange, placeholder }) {
  const { t } = useLang();
  const inputRef = useRef(null);

  // "/" focuses the search from anywhere on the page, unless already typing.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey) return;
      const el = document.activeElement;
      if (
        el &&
        (el.tagName === 'INPUT' ||
          el.tagName === 'TEXTAREA' ||
          el.tagName === 'SELECT' ||
          el.isContentEditable)
      ) {
        return;
      }
      e.preventDefault();
      inputRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const ph = placeholder || t('home.search_placeholder');
  return (
    <div className="cq-search">
      <SearchIcon size={18} className="opacity-40 shrink-0" />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={ph}
      />
      <kbd className="cq-kbd hidden sm:block">/</kbd>
    </div>
  );
}
