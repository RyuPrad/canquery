import { useLang } from '../i18n.jsx';

export default function PreparationStatus({ preparation, elapsed, compact = false }) {
  const { t, lang } = useLang();
  const { phase, supported, enabled, retryAt, retry, working } = preparation;
  const unavailable = !supported || !enabled || phase === 'unavailable';
  const message = unavailable ? 'unavailable' : phase === 'failed' ? 'failed'
    : phase === 'waiting' ? 'waiting' : phase === 'running' ? 'running' : 'pending';
  return (
    <div className={compact ? 'cq-card p-4 text-sm space-y-2' : 'cq-card p-10 text-center space-y-4 max-w-xl mx-auto'} role="status" aria-live="polite">
      <p className="flex items-center justify-center gap-2">
        {working && <span className="loading loading-spinner loading-xs" aria-hidden="true" />}
        {t('preparation.' + message)}
      </p>
      {!unavailable && <p className="text-sm text-base-content/60">{t('preparation.automatic')}</p>}
      {working && elapsed && <p className="text-xs font-mono">{t('resource.elapsed')} {elapsed}</p>}
      {retryAt && <p className="text-xs">{t('preparation.retry_at')} {new Date(retryAt).toLocaleTimeString(lang === 'fr' ? 'fr-CA' : 'en-CA')}</p>}
      {phase === 'failed' && !unavailable && <button className="btn btn-sm btn-outline" onClick={retry} disabled={Boolean(retryAt)}>{t('common.retry')}</button>}
    </div>
  );
}
