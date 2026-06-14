import { Link, NavLink } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import { MapleLeaf, ExternalIcon } from './Icons.jsx';

const navClass = ({ isActive }) => 'oc-nav-link' + (isActive ? ' oc-nav-active' : '');

export default function Navbar() {
  const { lang, setLang, t } = useLang();
  return (
    <header className="oc-glass sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 min-h-16 py-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        <Link to="/" className="flex items-center gap-2.5 group">
          <span className="oc-logo-tile group-hover:scale-105 transition-transform">
            <MapleLeaf size={15} />
          </span>
          <span className="font-display font-bold text-lg tracking-tight">
            can<span className="oc-red-grad">query</span>
          </span>
        </Link>
        <nav className="ml-auto flex flex-wrap gap-0.5 items-center">
          <NavLink to="/" end className={navClass}>
            {t('nav.datasets')}
          </NavLink>
          <NavLink to="/organizations" className={navClass}>
            {t('nav.organizations')}
          </NavLink>
          <NavLink to="/docs" className={navClass}>
            {t('nav.docs')}
          </NavLink>
          {/* Wrapper span: .oc-nav-link's unlayered display beats the layered
              `hidden` utility, so visibility is gated one level up. */}
          <span className="hidden md:contents">
            <a
              href="https://open.canada.ca/data/en/dataset"
              target="_blank"
              rel="noreferrer"
              className="oc-nav-link opacity-60"
            >
              open.canada.ca
              <ExternalIcon size={12} />
            </a>
          </span>
          <div className="oc-seg ml-2">
            <button
              className={'oc-seg-btn' + (lang === 'en' ? ' oc-seg-active' : '')}
              onClick={() => setLang('en')}
              aria-pressed={lang === 'en'}
            >
              EN
            </button>
            <button
              className={'oc-seg-btn' + (lang === 'fr' ? ' oc-seg-active' : '')}
              onClick={() => setLang('fr')}
              aria-pressed={lang === 'fr'}
            >
              FR
            </button>
          </div>
        </nav>
      </div>
    </header>
  );
}
