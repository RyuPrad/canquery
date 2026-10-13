/* eslint-disable react-refresh/only-export-components -- extension part: core slots read its components from one object */
import { Link, NavLink } from 'react-router-dom';
import { useLang } from '../i18n.jsx';

// Pricing and the developer account in the menu panel; pricing and terms in the footer.
function NavLinks({ navClass, close }) {
  const { t } = useLang();
  return <>
    <NavLink to="/pricing" className={navClass} onClick={close}>{t('account.pricing')}</NavLink>
    <a href="/account" className="cq-nav-link" onClick={close}>{t('account.title')}</a>
  </>;
}

function FooterLinks() {
  const { t } = useLang();
  return <>
    <li><Link to="/pricing" className="text-base-content/65 hover:text-base-content transition-colors">{t('account.pricing')}</Link></li>
    <li><Link to="/terms" className="text-base-content/65 hover:text-base-content transition-colors">{t('account.terms')}</Link></li>
  </>;
}

export default { NavLinks, FooterLinks };
