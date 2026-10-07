import { useLang } from '../i18n.jsx';
import useCommercialPlans from '../hooks/useCommercialPlans.js';
import { businessPrice, currentTermsVersion } from '../utils/businessPrice.js';
export default function TermsPage() {
  const { t, lang } = useLang();
  const { plans, error, retry } = useCommercialPlans();
  const price = businessPrice(plans?.business_price, lang);
  const version = currentTermsVersion(plans);
  return <article className="max-w-3xl mx-auto px-4 py-12 space-y-6"><h1 className="font-bold text-3xl">{t('account.terms')}</h1>
    {version && <p className="text-sm text-base-content/75">{t('account.terms_effective')} <time dateTime={version}>{new Intl.DateTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', { dateStyle: 'long', timeZone: 'UTC' }).format(new Date(version + 'T00:00:00Z'))}</time></p>}
    {(error || (plans && (!price || !version))) && <div role="alert"><p>{t('pricing.load_error')}</p><button className="btn btn-outline mt-3" onClick={retry}>{t('account.retry')}</button></div>}
    {['service', 'billing', 'limits', 'licence', 'support'].map(key => <section key={key}><h2 className="text-xl font-semibold">{t('account.terms_' + key + '_title')}</h2><p className="mt-3 leading-relaxed">{key === 'billing' ? price ? t('account.terms_billing').replace('{price}', price) : t(!plans && !error ? 'account.terms_loading' : 'account.billing_price_unavailable') : t('account.terms_' + key)}</p></section>)}
    <a className="link" href="mailto:support@canquery.com">support@canquery.com</a>
  </article>;
}
