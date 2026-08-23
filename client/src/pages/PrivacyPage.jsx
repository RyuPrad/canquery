import { useLang } from '../i18n.jsx';
import { LockIcon } from '../components/Icons.jsx';

const COLLECTED = [
  'privacy.collect_pages',
  'privacy.collect_searches',
  'privacy.collect_device',
  'privacy.collect_location',
  'privacy.collect_performance',
  'privacy.collect_heatmaps',
];

const NOT_COLLECTED = [
  'privacy.no_cookies',
  'privacy.no_raw_ip',
  'privacy.no_identity',
  'privacy.no_replay',
  'privacy.no_sale',
];

export default function PrivacyPage() {
  const { t } = useLang();
  return (
    <article className="max-w-3xl mx-auto px-4 py-10 cq-fade">
      <span className="cq-chip cq-chip-mono"><LockIcon size={11} />{t('privacy.label')}</span>
      <h1 className="text-3xl sm:text-4xl font-bold font-display tracking-tight mt-4">{t('privacy.title')}</h1>
      <p className="text-xs text-base-content/40 mt-2">{t('privacy.updated')}</p>
      <p className="text-base-content/70 mt-6 leading-relaxed">{t('privacy.summary')}</p>

      <section className="mt-9">
        <h2 className="text-xl font-semibold font-display">{t('privacy.collect_title')}</h2>
        <ul className="list-disc pl-5 mt-3 space-y-2 text-sm text-base-content/65 leading-relaxed">
          {COLLECTED.map(key => <li key={key}>{t(key)}</li>)}
        </ul>
      </section>

      <section className="mt-9">
        <h2 className="text-xl font-semibold font-display">{t('privacy.session_title')}</h2>
        <p className="text-sm text-base-content/65 mt-3 leading-relaxed">{t('privacy.session_body')}</p>
      </section>

      <section className="mt-9">
        <h2 className="text-xl font-semibold font-display">{t('privacy.not_title')}</h2>
        <ul className="list-disc pl-5 mt-3 space-y-2 text-sm text-base-content/65 leading-relaxed">
          {NOT_COLLECTED.map(key => <li key={key}>{t(key)}</li>)}
        </ul>
      </section>

      <section className="mt-9">
        <h2 className="text-xl font-semibold font-display">{t('privacy.control_title')}</h2>
        <p className="text-sm text-base-content/65 mt-3 leading-relaxed">{t('privacy.control_body')}</p>
      </section>

      <section className="mt-9">
        <h2 className="text-xl font-semibold font-display">{t('privacy.search_console_title')}</h2>
        <p className="text-sm text-base-content/65 mt-3 leading-relaxed">{t('privacy.search_console_body')}</p>
      </section>

      <section className="mt-9">
        <h2 className="text-xl font-semibold font-display">{t('privacy.retention_title')}</h2>
        <p className="text-sm text-base-content/65 mt-3 leading-relaxed">{t('privacy.retention_body')}</p>
      </section>
    </article>
  );
}
