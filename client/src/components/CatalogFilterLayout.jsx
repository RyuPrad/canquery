import { useEffect, useId, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import useMediaQuery from '../hooks/useMediaQuery.js';
import { FilterIcon } from './Icons.jsx';
import './CatalogFilters.css';

// Wide screens keep the filters beside the results. Narrow screens show them
// behind one disclosure above the results, like the documentation menu.
// A page may control the disclosure (open with a stable onOpenChange, such as
// a state setter) and pass regionRef to scroll to and focus the filters.
export default function CatalogFilterLayout({
  sidebar,
  activeCount = 0,
  children,
  open: openProp,
  onOpenChange,
  regionRef
}) {
  const { t } = useLang();
  const location = useLocation();
  const narrow = useMediaQuery('(max-width: 1023.98px)');
  const [ownOpen, setOwnOpen] = useState(false);
  const open = openProp ?? ownOpen;
  const setOpen = (next) => {
    setOwnOpen(next);
    onOpenChange?.(next);
  };
  const panelId = useId();
  const triggerRef = useRef(null);

  useEffect(() => {
    setOwnOpen(false);
    onOpenChange?.(false);
  }, [location.pathname, onOpenChange]);

  if (!narrow) {
    return (
      <div className="cq-catalog-layout">
        <aside
          ref={regionRef}
          tabIndex={regionRef ? -1 : undefined}
          className="cq-catalog-aside"
          aria-label={t('filters.title')}
        >
          {sidebar}
        </aside>
        <div className="cq-catalog-main">{children}</div>
      </div>
    );
  }
  const label =
    activeCount > 0
      ? t('filters.toggle_count').replace('{count}', String(activeCount))
      : t('filters.title');
  return (
    <div className="cq-catalog-layout">
      <div className="cq-catalog-mobile">
        <button
          ref={triggerRef}
          type="button"
          className="cq-filter-toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen(!open)}
        >
          <FilterIcon size={15} className="cq-fg-red" />
          {label}
        </button>
        {open && (
          <section
            ref={regionRef}
            tabIndex={regionRef ? -1 : undefined}
            id={panelId}
            className="cq-catalog-panel"
            aria-label={t('filters.title')}
            onKeyDown={(event) => {
              if (event.key !== 'Escape' || event.target.tagName === 'SELECT') return;
              event.preventDefault();
              setOpen(false);
              triggerRef.current?.focus();
            }}
          >
            {sidebar}
          </section>
        )}
      </div>
      <div className="cq-catalog-main">{children}</div>
    </div>
  );
}
