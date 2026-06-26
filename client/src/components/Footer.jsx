import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import { getJSON } from '../api/client.js';
import usePrefersReducedMotion from '../hooks/usePrefersReducedMotion.js';
import { MapleLeaf, ExternalIcon, GithubIcon, StarIcon, ArrowUpRightIcon, XLogoIcon, BlueskyIcon } from './Icons.jsx';

const REPO_URL = 'https://github.com/RyuPrad/canquery';
const PROFILE_URL = 'https://github.com/RyuPrad';
const X_URL = 'https://x.com/Daffmor';
const BLUESKY_URL = 'https://bsky.app/profile/bsky.best';

// Live GitHub star count, fetched once on mount from our own cached proxy
// (/api/v1/repo). null while loading or if the upstream was unavailable, in
// which case the badge falls back to a plain "Star on GitHub" link.
function StarCount() {
  const { t } = useLang();
  const reduced = usePrefersReducedMotion();
  const [stars, setStars] = useState(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getJSON('/api/v1/repo')
      .then((body) => {
        if (cancelled) return;
        setStars(body && body.data ? body.data.stars : null);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Loading: a faint dash placeholder so the layout doesn't pop in.
  if (!loaded) {
    return (
      <span className="inline-flex items-center gap-1.5 text-sm text-base-content/30">
        <StarIcon size={14} />
        <span className="w-5 inline-block rounded-sm bg-base-content/10 h-3" />
      </span>
    );
  }

  return (
    <a
      href={REPO_URL}
      target="_blank"
      rel="noreferrer"
      className="group inline-flex items-center gap-1.5 text-sm transition-colors"
      title={stars == null ? t('footer.source') : stars + ' ' + t('footer.stars')}
    >
      <span className="inline-flex items-center gap-1 rounded-full border border-base-content/12 bg-base-content/5 px-2 py-0.5 font-medium text-base-content/75 group-hover:border-base-content/25 group-hover:text-base-content transition-colors">
        <StarIcon size={13} className="text-amber-400" />
        {stars == null ? (
          <GithubIcon size={13} />
        ) : (
          <span>{stars}</span>
        )}
      </span>
      <span className="inline-flex items-center gap-0.5 text-xs text-base-content/45 group-hover:text-base-content/70 transition-colors">
        {t('footer.star_here')}
        <ArrowUpRightIcon
          size={11}
          className={reduced ? '' : 'animate-pulse'}
        />
      </span>
    </a>
  );
}

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
          <StarCount />
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
          <div className="flex items-center gap-3 pt-1">
            <a
              href={X_URL}
              target="_blank"
              rel="noreferrer"
              aria-label={t('footer.follow_x')}
              className="inline-flex items-center justify-center text-base-content/55 hover:text-base-content transition-colors"
            >
              <XLogoIcon size={17} />
            </a>
            <a
              href={BLUESKY_URL}
              target="_blank"
              rel="noreferrer"
              aria-label={t('footer.follow_bluesky')}
              className="inline-flex items-center justify-center text-base-content/55 hover:text-base-content transition-colors"
            >
              <BlueskyIcon size={17} />
            </a>
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
