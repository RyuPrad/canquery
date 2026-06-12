import { Link } from 'react-router-dom';
import { useLang } from '../i18n.jsx';

export default function Navbar() {
  const { lang, setLang, t } = useLang();
  return (
    <header className="navbar bg-base-200 sticky top-0 z-30 shadow">
      <div className="flex-1">
        <Link to="/" className="text-xl font-bold tracking-tight px-2">
          <span>open</span>
          <span className="text-[#d52b1e]">canada</span>
        </Link>
      </div>
      <nav className="flex gap-1 items-center">
        <Link to="/" className="btn btn-ghost btn-sm">{t('nav.datasets')}</Link>
        <Link to="/organizations" className="btn btn-ghost btn-sm">{t('nav.organizations')}</Link>
        <Link to="/docs" className="btn btn-ghost btn-sm">{t('nav.docs')}</Link>
        <a
          href="https://open.canada.ca/data/en/dataset"
          target="_blank"
          rel="noreferrer"
          className="btn btn-ghost btn-sm opacity-60"
        >
          open.canada.ca
        </a>
        <div className="join ml-1">
          <button
            className={'btn btn-xs join-item' + (lang === 'en' ? ' bg-[#d52b1e] text-white border-none' : ' btn-ghost border border-base-300')}
            onClick={() => setLang('en')}
            aria-pressed={lang === 'en'}
          >
            EN
          </button>
          <button
            className={'btn btn-xs join-item' + (lang === 'fr' ? ' bg-[#d52b1e] text-white border-none' : ' btn-ghost border border-base-300')}
            onClick={() => setLang('fr')}
            aria-pressed={lang === 'fr'}
          >
            FR
          </button>
        </div>
      </nav>
    </header>
  );
}
