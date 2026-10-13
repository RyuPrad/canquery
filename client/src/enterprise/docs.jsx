/* eslint-disable react-refresh/only-export-components -- extension part: core slots read its components from one object */
import { useLang } from '../i18n.jsx';
import useAccountSession from './hooks/useAccountSession.js';
import CodeSample from '../components/docs/CodeSample.jsx';
import CreditWorkflows from './components/CreditWorkflows.jsx';

// Developer-account parts of /docs: the account call to action, the account and
// key steps before the first request, credit workflows and the plans link.
function HeroActions() {
  const { t } = useLang();
  const session = useAccountSession();
  const sessionStatus = session.checking ? 'loading' : session.status;
  return <div className="cq-doc-hero-actions"><a className="btn btn-primary min-h-12" href={sessionStatus === 'anonymous' ? '/signup' : '/account'}>{t(sessionStatus === 'anonymous' ? 'docs.key_cta' : sessionStatus === 'authenticated' ? 'account.manage_keys' : 'account.title')} <span aria-hidden="true">→</span></a><a className="cq-doc-secondary-link" href="/pricing">{t('docs.pricing_cta')} <span aria-hidden="true">↗</span></a></div>;
}

function AccountStep() {
  const { t } = useLang();
  return <><h3>{t('docs.first_account')}</h3><p>{t('docs.first_account_body')} <a href="/account">{t('account.api_keys')} →</a></p></>;
}

function KeyStep() {
  const { t } = useLang();
  return <><h3>{t('docs.first_key')}</h3><p>{t('docs.first_key_body')}</p><CodeSample label={t('docs.setup_label')} code={'export CANQUERY_API_KEY=\'YOUR_API_KEY\''} /></>;
}

function LimitsLink() {
  const { t } = useLang();
  return <a className="cq-doc-secondary-link" href="/pricing">{t('docs.pricing_cta')} →</a>;
}

export default {
  apiKey: true,
  HeroActions,
  quickstartSteps: [AccountStep, KeyStep],
  AfterPreparationExample: CreditWorkflows,
  LimitsLink,
};
