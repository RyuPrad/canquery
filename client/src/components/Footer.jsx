import { Link } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import { MapleLeaf, ExternalIcon, GithubIcon } from './Icons.jsx';

const REPO_URL = 'https://github.com/RyuPrad/canquery';
const PROFILE_URL = 'https://github.com/RyuPrad';

export default function Footer() {
  const { t } = useLang();
  return (
    <footer className="mt-20 border-t border-base-content/8 bg-base-200/40">
      <div className="max-w-7xl mx-auto px-4 py-12 grid gap-10 sm:grid-cols-2 lg:grid-cols-3">
        <div className="space-y-3">
          <div className="flex items-center gap-2.5">
            <span className="cq-logo-tile">
              <MapleLeaf size={15} />
            </span>
            <span className="font-display font-bold text-lg tracking-tight">
              can<span className="cq-red-grad">query</span>
            </span>
          </div>
          <p className="text-sm text-base-content/55 max-w-xs">{t('footer.tag')}</p>
          <div className="space-y-1.5 pt-1">
            <a
              href={REPO_URL}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-2 text-sm text-base-content/65 hover:text-base-content transition-colors"
            >
              <GithubIcon size={15} />
              {t('footer.source')}
            </a>
            <p className="text-xs text-base-content/40">
              {t('footer.built_by')}{' '}
              <a
                href={PROFILE_URL}
                target="_blank"
                rel="noreferrer"
                className="link link-hover text-base-content/60"
              >
                @RyuPrad
              </a>
            </p>
          </div>
        </div>
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-widest text-base-content/40">
            {t('footer.explore')}
          </div>
          <ul className="space-y-2 text-sm">
            <li>
              <Link to="/" className="text-base-content/65 hover:text-base-content transition-colors">
                {t('nav.datasets')}
              </Link>
            </li>
            <li>
              <Link to="/organizations" className="text-base-content/65 hover:text-base-content transition-colors">
                {t('nav.organizations')}
              </Link>
            </li>
            <li>
              <Link to="/docs" className="text-base-content/65 hover:text-base-content transition-colors">
                {t('nav.docs')}
              </Link>
            </li>
            <li>
              <a
                href="https://open.canada.ca/data/en/dataset"
                target="_blank"
                rel="noreferrer"
                className="text-base-content/65 hover:text-base-content transition-colors inline-flex items-center gap-1.5"
              >
                open.canada.ca
                <ExternalIcon size={11} />
              </a>
            </li>
          </ul>
        </div>
        <div className="space-y-3">
          <div className="text-xs font-semibold uppercase tracking-widest text-base-content/40">
            {t('footer.about')}
          </div>
          <p className="text-sm text-base-content/55">
            {t('footer.licence_pre')}{' '}
            <a
              href="https://open.canada.ca/en/open-government-licence-canada"
              target="_blank"
              rel="noreferrer"
              className="link link-hover text-base-content/75"
            >
              {t('footer.licence_link')}
            </a>
            .
          </p>
          <p className="text-sm text-base-content/55">{t('footer.independent')}</p>
          <p className="text-xs text-base-content/35">{t('footer.mirrored')}</p>
        </div>
      </div>
    </footer>
  );
}
