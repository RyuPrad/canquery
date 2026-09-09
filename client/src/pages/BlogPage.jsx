import { useEffect, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { fetchBlog, fetchBlogArticle } from '../api/catalog.js';
import { useLang } from '../i18n.jsx';
import { NotFoundError } from '../api/client.js';
import LoadingSpinner from '../components/LoadingSpinner.jsx';
import { track } from '../utils/analytics.js';

export default function BlogPage({ language = 'en' }) {
  const { slug } = useParams();
  const { pathname } = useLocation();
  const { t, setLang, setBlogTranslations } = useLang();
  const [content, setContent] = useState(null);
  const [error, setError] = useState(null);
  const indexPath = language === 'fr' ? '/fr/blog' : '/blog';

  useEffect(() => { setLang(language); }, [language, setLang]);
  useEffect(() => {
    let cancelled = false;
    setContent(null);
    setError(null);
    const request = slug ? fetchBlogArticle(language, slug) : fetchBlog({ lang: language });
    request.then(env => {
      if (cancelled) return;
      setContent({ pathname, data: env.data });
      setBlogTranslations({ pathname, paths: slug ? env.data.translations : { en: '/blog', fr: '/fr/blog' } });
    }).catch(err => { if (!cancelled) setError({ pathname, cause: err }); });
    return () => { cancelled = true; setBlogTranslations(null); };
  }, [slug, language, pathname, setBlogTranslations]);

  if (error?.pathname === pathname) return <div className="max-w-3xl mx-auto px-4 py-12">
    <h1 className="text-3xl font-display font-bold">{error.cause instanceof NotFoundError ? t('blog.not_found') : t('blog.failed')}</h1>
    <Link to={indexPath} className="link mt-6 inline-block">{t('blog.title')}</Link>
  </div>;
  if (!content || content.pathname !== pathname) return <LoadingSpinner label={t('blog.loading')} />;
  if (!slug) return <div className="max-w-6xl mx-auto px-4 py-10">
    <p className="cq-chip">{t('blog.eyebrow')}</p>
    <h1 className="font-display text-4xl sm:text-5xl font-bold mt-4">{t('blog.title')}</h1>
    <p className="text-lg text-base-content/65 mt-4 max-w-2xl">{t('blog.intro')}</p>
    <div className="grid md:grid-cols-3 gap-5 mt-10">
      {content.data.map(article => <article key={article.id} className="cq-card p-6 flex flex-col items-start">
        <span className="cq-chip">{article.placeName}</span>
        <h2 className="font-display text-xl font-semibold mt-4"><Link className="hover:underline" to={article.path}>{article.title}</Link></h2>
        <p className="text-sm text-base-content/65 mt-3 mb-6 leading-relaxed">{article.description}</p>
        <Link className="link mt-auto" to={article.path}>{t('blog.read')} →</Link>
      </article>)}
    </div>
  </div>;

  const article = content.data;
  const date = value => new Date(value + 'T12:00:00Z').toLocaleDateString(language === 'fr' ? 'fr-CA' : 'en-CA', { dateStyle: 'long', timeZone: 'UTC' });
  const otherLanguage = language === 'fr' ? 'en' : 'fr';
  return <div className="max-w-3xl mx-auto px-4 py-10">
    <nav aria-label={t('breadcrumbs.label')}><Link to={indexPath} className="link text-sm">{t('blog.title')}</Link></nav>
    <article className="mt-7">
      <div className="flex flex-wrap gap-2"><Link className="cq-chip" to={'/places/' + article.place}>{article.placeName}</Link><span className="cq-chip">{article.topicName}</span></div>
      <h1 className="font-display text-3xl sm:text-4xl font-bold leading-tight mt-5">{article.title}</h1>
      <p className="text-lg text-base-content/65 leading-relaxed mt-5">{article.description}</p>
      <div className="text-sm text-base-content/60 space-y-1 mt-5">
        <p>{t('blog.by')} <Link to="/" className="link">CanQuery</Link> · {t('blog.published')} <time dateTime={article.published}>{date(article.published)}</time></p>
        <p>{t('blog.updated')} <time dateTime={article.updated}>{date(article.updated)}</time></p>
        <p>{t('blog.verified')} <time dateTime={article.verified}>{date(article.verified)}</time></p>
      </div>
      <Link className="link inline-block mt-4 text-sm" to={article.translations[otherLanguage]} hrefLang={otherLanguage}>
        {otherLanguage === 'fr' ? 'Lire en français' : 'Read in English'}
      </Link>
      <div className="cq-article mt-8" dangerouslySetInnerHTML={{ __html: article.bodyHtml }} onClick={event => {
        const anchor = event.target.closest('a');
        if (anchor?.getAttribute('href')?.startsWith('/resources/')) {
          track('blog_explore', { article: article.id, language, place: article.place, topic: article.topic, view: article.view });
        }
      }} />
      <aside className="cq-card p-6 mt-10 space-y-4">
        <Link className="btn btn-primary w-full sm:w-auto h-auto min-h-10 py-2" to={article.explore}
          data-analytics-event="blog_explore" data-analytics-article={article.id} data-analytics-language={language}
          data-analytics-place={article.place} data-analytics-topic={article.topic} data-analytics-view={article.view}>
          {article.view === 'map' ? t('discovery.map') : t('discovery.table')} →
        </Link>
        <p><Link className="link text-sm" to={article.dataset}>{t('blog.dataset')}</Link></p>
        <p><Link className="link text-sm" to={'/places/' + article.place}>{t('blog.more')} {article.placeName}</Link></p>
      </aside>
    </article>
  </div>;
}
