import { Link } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import SupportContact from '../components/SupportContact.jsx';
import { hostedPart } from '../extensions.js';
import './InfoPages.css';

// The hosted service adds account, plan and credit questions with their links.
const HOSTED = hostedPart(import.meta.glob('../enterprise/faq.js', { eager: true }), null);
const CORE_GROUPS = [
  ['getting_started', ['what', 'sources']],
  ['working_with_data', ['availability', 'preparation', 'freshness', 'exports']],
];
const GROUPS = HOSTED ? HOSTED.groups(CORE_GROUPS) : CORE_GROUPS;
const LINKS = {
  what: ['/docs', 'faq.docs_link'],
  preparation: ['/docs#preparation-example', 'faq.docs_link'],
  exports: ['/docs', 'faq.docs_link'],
  ...HOSTED?.links,
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
