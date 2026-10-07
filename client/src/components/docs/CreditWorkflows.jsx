import { useEffect, useState } from 'react';
import { accountRequest } from '../../api/account.js';
import { useLang } from '../../i18n.jsx';
import './CreditWorkflows.css';

export default function CreditWorkflows({ plans: suppliedPlans }) {
  const { t, lang } = useLang();
  const [fetchedPlans, setFetchedPlans] = useState(null);
  useEffect(() => {
    if (suppliedPlans !== undefined) return;
    const controller = new AbortController();
    accountRequest('/plans', { signal: controller.signal }).then(value => {
      if (!controller.signal.aborted) setFetchedPlans(value);
    }).catch(() => {});
    return () => controller.abort();
  }, [suppliedPlans]);
  const plans = suppliedPlans === undefined ? fetchedPlans : suppliedPlans;
  const number = value => Number.isFinite(Number(value)) && value != null ? Number(value).toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA') : '—';
  const costs = plans?.credit_costs;
  const label = (key, values) => t(key).replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
  return <div className="cq-credit-workflows">
    <h3>{t('pricing.workflow_costs')}</h3>
    <p>{t('pricing.workflow_costs_intro')}</p>
    <div className="cq-credit-workflow-grid">{['ready', 'prepare', 'reuse'].map(name => <article key={name}>
      <p className="cq-credit-total"><strong>{number(plans?.workflow_costs?.[name])}</strong> {t('account.credits')}</p>
      <h4>{t(`pricing.cost_${name}_title`)}</h4>
      <p>{label(`pricing.cost_${name}_body`, { metadata: number(costs?.metadata), query: number(costs?.query), prepare: number(costs?.preparation), free: number(costs?.activity) })}</p>
    </article>)}</div>
    <p className="cq-credit-allowances">{label('pricing.workflow_allowances', { free: number(plans?.plans?.free?.credits), business: number(plans?.plans?.business?.credits) })}</p>
    <p>{label('pricing.workflow_optional', { aggregate: number(plans?.workflow_costs?.prepare_aggregate), direct: number(plans?.workflow_costs?.direct_query), export: number(plans?.workflow_costs?.export) })}</p>
    {!costs && <p>{t('pricing.costs_unavailable')} <a href="/pricing">{t('docs.pricing_cta')}</a></p>}
  </div>;
}
