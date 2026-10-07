import { useEffect, useRef, useState } from 'react';
import { useLang } from '../i18n.jsx';
import { accountRequest, authRequest } from '../api/account.js';
import './AccountExperience.css';

function RevokeConfirmation({ apiKey, pending, error, onClose, onConfirm }) {
  const { t } = useLang();
  const dialog = useRef(null);
  const cancel = useRef(null);
  useEffect(() => { dialog.current.showModal(); cancel.current.focus(); }, []);
  return <dialog ref={dialog} className="cq-account-dialog" aria-labelledby="revoke-title" aria-describedby="revoke-description"
    onCancel={event => { event.preventDefault(); if (!pending) onClose(); }}>
    <h2 id="revoke-title" className="text-xl font-display font-bold">{t('account.revoke_title')}</h2>
    <p className="font-semibold break-words mt-4">{apiKey.name}</p><code className="text-sm break-all">{apiKey.prefix}…</code>
    <p id="revoke-description" className="mt-4 leading-relaxed">{t('account.revoke_description')}</p>
    {error && <p role="alert" className="text-error mt-4">{t(error)}</p>}
    <div className="cq-account-actions mt-6">
      <button ref={cancel} className="btn btn-outline" disabled={pending} onClick={onClose}>{t('account.cancel')}</button>
      <button className="btn btn-error" disabled={pending} onClick={onConfirm}>{pending ? t('account.working') : t('account.revoke_confirm')}</button>
    </div>
  </dialog>;
}

export default function AccountPage() {
  const { t, lang } = useLang();
  const [account, setAccount] = useState(null);
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);
  const [pending, setPending] = useState(false);
  const [secret, setSecret] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  const [revokeTarget, setRevokeTarget] = useState(null);
  const revokeTrigger = useRef(null);
  const keyName = useRef(null);
  const secretField = useRef(null);
  useEffect(() => { if (secret) secretField.current?.focus(); }, [secret]);
  useEffect(() => {
    const controller = new AbortController();
    accountRequest('', { signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) { setAccount(data); setUnauthorized(false); setError(''); }
    }).catch(err => {
      if (!controller.signal.aborted) {
        setUnauthorized(err.status === 401);
        if (err.status === 401) { setAccount(null); setSecret(''); setRevokeTarget(null); }
        setError('account.load_error');
      }
    });
    return () => controller.abort();
  }, [reload]);
  const refresh = () => setReload(n => n + 1);
  async function act(work) {
    if (pending) return false;
    setPending(true); setError(''); setNotice('');
    try { await work(); refresh(); return true; }
    catch { setError('account.action_error'); return false; }
    finally { setPending(false); }
  }
  const billing = path => act(async () => {
    const result = await accountRequest(path, { method: 'POST' });
    const url = new URL(result.url);
    if (url.protocol !== 'https:' || !['checkout.stripe.com', 'billing.stripe.com'].includes(url.hostname)) throw Error('Invalid billing destination');
    window.location.assign(url.href);
  });
  const label = (key, values) => t(key).replace(/\{(\w+)\}/g, (match, name) => values[name] ?? match);
  const number = value => Number(value).toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA');
  const date = value => new Intl.DateTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(value));
  const closeRevoke = (revoked = false) => {
    setRevokeTarget(null); setError('');
    requestAnimationFrame(() => {
      const target = revoked ? keyName.current : revokeTrigger.current;
      if (target?.isConnected) target.focus(); else keyName.current?.focus();
    });
  };
  if (unauthorized) return <section className="cq-account-page max-w-3xl mx-auto px-4 py-12">
    <p className="cq-account-eyebrow">{t('account.workspace')}</p><h1 className="text-3xl font-display font-bold mt-2">{t('account.title')}</h1>
    <div className="cq-card p-6 mt-6"><p>{t('account.sign_in_needed')}</p><a className="btn btn-primary mt-5" href="/login">{t('account.login')}</a></div>
  </section>;
  const keyLimitReached = account && account.keys.length >= account.key_limit;
  return <section className="cq-account-page max-w-6xl mx-auto px-4 py-8 sm:py-12 space-y-6">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0"><p className="cq-account-eyebrow">{t('account.workspace')}</p><h1 className="text-3xl sm:text-4xl font-display font-bold mt-2">{t('account.title')}</h1>
        <p className="mt-3 text-base-content/75 max-w-2xl">{t('account.dashboard_intro')}</p></div>
      {account && <button className="btn btn-outline" disabled={pending} onClick={() => act(async () => { await authRequest('sign-out', {}, lang); setSecret(''); window.location.assign('/'); })}>{t('account.sign_out')}</button>}
    </header>
    {error && !revokeTarget && <div role="alert" className="cq-card p-5"><p>{t(error)}</p><button className="btn btn-outline mt-3" disabled={pending} onClick={refresh}>{t('account.retry')}</button></div>}
    {!account && !error && <div className="cq-card p-8 min-h-64" role="status">{t('account.loading')}</div>}
    {account && <>
      {account.mode === 'sandbox' && <p className="cq-account-notice" role="status">{t('account.sandbox')}</p>}
      {new URLSearchParams(window.location.search).get('checkout') === 'returned' && <div className="cq-account-notice" role="status">{t('account.payment_pending')} <button className="btn btn-ghost" disabled={pending} onClick={refresh}>{t('account.refresh')}</button></div>}
      <div className="grid lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] gap-6">
        <section className="cq-card p-5 sm:p-7 min-w-0" aria-labelledby="account-plan-heading">
          <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="account-plan-heading" className="text-xl font-display font-bold">{t('account.allowance')}</h2><span className="cq-account-pill">{t('account.plan_' + account.plan)}</span></div>
          <p className="text-sm text-base-content/75 break-all mt-2">{account.user.email}</p>
          <dl className="cq-account-metrics mt-6">
            <div><dt>{t('account.remaining_label')}</dt><dd>{number(account.remaining)}</dd></div>
            <div><dt>{t('account.used_label')}</dt><dd>{number(account.used)}</dd></div>
            <div><dt>{t('account.reserved_label')}</dt><dd>{number(account.reserved)}</dd></div>
          </dl>
          <div className="flex flex-wrap justify-between gap-2 text-sm mt-6 mb-2"><span>{label('account.used_of_allowance', { used: number(account.used), total: number(account.limit) })}</span><span>{t('account.credits')}</span></div>
          <progress className="progress progress-primary w-full" value={account.used} max={account.limit} aria-label={t('account.used_label')} />
          <p className="text-sm text-base-content/75 mt-3">{t('account.reserved_help')}</p>
          <p className="mt-4 text-sm">{t('account.resets')} <time dateTime={account.resets_at}>{new Intl.DateTimeFormat(lang === 'fr' ? 'fr-CA' : 'en-CA', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(account.resets_at))} UTC</time></p>
          <p className="text-sm text-base-content/75 mt-2">{number(account.rate_limit)} {t('account.requests_minute')} · {label('account.key_slots', { used: number(account.keys.length), total: number(account.key_limit) })}</p>
          <p className="text-sm text-base-content/75 mt-4">{t('account.quota_note')}</p>
          {(account.checkout_available || account.billing_customer) && <div className="cq-account-actions mt-5">
            {account.plan === 'free' && account.checkout_available && <button className="btn btn-primary" disabled={pending} onClick={() => billing('/checkout')}>{t('account.upgrade')}</button>}
            {account.billing_customer && <button className="btn btn-outline" disabled={pending} onClick={() => billing('/portal')}>{t('account.manage_billing')}</button>}
          </div>}
        </section>
        <aside className="cq-card p-5 sm:p-7 min-w-0" aria-labelledby="account-next-heading">
          <p className="cq-account-eyebrow">{t('account.next_step')}</p><h2 id="account-next-heading" className="text-xl font-display font-bold mt-2">{t(account.keys.length ? 'account.try_workflow' : 'account.start_integration')}</h2>
          <ol className="cq-account-steps mt-5">
            <li><span aria-hidden="true">1</span><div><a href="#api-keys" className="link font-semibold">{t('account.step_key')}</a><p>{t('account.step_key_help')}</p></div></li>
            <li><span aria-hidden="true">2</span><div><a href="/docs#quickstart" className="link font-semibold">{t('account.step_request')}</a><p>{t('account.step_request_help')}</p></div></li>
            <li><span aria-hidden="true">3</span><div><a href="#usage" className="link font-semibold">{t('account.step_usage')}</a><p>{t('account.step_usage_help')}</p></div></li>
          </ol>
          <div className="border-t border-base-content/15 pt-5 mt-6"><p className="text-sm text-base-content/75">{t('account.support_scope')}</p><a className="link inline-block mt-3" href={'mailto:support@canquery.com?subject=' + encodeURIComponent(t('account.workflow_subject'))}>{t('account.workflow_contact')}</a></div>
        </aside>
      </div>
      <section id="api-keys" className="cq-card p-5 sm:p-7 space-y-5 scroll-mt-24" aria-labelledby="account-keys-heading">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 id="account-keys-heading" className="text-xl font-display font-bold">{t('account.api_keys')}</h2><span className="text-sm text-base-content/75">{label('account.key_slots', { used: number(account.keys.length), total: number(account.key_limit) })}</span></div>
        <p className="text-base-content/75 max-w-3xl">{t('account.key_help')}</p>
        {secret && <div className="cq-account-secret space-y-3"><p role="status" className="font-semibold">{t('account.save_key')}</p>
          <textarea ref={secretField} className="textarea w-full font-mono break-all" rows={3} readOnly value={secret} aria-label={t('account.new_key')} onFocus={event => event.target.select()} />
          <div className="cq-account-actions"><button className="btn btn-primary" onClick={async () => { try { await navigator.clipboard.writeText(secret); setNotice('account.copied'); } catch { setNotice('account.copy_failed'); secretField.current?.focus(); secretField.current?.select(); } }}>{t('account.copy')}</button>
            <button className="btn btn-outline" onClick={() => { setSecret(''); setNotice(''); }}>{t('account.dismiss')}</button></div></div>}
        {notice && <p role="status">{t(notice)}</p>}
        {!account.keys.length ? <div className="cq-account-empty"><h3 className="font-semibold">{t('account.no_keys')}</h3><p className="mt-2 text-sm text-base-content/75">{t('account.no_keys_help')}</p></div> : <ul className="cq-account-key-list">{account.keys.map(key => <li key={key.id}>
          <div className="min-w-0 flex-1"><div className="flex flex-wrap items-center gap-2"><h3 className="font-semibold break-words min-w-0">{key.name}</h3><span className="cq-account-key-status">{t(key.enabled ? 'account.key_active' : 'account.key_disabled')}</span></div>
            <p className="text-sm text-base-content/75 mt-2"><code className="break-all">{key.prefix}…</code>{key.created_at && <> · {t('account.key_created')} <time dateTime={key.created_at}>{date(key.created_at)} UTC</time></>}</p></div>
          <button className="btn btn-outline" disabled={pending} aria-label={label('account.revoke_named', { name: key.name })} onClick={event => { revokeTrigger.current = event.currentTarget; setError(''); setRevokeTarget(key); }}>{t('account.revoke')}</button>
        </li>)}</ul>}
        <form className="cq-account-key-form" onSubmit={event => {
          event.preventDefault(); if (keyLimitReached) return;
          const form = event.currentTarget; const name = new FormData(form).get('name');
          void act(async () => { const created = await accountRequest('/keys', { method: 'POST', body: JSON.stringify({ name }) }); setSecret(created.secret); form.reset(); });
        }}>
          <label className="min-w-0 flex-1 font-medium" htmlFor="key-name">{t('account.key_name')}<input ref={keyName} id="key-name" className="input w-full mt-2" name="name" required maxLength={80} placeholder={t('account.key_placeholder')} aria-describedby={keyLimitReached ? 'key-limit-help' : 'key-name-help'} /></label>
          <button className="btn btn-primary" disabled={pending || keyLimitReached}>{t('account.create_key')}</button>
        </form>
        <p id={keyLimitReached ? 'key-limit-help' : 'key-name-help'} className="text-sm text-base-content/75">{t(keyLimitReached ? 'account.key_limit_help' : 'account.key_name_help')}</p>
      </section>
      <section id="usage" className="cq-card p-5 sm:p-7 scroll-mt-24" aria-labelledby="account-usage-heading"><h2 id="account-usage-heading" className="text-xl font-display font-bold">{t('account.usage')}</h2><p className="text-sm text-base-content/75 mt-2">{t('account.usage_help')}</p>
        {!account.usage.length ? <div className="cq-account-empty mt-5"><p className="font-semibold">{t('account.no_usage')}</p><a href="/docs#quickstart" className="link inline-block mt-3">{t('account.step_request')}</a></div> : <div className="overflow-x-auto mt-5" tabIndex={0} role="region" aria-label={t('account.usage')}><table className="table"><caption className="sr-only">{t('account.usage')}</caption><thead><tr><th scope="col">{t('account.date')}</th><th scope="col">{t('account.operation')}</th><th scope="col" className="text-right">{t('account.requests')}</th><th scope="col" className="text-right">{t('account.credits')}</th></tr></thead><tbody>{account.usage.map(row => <tr key={row.day + row.operation}><td className="whitespace-nowrap">{String(row.day).slice(0, 10)}</td><td>{t('account.op_' + row.operation)}</td><td className="text-right tabular-nums">{number(row.requests)}</td><td className="text-right tabular-nums">{number(row.credits)}</td></tr>)}</tbody></table></div>}
      </section>
      {revokeTarget && <RevokeConfirmation apiKey={revokeTarget} pending={pending} error={error} onClose={() => closeRevoke()} onConfirm={async () => {
        const done = await act(async () => { await accountRequest('/keys/' + revokeTarget.id, { method: 'DELETE' }); setSecret(''); });
        if (done) closeRevoke(true);
      }} />}
    </>}
  </section>;
}
