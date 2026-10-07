import { useEffect, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import { authRequest } from '../api/account.js';

export default function AuthPage() {
  const { pathname } = useLocation();
  const { t, lang } = useLang();
  const mode = pathname.slice(1);
  const [token] = useState(() => new URLSearchParams(window.location.search).get('token'));
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');
  useEffect(() => {
    if (mode === 'reset-password') window.history.replaceState(null, '', '/reset-password');
  }, [mode]);
  async function submit(event) {
    event.preventDefault();
    if (pending) return;
    setPending(true); setError(''); setMessage('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (mode === 'signup') {
        await authRequest('sign-up/email', { ...values, callbackURL: window.location.origin + '/account' }, lang);
        setMessage('account.check_email');
      } else if (mode === 'login') {
        await authRequest('sign-in/email', values, lang);
        window.location.assign('/account');
      } else if (mode === 'forgot-password') {
        await authRequest('request-password-reset', { email: values.email, redirectTo: window.location.origin + '/reset-password' }, lang);
        setMessage('account.check_email_generic');
      } else {
        await authRequest('reset-password', { token, newPassword: values.password }, lang);
        setMessage('account.password_changed');
      }
    } catch (err) {
      setError(err.code === 'EMAIL_NOT_VERIFIED' ? 'account.verify_first' : 'account.auth_error');
      setVerificationEmail(err.code === 'EMAIL_NOT_VERIFIED' ? values.email : '');
    } finally { setPending(false); }
  }
  return <section className="max-w-lg mx-auto px-4 py-12">
    <h1 className="font-display font-bold text-3xl">{t('account.' + mode)}</h1>
    <p className="mt-3 text-base-content/80">{t('account.auth_intro')}</p>
    <form className="cq-card p-6 mt-6 space-y-5" onSubmit={submit}>
      {mode === 'signup' && <label className="block">{t('account.name')}<input className="input w-full mt-1" name="name" autoComplete="name" required maxLength={100} /></label>}
      {mode !== 'reset-password' && <label className="block">{t('account.email')}<input className="input w-full mt-1" type="email" name="email" autoComplete="email" required maxLength={254} /></label>}
      {mode !== 'forgot-password' && <label className="block">{t('account.password')}<input className="input w-full mt-1" type="password" name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={12} maxLength={128} /><span className="block text-sm mt-1">{t('account.password_hint')}</span></label>}
      {mode === 'signup' && <label className="flex items-start gap-3 text-sm"><input type="checkbox" name="termsVersion" value="2026-10-06" required className="checkbox shrink-0" /><span>{t('account.agreement')} <a className="link" href="/terms">{t('account.terms')}</a> · <a className="link" href="/privacy">{t('account.privacy')}</a></span></label>}
      {error && <p role="alert" className="text-error">{t(error)}</p>}
      {verificationEmail && <button type="button" className="btn btn-outline w-full" disabled={pending} onClick={async () => {
        setPending(true); setError('');
        try { await authRequest('send-verification-email', { email: verificationEmail, callbackURL: window.location.origin + '/account' }, lang); setMessage('account.check_email'); setVerificationEmail(''); }
        catch { setError('account.auth_error'); }
        finally { setPending(false); }
      }}>{t('account.resend_verification')}</button>}
      {message && <p role="status">{t(message)}</p>}
      <button className="btn btn-primary w-full" disabled={pending || (mode === 'reset-password' && !token)}>{pending ? t('account.working') : t('account.' + mode)}</button>
    </form>
    <nav className="flex flex-wrap gap-4 mt-6" aria-label={t('account.navigation')}>
      {mode !== 'login' && <a className="link" href="/login">{t('account.login')}</a>}
      {mode !== 'signup' && <a className="link" href="/signup">{t('account.signup')}</a>}
      {mode === 'login' && <a className="link" href="/forgot-password">{t('account.forgot-password')}</a>}
    </nav>
    <p className="mt-6 text-sm"><a className="link" href="mailto:support@canquery.com">support@canquery.com</a></p>
  </section>;
}
