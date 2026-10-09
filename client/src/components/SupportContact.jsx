import { useLang } from '../i18n.jsx';

export default function SupportContact() {
  const { t } = useLang();
  return <section className="cq-info-support" aria-labelledby="support-title">
    <h2 id="support-title">{t('support.title')}</h2>
    <p>{t('support.body')}</p>
    <a className="cq-info-email link" href="mailto:support@canquery.com">support@canquery.com</a>
    <p>{t('support.details')}</p>
    <p>{t('support.scope')}</p>
  </section>;
}
