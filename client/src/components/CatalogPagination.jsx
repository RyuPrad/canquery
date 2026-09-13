import { Link } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import { pagePath } from '../utils/catalogPagination.js';

export default function CatalogPagination({ page, hasMore, path, onPage, loading = false }) {
  const { t } = useLang();
  if (!page || (page === 1 && !hasMore)) return null;
  const control = (number, label, key = label) => onPage ? (
    <button key={key} type="button" className="btn btn-outline btn-sm" disabled={loading} onClick={() => onPage(number)}>{label}</button>
  ) : <Link key={key} className="btn btn-outline btn-sm" to={pagePath(path, number)}>{label}</Link>;
  return <nav aria-label={t('pagination.label')} className="flex flex-wrap items-center justify-center gap-2 mt-6">
    {page > 1 && control(page - 1, t('pagination.previous'))}
    {page > 2 && control(1, '1')}
    {page > 3 && <span aria-hidden="true">…</span>}
    {page > 1 && control(page - 1, String(page - 1), 'previous-number')}
    <span aria-current="page" className="cq-chip cq-chip-mono">{t('pagination.page')} {page}</span>
    {hasMore && control(page + 1, String(page + 1), 'next-number')}
    {hasMore && control(page + 1, t('pagination.next'))}
  </nav>;
}
