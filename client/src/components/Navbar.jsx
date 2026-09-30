import { useEffect, useId, useRef, useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import { useTheme } from '../theme.jsx';
import { MapleLeaf, ExternalIcon, SparklesIcon, SunIcon, MoonIcon, XIcon } from './Icons.jsx';
import { track } from '../utils/analytics.js';

const navClass = ({ isActive }) => 'cq-nav-link' + (isActive ? ' cq-nav-active' : '');

function MenuIcon() {
  return <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
    <path d="M4 6h16M4 12h16M4 18h16" />
  </svg>;
}

export default function Navbar() {
  const { lang, setLang, t, blogTranslations } = useLang();
  const location = useLocation();
  const { pathname } = location;
  const navigate = useNavigate();
  const { dark, toggle } = useTheme();
  const [open, setOpen] = useState(false);
  const headerRef = useRef(null);
  const triggerRef = useRef(null);
  const panelId = useId();
  const isBlog = /^\/(fr\/)?blog(?:\/|$)/.test(pathname);
  const languageUnavailable = isBlog && /\/blog\/[^/]+/.test(pathname) && blogTranslations?.pathname !== pathname;

  const chooseLanguage = language => {
    track('ui_language', { language });
    if (isBlog && blogTranslations?.pathname === pathname) navigate(blogTranslations.paths[language]);
    else if (isBlog) navigate(language === 'fr' ? '/fr/blog' : '/blog');
    setLang(language);
  };
  const chooseTheme = () => {
    track('ui_theme', { theme: dark ? 'light' : 'dark' });
    toggle();
  };
  const close = () => setOpen(false);

  useEffect(() => { setOpen(false); }, [location.key]);

  useEffect(() => {
    if (!open) return undefined;
    const outside = event => {
      if (!headerRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = event => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => {
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape);
    };
  }, [open]);

  const primaryLinks = <>
    <NavLink to="/datasets" className={navClass} onClick={close}>{t('nav.catalogue')}</NavLink>
    <NavLink to="/places" className={navClass} onClick={close}>{t('nav.places')}</NavLink>
    <NavLink to="/insights" className={navClass} onClick={close}>
      <SparklesIcon size={13} className="text-secondary" />{t('nav.insights')}
    </NavLink>
  </>;

  return (
    <header ref={headerRef} className="cq-glass sticky top-0 z-40">
      <div className="cq-navbar-wrap">
        <div className="cq-navbar-inner">
          <Link to="/" className="cq-navbar-logo flex items-center gap-2.5 group" onClick={close}>
            <span className="cq-logo-tile group-hover:scale-105 transition-transform"><MapleLeaf size={15} /></span>
            <span className="font-display font-bold text-lg tracking-tight">can<span className="cq-red-grad">query</span></span>
          </Link>
          <nav className="cq-navbar-primary" aria-label={t('nav.primary')}>{primaryLinks}</nav>
          <div className="cq-navbar-controls">
            <span className="cq-navbar-theme-desktop">
              <button type="button" onClick={chooseTheme} aria-label={t('theme.toggle')} title={t('theme.toggle')} className="cq-nav-link">
                {dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
              </button>
            </span>
            <div className="cq-seg">
              <button type="button" className={'cq-seg-btn' + (lang === 'en' ? ' cq-seg-active' : '')}
                onClick={() => chooseLanguage('en')} disabled={languageUnavailable} aria-pressed={lang === 'en'}>EN</button>
              <button type="button" className={'cq-seg-btn' + (lang === 'fr' ? ' cq-seg-active' : '')}
                onClick={() => chooseLanguage('fr')} disabled={languageUnavailable} aria-pressed={lang === 'fr'}>FR</button>
            </div>
            <button ref={triggerRef} type="button" className="cq-nav-link cq-navbar-toggle"
              onClick={() => setOpen(value => !value)} aria-expanded={open} aria-controls={panelId}
              aria-label={t(open ? 'nav.close_menu' : 'nav.open_menu')}>
              <span className="cq-navbar-toggle-desktop">{t('nav.more')}</span>
              <span className="cq-navbar-toggle-mobile">{open ? <XIcon size={18} /> : <MenuIcon />}</span>
            </button>
          </div>
        </div>
        {open && <nav id={panelId} className="cq-navbar-panel cq-glass" aria-label={t('nav.menu_navigation')}>
          <div className="cq-navbar-panel-mobile cq-navbar-panel-links">
            <NavLink to="/" end className={navClass} onClick={close}>{t('nav.search')}</NavLink>
            {primaryLinks}
          </div>
          <div className="cq-navbar-panel-links">
            <NavLink to="/organizations" className={navClass} onClick={close}>{t('nav.organizations')}</NavLink>
            <NavLink to={lang === 'fr' ? '/fr/blog' : '/blog'} className={navClass} onClick={close}>{t('blog.title')}</NavLink>
            <NavLink to="/docs" className={navClass} onClick={close}>{t('nav.docs')}</NavLink>
            <a href="https://open.canada.ca/data/en/dataset" target="_blank" rel="noopener noreferrer" className="cq-nav-link" onClick={close}>
              open.canada.ca<ExternalIcon size={12} />
            </a>
          </div>
          <div className="cq-navbar-panel-theme">
            <button type="button" onClick={chooseTheme} aria-label={t('theme.toggle')} className="cq-nav-link">
              {dark ? <SunIcon size={16} /> : <MoonIcon size={16} />}
              <span className="cq-navbar-theme-label">{t('theme.toggle')}</span>
            </button>
          </div>
        </nav>}
      </div>
    </header>
  );
}
