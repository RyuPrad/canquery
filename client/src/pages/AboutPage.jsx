import { Link } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import SupportContact from '../components/SupportContact.jsx';
import './InfoPages.css';

export default function AboutPage() {
  const { t } = useLang();
  return <article className="cq-info-page max-w-3xl mx-auto px-4 py-10 sm:py-14">
    <header className="cq-info-header">
      <p className="cq-info-eyebrow">{t('about.label')}</p>
      <h1>{t('about.title')}</h1>
      <p className="cq-info-intro">{t('about.intro')}</p>
    </header>
    <section className="cq-info-section">
      <h2>{t('about.mission_title')}</h2>
      <p>{t('about.mission_body')}</p>
      <div className="cq-info-links">
        <Link className="link" to="/datasets">{t('about.explore_link')}</Link>
        <Link className="link" to="/faq">{t('about.faq_link')}</Link>
      </div>
    </section>
    <section className="cq-info-section">
      <h2>{t('about.sources_title')}</h2>
      <p>{t('about.sources_body')}</p>
      <p>{t('about.context_body')}</p>
    </section>
    <section className="cq-info-section">
      <h2>{t('about.independent_title')}</h2>
      <p>{t('about.independent_body')}</p>
      <div className="cq-info-links">
        <a className="link" href="https://github.com/RyuPrad">{t('about.creator_link')}</a>
        <a className="link" href="https://github.com/RyuPrad/canquery">{t('about.source_link')}</a>
      </div>
    </section>
    <SupportContact />
  </article>;
}
