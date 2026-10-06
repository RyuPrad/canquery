import { useEffect, useState } from 'react';
import { useLang } from '../i18n.jsx';
import { accountRequest } from '../api/account.js';

export default function PricingPage() {
  const { t } = useLang();
  const [plans, setPlans] = useState(null);
  useEffect(() => { const controller = new AbortController(); accountRequest('/plans', { signal: controller.signal }).then(setPlans).catch(() => {}); return () => controller.abort(); }, []);
  return <section className="max-w-6xl mx-auto px-4 py-12 space-y-8">
    <div className="max-w-3xl"><p className="text-primary font-semibold">CanQuery API</p><h1 className="text-4xl font-display font-bold mt-3">{t('account.pricing_title')}</h1><p className="text-lg mt-4 text-base-content/80">{t('account.pricing_intro')}</p></div>
    {plans?.mode === 'sandbox' && plans.enabled && <p className="cq-card p-4">{t('account.sandbox')}</p>}
    <div className="grid md:grid-cols-3 gap-5">{['free', 'business', 'enterprise'].map(plan => <article key={plan} className={'cq-card p-6 flex flex-col gap-5' + (plan === 'business' ? ' border-primary' : '')}>
      <h2 className="text-xl font-semibold">{t('account.plan_' + plan)}</h2><p className="text-3xl font-display font-bold">{t('account.price_' + plan)}</p>
      <p className="grow whitespace-pre-line leading-8">{t('account.features_' + plan)}</p>
      <a className={'btn ' + (plan === 'business' ? 'btn-primary' : 'btn-outline')} href={plan === 'enterprise' || !plans?.enabled ? 'mailto:support@canquery.com?subject=CanQuery%20API' : plan === 'free' ? '/signup' : '/account'}>{t(plan === 'enterprise' || !plans?.enabled ? 'account.contact' : plan === 'free' ? 'account.signup' : 'account.get_business')}</a>
    </article>)}</div>
    <p>{t('account.quota_note')} {t('account.availability_note')}</p>
    {plans?.enabled && !plans.checkout && <p>{t('account.checkout_soon')}</p>}
    <section className="cq-card p-6"><h2 className="text-xl font-semibold">{t('account.credit_costs')}</h2>
      <dl className="grid sm:grid-cols-[1fr_auto] gap-3 mt-5">{[['ordinary', 1], ['analysis', 10], ['export', 25], ['prepare', 100], ['shared', 0]].map(([name, cost]) => <div className="contents" key={name}><dt>{t('account.cost_' + name)}</dt><dd className="font-mono">{cost}</dd></div>)}</dl>
      <p className="mt-5">{t('account.credit_policy')}</p><a className="link inline-block mt-4" href="/docs">{t('account.documentation')}</a>
    </section>
    <p className="text-sm"><a href="/terms" className="link">{t('account.terms')}</a> · <a href="mailto:support@canquery.com" className="link">support@canquery.com</a></p>
  </section>;
}
