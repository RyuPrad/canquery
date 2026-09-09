import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchBlog } from '../api/catalog.js';
import { useLang } from '../i18n.jsx';

export default function LocalGuides({ place }) {
  const { t, lang } = useLang();
  const [articles, setArticles] = useState([]);
  useEffect(() => {
    let cancelled = false;
    setArticles([]);
    fetchBlog({ lang, place: place || undefined }).then(env => {
      if (!cancelled) setArticles(env.data);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [lang, place]);
  if (!articles.length) return null;
  return <section className="mt-8 text-left" aria-label={t('blog.title')}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-display font-semibold text-xl">{t('discovery.title')}</h2>
      <Link className="link text-sm" to={lang === 'fr' ? '/fr/blog' : '/blog'}>{t('blog.title')} →</Link>
    </div>
    <div className={'grid gap-4 mt-4 ' + (articles.length > 1 ? 'md:grid-cols-3' : '')}>
      {articles.map(article => <article className="cq-card p-5" key={article.id}>
        <a className="cq-pill !text-xs" href={'/?' + new URLSearchParams({ place: article.place, q: article.query })}
          data-analytics-event="catalog_filter" data-analytics-filter="topic" data-analytics-value={article.topic} data-analytics-place={article.place}>
          {article.placeName} · {article.topicName}
        </a>
        <h3 className="font-semibold mt-4"><Link className="hover:underline" to={article.path}>{article.title}</Link></h3>
        <p className="text-sm text-base-content/60 mt-2 leading-relaxed">{article.description}</p>
        <Link className="link text-sm inline-block mt-4" to={article.path}>{t('blog.read')} →</Link>
      </article>)}
    </div>
  </section>;
}
