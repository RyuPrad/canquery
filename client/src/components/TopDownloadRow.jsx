import { Link } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import { fmtInt } from './charts/theme.js';
import Sparkline from './charts/Sparkline.jsx';
import { ArrowRightIcon, DownloadIcon } from './Icons.jsx';

// A compact leaderboard row (ranks 4-100): rank, title + department, download
// count, a download-popularity sparkline, and a link to the full insights. When
// the dataset has no chartable resource it links to the dataset (download-only).
export default function TopDownloadRow({ item }) {
  const { t, lang } = useLang();
  const title = item.title?.[lang] || item.title?.en || item.title?.fr || item.dataset_id;
  const dept = (lang === 'fr' ? item.ministere : item.department) || item.department || item.ministere;
  const charted = Boolean(item.resource_id);
  const to = '/datasets/' + item.dataset_id + (item.resource_id ? '?highlight=' + item.resource_id : '');
  const values = (item.history || []).map((h) => h.d);

  return (
    <Link
      to={to}
      className="group flex items-center gap-3 sm:gap-4 px-2.5 sm:px-3 py-2.5 rounded-xl hover:bg-base-content/5 transition-colors"
    >
      <span className="w-7 shrink-0 text-right font-mono text-sm text-base-content/40 tabular-nums">{item.rank}</span>
      <span className="flex-1 min-w-0">
        <span className="block truncate font-medium group-hover:text-primary transition-colors">{title}</span>
        {dept && <span className="block truncate text-xs text-base-content/45">{dept}</span>}
      </span>
      {!charted && (
        <span className="hidden md:inline-flex items-center gap-1 cq-chip cq-chip-mono shrink-0" title={t('badge.fileonly_tip')}>
          <DownloadIcon size={12} /> {t('badge.fileonly')}
        </span>
      )}
      <span className="hidden sm:block shrink-0 w-20 text-right leading-tight">
        <span className="block font-display font-semibold tabular-nums text-[0.95rem]">{fmtInt(item.downloads, lang)}</span>
        <span className="block text-[0.66rem] text-base-content/45">{t('insights.downloads')}</span>
      </span>
      <span className="hidden sm:block shrink-0 text-secondary/70"><Sparkline values={values} /></span>
      <ArrowRightIcon size={15} className="shrink-0 text-base-content/30 group-hover:text-primary transition-colors" />
    </Link>
  );
}
