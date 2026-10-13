/* eslint-disable react-refresh/only-export-components -- extension part: core slots read its components from one object */
import { useLang } from '../i18n.jsx';

// How the developer account handles personal information.
function AccountPrivacy() {
  const { t } = useLang();
  return <section className="mt-9"><h2 className="text-xl font-semibold font-display">{t('account.privacy_title')}</h2><p className="text-sm text-base-content/80 mt-3 leading-relaxed">{t('account.privacy_body')}</p></section>;
}

export default { Sections: AccountPrivacy };
