import { ExternalIcon } from './Icons.jsx';
import { useLang } from '../i18n.jsx';

export default function Provenance({ provenance, compact = false }) {
  const { lang, t } = useLang();
  const sources = provenance?.sources || [];
  if (!sources.length) return null;
  return (
    <div className={compact ? 'flex flex-wrap gap-1.5' : 'cq-card p-4 space-y-2'}>
      {!compact && <div className="text-xs font-semibold uppercase tracking-widest text-base-content/40">{t('source.provenance')}</div>}
      <div className="flex flex-wrap gap-1.5">
        {sources.map(source => (
          <a
            key={source.id}
            href={source.landing_url || source.homepage_url}
            target="_blank"
            rel="noreferrer"
            className="cq-chip max-w-full !whitespace-normal hover:border-base-content/25 transition-colors"
          >
            <span className="min-w-0 break-words">{source.name?.[lang] || source.name?.en || source.id}</span>
            <span className="shrink-0"><ExternalIcon size={10} /></span>
          </a>
        ))}
      </div>
      {!compact && provenance.primary_license && (
        <p className="text-xs text-base-content/50">
          {t('source.license')}{' '}
          <a className="link link-hover" href={provenance.primary_license.url} target="_blank" rel="noreferrer">
            {provenance.primary_license.title?.[lang] || provenance.primary_license.title?.en}
          </a>
        </p>
      )}
    </div>
  );
}
