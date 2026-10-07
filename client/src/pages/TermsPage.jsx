import { useLang } from '../i18n.jsx';
export default function TermsPage() {
  const { t } = useLang();
  return <article className="max-w-3xl mx-auto px-4 py-12 space-y-6"><h1 className="font-bold text-3xl">{t('account.terms')}</h1>
    {['service', 'billing', 'limits', 'licence', 'support'].map(key => <section key={key}><h2 className="text-xl font-semibold">{t('account.terms_' + key + '_title')}</h2><p className="mt-3 leading-relaxed">{t('account.terms_' + key)}</p></section>)}
    <a className="link" href="mailto:support@canquery.com">support@canquery.com</a>
  </article>;
}
