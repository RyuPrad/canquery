import { useEffect, useRef, useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useLang } from '../i18n.jsx';
import { authRequest } from '../api/account.js';
import useCommercialPlans from '../hooks/useCommercialPlans.js';
import { businessPrice, currentTermsVersion } from '../utils/businessPrice.js';
import './AccountExperience.css';

export default function AuthPage() {
  const { pathname } = useLocation();
  const { t, lang } = useLang();
  const mode = pathname.slice(1);
  const { plans, error: plansError, retry: retryPlans } = useCommercialPlans(mode === 'signup');
  const termsVersion = currentTermsVersion(plans);
  const price = businessPrice(plans?.business_price, lang);
  const [resetLink] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return { token: params.get('token'), invalid: params.get('error') === 'INVALID_TOKEN' };
  });
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [verificationEmail, setVerificationEmail] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [invalidReset, setInvalidReset] = useState(resetLink.invalid);
  const resultHeading = useRef(null);
  const errorBox = useRef(null);
  const needsResetLink = mode === 'reset-password' && (!resetLink.token || invalidReset);
  useEffect(() => { if (mode === 'reset-password') window.history.replaceState(null, '', '/reset-password'); }, [mode]);
  useEffect(() => { if (message || needsResetLink) resultHeading.current?.focus(); }, [message, needsResetLink]);
  useEffect(() => { if (error) errorBox.current?.focus(); }, [error]);
  async function submit(event) {
    event.preventDefault();
    if (pending || needsResetLink || (mode === 'signup' && !termsVersion)) return;
    setPending(true); setError(''); setMessage(''); setVerificationEmail('');
    const values = Object.fromEntries(new FormData(event.currentTarget));
    try {
      if (mode === 'signup') {
        await authRequest('sign-up/email', { ...values, callbackURL: window.location.origin + '/account' }, lang);
        setMessage('account.check_email');
      } else if (mode === 'login') {
        await authRequest('sign-in/email', values, lang); window.location.assign('/account');
      } else if (mode === 'forgot-password') {
        await authRequest('request-password-reset', { email: values.email, redirectTo: window.location.origin + '/reset-password' }, lang);
        setMessage('account.check_email_generic');
      } else {
        await authRequest('reset-password', { token: resetLink.token, newPassword: values.password }, lang);
        setMessage('account.password_changed');
      }
    } catch (err) {
      if (mode === 'reset-password' && ['INVALID_TOKEN', 'TOKEN_EXPIRED'].includes(err.code)) setInvalidReset(true);
      else setError(err.code === 'EMAIL_NOT_VERIFIED' ? 'account.verify_first' : 'account.auth_error');
      setVerificationEmail(err.code === 'EMAIL_NOT_VERIFIED' ? values.email : '');
    } finally { setPending(false); }
  }
  const successTitle = message === 'account.password_changed' ? 'account.password_saved_title' : 'account.check_inbox_title';
  return <section className="cq-auth-page max-w-5xl mx-auto px-4 py-8 sm:py-14"><div className="cq-auth-layout">
    <header className="cq-auth-intro"><p className="cq-account-eyebrow">{t('account.workspace')}</p><h1 className="font-display font-bold text-3xl sm:text-4xl mt-3">{t('account.' + mode)}</h1>
      <p className="mt-4 text-base-content/75 leading-relaxed">{t('account.intro_' + mode)}</p></header>
    <div className="cq-auth-form-panel min-w-0">
      {needsResetLink ? <div className="cq-card p-6 sm:p-8 space-y-4"><h2 ref={resultHeading} tabIndex={-1} className="text-xl font-display font-bold">{t('account.reset_link_title')}</h2><p>{t('account.reset_link_help')}</p><a className="btn btn-primary" href="/forgot-password">{t('account.request_new_link')}</a></div>
        : message ? <div className="cq-card p-6 sm:p-8 space-y-4"><span className="cq-auth-success-mark" aria-hidden="true">✓</span><h2 ref={resultHeading} tabIndex={-1} className="text-xl font-display font-bold">{t(successTitle)}</h2>
          <p role="status" className="leading-relaxed">{t(message)}</p>{message !== 'account.password_changed' && <p className="text-sm text-base-content/75">{t('account.email_delivery_help')}</p>}<a className="btn btn-primary" href="/login">{t('account.login')}</a></div>
          : <form className="cq-card p-6 sm:p-8 space-y-5" onSubmit={submit} aria-busy={pending}>
            {mode === 'signup' && <div><label className="font-medium" htmlFor="auth-name">{t('account.name')}</label><input id="auth-name" className="input w-full mt-2" name="name" autoComplete="name" required maxLength={100} disabled={pending} /></div>}
            {mode !== 'reset-password' && <div><label className="font-medium" htmlFor="auth-email">{t('account.email')}</label><input id="auth-email" className="input w-full mt-2" type="email" name="email" autoComplete="email" required maxLength={254} disabled={pending} aria-describedby="auth-email-hint" /><p id="auth-email-hint" className="text-sm mt-2 text-base-content/75">{t(mode === 'signup' ? 'account.signup_email_hint' : 'account.email_hint')}</p></div>}
            {mode !== 'forgot-password' && <div><label className="font-medium" htmlFor="auth-password">{t('account.password')}</label><div className="cq-auth-password mt-2"><input id="auth-password" className="input w-full" type={showPassword ? 'text' : 'password'} name="password" autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required minLength={12} maxLength={128} disabled={pending} aria-describedby="auth-password-hint" /><button type="button" className="btn btn-ghost" aria-pressed={showPassword} aria-controls="auth-password" onClick={() => setShowPassword(value => !value)}>{t(showPassword ? 'account.hide_password' : 'account.show_password')}</button></div><p id="auth-password-hint" className="text-sm mt-2 text-base-content/75">{t(mode === 'login' ? 'account.login_password_hint' : 'account.password_hint')}</p></div>}
            {mode === 'signup' && <><label className="cq-auth-agreement"><input type="checkbox" name="termsVersion" value={termsVersion || ''} required disabled={pending || !termsVersion} className="checkbox shrink-0" /><span>{t('account.agreement')} <a className="link" href="/terms">{t('account.terms')}</a> · <a className="link" href="/privacy">{t('account.privacy')}</a></span></label>
              {!termsVersion && <p role={plansError || plans ? 'alert' : 'status'}>{t(plansError || plans ? 'account.terms_load_error' : 'account.terms_loading')}</p>}
              {(plansError || (plans && !termsVersion)) && <button type="button" className="btn btn-outline" onClick={retryPlans}>{t('account.retry')}</button>}</>}
            {error && <p ref={errorBox} tabIndex={-1} role="alert" className="cq-auth-error">{t(error)}</p>}
            {verificationEmail && <button type="button" className="btn btn-outline w-full" disabled={pending} onClick={async () => {
              setPending(true); setError('');
              try { await authRequest('send-verification-email', { email: verificationEmail, callbackURL: window.location.origin + '/account' }, lang); setMessage('account.check_email'); setVerificationEmail(''); }
              catch { setError('account.auth_error'); }
              finally { setPending(false); }
            }}>{t('account.resend_verification')}</button>}
            <button className="btn btn-primary w-full" disabled={pending || (mode === 'signup' && !termsVersion)}>{pending ? t('account.working') : t('account.' + mode)}</button>
            {mode === 'login' && <a className="link block text-center" href="/forgot-password">{t('account.forgot-password')}</a>}
          </form>}
      <nav className="cq-auth-navigation mt-5" aria-label={t('account.navigation')}>
        {mode === 'login' ? <><span>{t('account.new_here')}</span><a className="link" href="/signup">{t('account.signup')}</a></> : <><span>{t('account.already_registered')}</span><a className="link" href="/login">{t('account.login')}</a></>}
      </nav><p className="mt-5 text-sm text-center text-base-content/75">{t('account.need_help')} <a className="link" href="mailto:support@canquery.com">support@canquery.com</a></p>
    </div>
    <aside className="cq-auth-context"><p className="cq-auth-note">{t('account.auth_privacy_note')}</p>{mode === 'signup' && plans?.enabled && plans.checkout && price && <p className="cq-auth-note">{t('account.signup_plans').replace('{price}', price)}</p>}<a className="link inline-block" href="/docs#quickstart">{t('account.preview_docs')}</a></aside>
  </div></section>;
}
