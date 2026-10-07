import { useEffect, useState } from 'react';
import { useLang } from '../i18n.jsx';
import { accountRequest } from '../api/account.js';
import { CheckIcon } from '../components/Icons.jsx';
import './PricingPage.css';

const RESOURCE = 'ckan-toronto-open-data-resource-6d0229af-bc54-46de-9c2b-26759b01dd05';
export default function PricingPage() {
  const { t } = useLang();
  const [plans, setPlans] = useState(null);
  const [error, setError] = useState(false);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    accountRequest('/plans', { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) { setPlans(value); setError(false); }
    }).catch(() => { if (!controller.signal.aborted) setError(true); });
    return () => controller.abort();
  }, [reload]);
  const inquiry = 'mailto:support@canquery.com?subject=' + encodeURIComponent(t('pricing.email_subject')) + '&body=' + encodeURIComponent(t('pricing.email_body'));
  const loaded = Boolean(plans);
  const checkout = Boolean(plans?.enabled && plans.checkout);
  const command = 'curl --get \\\n  "https://canquery.com/api/v1/resources/' + RESOURCE + '/query" \\\n  -H "Authorization: Bearer $CANQUERY_API_KEY" \\\n  --data-urlencode \'filters={"STREET_NAME":"KING"}\' \\\n  --data-urlencode \'limit=5\'';
  return <div className="cq-pricing max-w-6xl mx-auto px-4 py-10 sm:py-14">
    <header className="cq-pricing-hero">
      <div><p className="cq-pricing-eyebrow">{t('pricing.eyebrow')}</p><h1>{t('account.pricing_title')}</h1><p className="cq-pricing-lead">{t('account.pricing_intro')}</p>
        <div className="cq-pricing-actions"><a className="btn btn-primary" href="/docs#quickstart">{t('pricing.try_example')}</a><a className="btn btn-ghost" href="#plans">{t('pricing.compare')}</a></div><p className="cq-pricing-reassurance">{t('pricing.free_note')}</p></div>
      <aside className="cq-pricing-workflow" aria-label={t('pricing.workflow_label')}><p className="cq-pricing-eyebrow">{t('pricing.workflow_label')}</p>
        <ol>{['find', 'query', 'repeat'].map((step, index) => <li key={step}><span className="cq-pricing-step" aria-hidden="true">0{index + 1}</span><div><h2>{t('pricing.step_' + step)}</h2><p>{t('pricing.step_' + step + '_body')}</p></div></li>)}</ol>
        <a href="/docs#workflow" className="cq-pricing-text-link">{t('pricing.view_workflow')} <span aria-hidden="true">→</span></a></aside>
    </header>
    <section id="plans" className="cq-pricing-section" aria-labelledby="plans-title">
      <div className="cq-pricing-section-heading"><div><p className="cq-pricing-eyebrow">{t('pricing.plans_eyebrow')}</p><h2 id="plans-title">{t('pricing.plans_title')}</h2></div><p>{t('pricing.plans_intro')}</p></div>
      {plans?.mode === 'sandbox' && plans.enabled && <p className="cq-pricing-notice" role="status">{t('account.sandbox')}</p>}
      {error && <div className="cq-pricing-notice" role="alert"><p>{t('pricing.load_error')}</p><button className="btn btn-sm btn-outline" onClick={() => { setError(false); setReload(value => value + 1); }}>{t('account.retry')}</button></div>}
      <div className="cq-pricing-plans">{['free', 'business', 'enterprise'].map(plan => <article key={plan} className={'cq-card cq-pricing-plan' + (plan === 'business' ? ' cq-pricing-plan-business' : '')}>
        <div className="cq-pricing-plan-heading"><h3>{t('account.plan_' + plan)}</h3>{plan === 'business' && loaded && !checkout && <span className="cq-pricing-status">{t('account.coming_soon')}</span>}</div>
        <p className="cq-pricing-audience">{t('pricing.for_' + plan)}</p><p className="cq-pricing-price">{t('account.price_' + plan)}</p>
        <ul>{t('account.features_' + plan).split('\n').map(feature => <li key={feature}><CheckIcon size={17} className="shrink-0" /><span>{feature}</span></li>)}</ul>
        <div className="cq-pricing-plan-action">{plan === 'enterprise' ? <a className="btn btn-outline" href={inquiry}>{t('pricing.discuss_custom')}</a>
          : !loaded ? <button className="btn btn-outline" disabled>{t(error ? 'pricing.unavailable' : 'pricing.checking')}</button>
            : plan === 'free' && plans.enabled ? <a className="btn btn-primary" href="/signup">{t('account.signup')}</a>
              : plan === 'business' && checkout ? <a className="btn btn-primary" href="/account">{t('account.get_business')}</a>
                : <a className="btn btn-outline" href={inquiry}>{t('pricing.discuss_workflow')}</a>}
          <p>{t(plan === 'business' ? checkout ? 'pricing.renewal' : 'pricing.business_wait' : plan === 'free' ? 'pricing.free_period' : 'pricing.custom_scope')}</p></div>
      </article>)}</div>
      <p className="cq-pricing-fine-print">{t('account.quota_note')} {t('account.availability_note')}</p>
    </section>
    <section className="cq-pricing-example cq-card" aria-labelledby="example-title">
      <div><p className="cq-pricing-eyebrow">{t('pricing.example_eyebrow')}</p><h2 id="example-title">{t('pricing.example_title')}</h2><p>{t('pricing.example_body')}</p><a className="cq-pricing-text-link" href="/docs#workflow">{t('pricing.example_link')} <span aria-hidden="true">→</span></a><p className="cq-pricing-example-source"><a className="link" href="/datasets/toronto-open-data-building-permits-active-permits">{t('pricing.example_source')}</a></p></div>
      <div className="cq-pricing-request"><div><span className="cq-method cq-method-get">GET</span><span>{t('pricing.example_request')}</span></div><pre className="cq-code" tabIndex={0} aria-label={t('pricing.example_request')}><code>{command}</code></pre><p>{t('pricing.example_note')}</p></div>
    </section>
    <section className="cq-pricing-details cq-pricing-section" aria-label={t('pricing.details')}>
      <div className="cq-card cq-pricing-credits"><h2>{t('account.credit_costs')}</h2><p>{t('pricing.credits_intro')}</p><dl>{[['ordinary', 1], ['analysis', 10], ['export', 25], ['prepare', 100], ['shared', 0]].map(([name, cost]) => <div key={name}><dt>{t('account.cost_' + name)}</dt><dd>{cost}</dd></div>)}</dl><p className="cq-pricing-fine-print">{t('account.credit_policy')}</p><a className="cq-pricing-text-link" href="/docs#reliability">{t('pricing.usage_link')} <span aria-hidden="true">→</span></a></div>
      <div className="cq-pricing-boundaries"><h2>{t('pricing.expect_title')}</h2>{['support', 'freshness', 'open'].map(item => <div key={item}><h3>{t('pricing.' + item + '_title')}</h3><p>{t('pricing.' + item + '_body')}</p>{item === 'open' && <a className="cq-pricing-text-link" href="https://github.com/RyuPrad/canquery">{t('pricing.source_code')} <span aria-hidden="true">↗</span></a>}</div>)}</div>
    </section>
    <footer className="cq-pricing-footer"><p>{t('pricing.footer_question')}</p><a className="btn btn-outline" href={inquiry}>{t('pricing.discuss_workflow')}</a><a className="cq-pricing-text-link" href="/terms">{t('account.terms')}</a></footer>
  </div>;
}
