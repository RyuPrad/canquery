import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchBlog } from '../api/catalog.js';
import { useLang } from '../i18n.jsx';

// `initial` holds the guide lists embedded in a dataset page's HTML, by language.
export default function LocalGuides({ place, dataset, limit, variant, initial }) {
  const { t, lang } = useLang();
  const [articles, setArticles] = useState(() => initial?.[lang]?.data ?? []);
  useEffect(() => {
    const embedded = initial?.[lang];
    if (embedded) {
      setArticles(embedded.data);
      return undefined;
    }
    let cancelled = false;
    setArticles([]);
    fetchBlog({ lang, place: place || undefined, dataset: dataset || undefined }).then(env => {
      if (!cancelled) setArticles(env.data);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [lang, place, dataset, initial]);
  const visibleArticles = articles.slice(0, limit);
  const compact = variant === 'compact';
  if (!visibleArticles.length) return null;
  return <section className={compact ? 'cq-home-section text-left' : 'mt-8 text-left'} aria-label={t('blog.title')}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className={'font-display font-semibold ' + (compact ? 'text-2xl sm:text-3xl' : 'text-xl')}>{t('discovery.title')}</h2>
      <Link className="link text-sm" to={lang === 'fr' ? '/fr/blog' : '/blog'}>{t('blog.title')} →</Link>
    </div>
    <div className={'grid gap-4 mt-4 ' + (visibleArticles.length > 1 ? 'md:grid-cols-3' : '')}>
      {visibleArticles.map(article => <article className={'cq-card ' + (compact ? 'p-4 flex flex-col' : 'p-5')} key={article.id}>
        <a className={'cq-pill !text-xs !whitespace-normal' + (compact ? ' self-start' : '')} href={'/?' + new URLSearchParams({ ...(article.place ? { place: article.place } : {}), q: article.query })}
          data-analytics-event="catalog_filter" data-analytics-filter="topic" data-analytics-value={article.topic} data-analytics-place={article.place}>
          {[article.placeName, article.topicName].filter(Boolean).join(' · ')}
        </a>
        <h3 className={'font-semibold ' + (compact ? 'mt-3 text-sm leading-snug break-words' : 'mt-4')}><Link className="hover:underline" to={article.path}>{article.title}</Link></h3>
        <p className={'text-sm text-base-content/60 mt-2 leading-relaxed' + (compact ? ' line-clamp-2 mb-4' : '')}>{article.description}</p>
        <div className={'flex flex-wrap items-baseline gap-x-4 gap-y-1 ' + (compact ? 'mt-auto' : 'mt-4')}>
          <Link className="link text-sm inline-block" to={article.path}>{t('blog.read')} →</Link>
          {article.translations?.[lang === 'fr' ? 'en' : 'fr'] && (
            <Link className="text-xs text-base-content/55 hover:underline" to={article.translations[lang === 'fr' ? 'en' : 'fr']}
              hrefLang={lang === 'fr' ? 'en' : 'fr'}>{lang === 'fr' ? 'Read in English' : 'Lire en français'}</Link>
          )}
        </div>
      </article>)}
    </div>
  </section>;
}
