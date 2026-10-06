import { useEffect, useState } from 'react';
import { useLang } from '../i18n.jsx';
import { accountRequest, authRequest } from '../api/account.js';

export default function AccountPage() {
  const { t, lang } = useLang();
  const [account, setAccount] = useState(null);
  const [error, setError] = useState('');
  const [unauthorized, setUnauthorized] = useState(false);
  const [pending, setPending] = useState(false);
  const [secret, setSecret] = useState('');
  const [notice, setNotice] = useState('');
  const [reload, setReload] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    accountRequest('', { signal: controller.signal }).then(data => { if (!controller.signal.aborted) { setAccount(data); setUnauthorized(false); setError(''); } })
      .catch(err => { if (!controller.signal.aborted) { setUnauthorized(err.status === 401); if (err.status === 401) { setAccount(null); setSecret(''); } setError('account.load_error'); } });
    return () => controller.abort();
  }, [reload]);
  const refresh = () => setReload(n => n + 1);
  async function act(work) {
    if (pending) return;
    setPending(true); setError(''); setNotice('');
    try { await work(); refresh(); }
    catch { setError('account.action_error'); }
    finally { setPending(false); }
  }
  const billing = path => act(async () => {
    const result = await accountRequest(path, { method: 'POST' });
    const url = new URL(result.url);
    if (url.protocol !== 'https:' || !['checkout.stripe.com', 'billing.stripe.com'].includes(url.hostname)) throw Error('Invalid billing destination');
    window.location.assign(url.href);
  });
  const number = value => Number(value).toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA');
  if (unauthorized) return <section className="max-w-3xl mx-auto px-4 py-12"><h1 className="text-3xl font-bold">{t('account.title')}</h1><p className="mt-4">{t('account.sign_in_needed')}</p><a className="btn btn-primary mt-6" href="/login">{t('account.login')}</a></section>;
  return <section className="max-w-5xl mx-auto px-4 py-10 space-y-7">
    <div className="flex flex-wrap justify-between gap-4"><h1 className="text-3xl font-display font-bold">{t('account.title')}</h1>
      {account && <button className="btn btn-ghost" disabled={pending} onClick={() => act(async () => { await authRequest('sign-out', {}, lang); setSecret(''); window.location.assign('/'); })}>{t('account.sign_out')}</button>}</div>
    {error && <div role="alert" className="cq-card p-4"><p>{t(error)}</p><button className="btn btn-sm mt-2" onClick={refresh}>{t('account.retry')}</button></div>}
    {!account && !error && <p role="status">{t('account.loading')}</p>}
    {account && <>
      {account.mode === 'sandbox' && <p className="cq-card p-4" role="status">{t('account.sandbox')}</p>}
      {new URLSearchParams(window.location.search).get('checkout') === 'returned' && <p role="status">{t('account.payment_pending')} <button className="link" onClick={refresh}>{t('account.refresh')}</button></p>}
      <div className="cq-card p-6 space-y-3">
        <h2 className="text-xl font-bold">{t('account.plan')} · {t('account.plan_' + account.plan)}</h2>
        <p>{account.user.email}</p>
        <p className="text-2xl font-semibold">{number(account.remaining)} / {number(account.limit)} {t('account.credits_remaining')}</p>
        <progress className="progress progress-primary w-full" value={account.used + account.reserved} max={account.limit} aria-label={t('account.credits_used')} />
        <p>{t('account.resets')} {new Date(account.resets_at).toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA')}</p>
        <p>{number(account.rate_limit)} {t('account.requests_minute')} · {number(account.key_limit)} {t('account.keys')}</p>
        <p className="text-sm">{t('account.quota_note')}</p>
        <div className="flex flex-wrap gap-3 pt-2">
          {account.plan === 'free' && account.checkout_available && <button className="btn btn-primary" disabled={pending} onClick={() => billing('/checkout')}>{t('account.upgrade')}</button>}
          {account.billing_customer && <button className="btn btn-outline" disabled={pending} onClick={() => billing('/portal')}>{t('account.manage_billing')}</button>}
          <a className="btn btn-ghost" href="mailto:support@canquery.com?subject=CanQuery%20Enterprise">{t('account.enterprise_contact')}</a>
        </div>
      </div>
      <section className="cq-card p-6 space-y-4"><h2 className="text-xl font-bold">{t('account.api_keys')}</h2>
        <p>{t('account.key_help')}</p>
        {secret && <div className="border border-primary rounded-xl p-4 space-y-2"><p role="status">{t('account.save_key')}</p>
          <textarea className="textarea w-full font-mono break-all" rows={2} readOnly value={secret} aria-label={t('account.new_key')} />
          <button className="btn btn-sm" onClick={async () => { try { await navigator.clipboard.writeText(secret); setNotice('account.copied'); } catch { setNotice('account.copy_failed'); } }}>{t('account.copy')}</button>
          <button className="btn btn-sm btn-ghost ml-2" onClick={() => setSecret('')}>{t('account.dismiss')}</button></div>}
        {notice && <p role="status">{t(notice)}</p>}
        <ul className="space-y-3">{account.keys.map(key => <li key={key.id} className="flex flex-wrap items-center gap-3 border-b border-base-content/15 pb-3">
          <span className="grow break-all">{key.name} <code>{key.prefix}…</code> {!key.enabled && <span>{t('account.key_disabled')}</span>}</span>
          <button className="btn btn-sm btn-outline" disabled={pending} onClick={() => act(async () => { await accountRequest('/keys/' + key.id, { method: 'DELETE' }); setSecret(''); })}>{t('account.revoke')}</button>
        </li>)}</ul>
        <form className="flex flex-wrap gap-3" onSubmit={event => { event.preventDefault(); const form = event.currentTarget; const name = new FormData(form).get('name'); void act(async () => { const created = await accountRequest('/keys', { method: 'POST', body: JSON.stringify({ name }) }); setSecret(created.secret); form.reset(); }); }}>
          <label className="grow">{t('account.key_name')}<input className="input w-full mt-1" name="name" required maxLength={80} /></label>
          <button className="btn btn-primary self-end" disabled={pending || account.keys.length >= account.key_limit}>{t('account.create_key')}</button>
        </form>
        <a className="link inline-block" href="/docs">{t('account.documentation')}</a>
      </section>
      <section className="cq-card p-6"><h2 className="text-xl font-bold">{t('account.usage')}</h2>
        {!account.usage.length ? <p className="mt-3">{t('account.no_usage')}</p> : <div className="overflow-x-auto"><table className="table"><caption className="sr-only">{t('account.usage')}</caption><thead><tr><th>{t('account.date')}</th><th>{t('account.operation')}</th><th>{t('account.requests')}</th><th>{t('account.credits')}</th></tr></thead><tbody>{account.usage.map(row => <tr key={row.day + row.operation}><td>{String(row.day).slice(0, 10)}</td><td>{t('account.op_' + row.operation)}</td><td>{number(row.requests)}</td><td>{number(row.credits)}</td></tr>)}</tbody></table></div>}
      </section>
    </>}
  </section>;
}
