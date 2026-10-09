import { Link } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import SupportContact from '../components/SupportContact.jsx';
import './InfoPages.css';

const GROUPS = [
  ['getting_started', ['what', 'account', 'sources']],
  ['working_with_data', ['availability', 'preparation', 'freshness', 'exports']],
  ['accounts_and_api', ['plans', 'credits', 'refunds', 'cancellation']],
];
const LINKS = {
  what: ['/docs', 'faq.docs_link'],
  account: ['/pricing', 'faq.pricing_link'],
  sources: ['/terms', 'faq.terms_link'],
  preparation: ['/docs#preparation-example', 'faq.docs_link'],
  exports: ['/docs', 'faq.docs_link'],
  plans: ['/pricing', 'faq.pricing_link'],
  credits: ['/pricing', 'faq.pricing_link'],
  refunds: ['/docs#reliability', 'faq.docs_link'],
  cancellation: ['/terms', 'faq.terms_link'],
};

export default function FaqPage() {
  const { t } = useLang();
  return <article className="cq-info-page max-w-3xl mx-auto px-4 py-10 sm:py-14">
    <header className="cq-info-header">
      <p className="cq-info-eyebrow">{t('faq.label')}</p>
      <h1>{t('faq.title')}</h1>
      <p className="cq-info-intro">{t('faq.intro')}</p>
    </header>
    {GROUPS.map(([group, items]) => <section className="cq-info-section" key={group} aria-labelledby={group.replaceAll('_', '-')}>
      <h2 id={group.replaceAll('_', '-')}>{t('faq.' + group)}</h2>
      <div className="cq-faq-list">{items.map(item => <details key={item} className="cq-faq-item">
        <summary>{t('faq.' + item + '_question')}</summary>
        <div className="cq-faq-answer">
          <p>{t('faq.' + item + '_answer')}</p>
          {LINKS[item] && <a className="link" href={LINKS[item][0]}>{t(LINKS[item][1])}</a>}
        </div>
      </details>)}</div>
    </section>)}
    <div className="cq-info-links">
      <Link className="link" to="/docs">{t('faq.docs_link')}</Link>
      <Link className="link" to="/privacy">{t('faq.privacy_link')}</Link>
    </div>
    <SupportContact />
  </article>;
}
