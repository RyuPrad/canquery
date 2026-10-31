import { useLang } from '../i18n.jsx';
import { formatBytes } from '../utils/bytes.js';

// The worker's advisory progress for a running job: a bar when the download
// length or the share of the file read is known, otherwise an indeterminate
// one, and a line of text.
function progressLine(progress, t, lang) {
  if (!progress) return null;
  const locale = lang === 'fr' ? 'fr-CA' : 'en-CA';
  if (progress.phase === 'downloading') {
    const total = Number(progress.content_length);
    const done = Number(progress.bytes) || 0;
    if (Number.isFinite(total) && total > 0) {
      return { ratio: Math.min(1, done / total), text: t('preparation.progress.downloading')
        .replace('{done}', formatBytes(done, lang)).replace('{total}', formatBytes(total, lang)) };
    }
    return { ratio: null, text: t('preparation.progress.downloaded').replace('{done}', formatBytes(done, lang)) };
  }
  if (progress.phase === 'loading') {
    const read = typeof progress.read_fraction === 'number' && Number.isFinite(progress.read_fraction)
      ? Math.min(1, Math.max(0, progress.read_fraction)) : null;
    return { ratio: read, text: t('preparation.progress.loading').replace('{rows}', (Number(progress.rows) || 0).toLocaleString(locale)) };
  }
  if (progress.phase === 'finishing') return { ratio: 1, text: t('preparation.progress.finishing') };
  return null;
}

export default function PreparationStatus({ preparation, elapsed, compact = false, progress = null }) {
  const { t, lang } = useLang();
  const { phase, supported, enabled, retryAt, retry, working, failureReason, awaitingVisitor, start } = preparation;
  const unavailable = !supported || !enabled || phase === 'unavailable';
  // Nobody has used the page yet, so nothing was started; the button starts it.
  const standby = Boolean(awaitingVisitor) && !unavailable && phase !== 'failed';
  const message = unavailable ? 'unavailable' : phase === 'failed' ? 'failed' : standby ? 'standby'
    : phase === 'waiting' ? 'waiting' : phase === 'running' ? 'running' : 'pending';
  const reason = ['invalid_file', 'upstream_unavailable', 'capacity', 'temporary'].includes(failureReason)
    ? failureReason : null;
  const line = working ? progressLine(progress, t, lang) : null;
  // Only the message is a live region; the ticking timer and the progress
  // line would otherwise be read out every second and on every poll.
  return (
    <div className={compact ? 'cq-card p-4 text-sm space-y-2' : 'cq-card p-10 text-center space-y-4 max-w-xl mx-auto'}>
      <div className={compact ? 'space-y-2' : 'space-y-4'} role="status" aria-live="polite">
        <p className="flex items-center justify-center gap-2">
          {working && <span className="loading loading-spinner loading-xs" aria-hidden="true" />}
          {t(phase === 'failed' && !unavailable && reason ? 'preparation.failure.' + reason : 'preparation.' + message)}
        </p>
        {standby && <div className="flex justify-center"><button type="button" className="btn btn-sm btn-primary" onClick={start}>{t('preparation.start')}</button></div>}
        {!unavailable && phase !== 'failed' && <p className="text-sm text-base-content/60">{t('preparation.automatic')}</p>}
        {retryAt && <p className="text-xs">{t('preparation.retry_at')} {new Date(retryAt).toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA')}</p>}
      </div>
      {line && (
        <div className={'space-y-1' + (compact ? '' : ' max-w-md mx-auto')}>
          <progress className="progress progress-primary w-full" value={line.ratio === null ? undefined : line.ratio} max={1} aria-label={line.text} />
          <p className="text-xs font-mono">{line.text}</p>
        </div>
      )}
      {working && elapsed && <p className="text-xs font-mono">{t('resource.elapsed')} {elapsed}</p>}
      {phase === 'failed' && !unavailable && <button className="btn btn-sm btn-outline" onClick={retry} disabled={Boolean(retryAt)}>{t('common.retry')}</button>}
    </div>
  );
}
