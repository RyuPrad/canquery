import { useLang } from '../i18n.jsx';

export default function Footer() {
  const { t } = useLang();
  return (
    <footer className="footer footer-center bg-base-200 text-base-content/70 p-6 mt-12 text-sm">
      <p>
        {t('footer.licence_pre')}{' '}
        <a
          href="https://open.canada.ca/en/open-government-licence-canada"
          target="_blank"
          rel="noreferrer"
          className="link"
        >
          {t('footer.licence_link')}
        </a>
        .
      </p>
      <p>{t('footer.independent')}</p>
      <p className="opacity-60">{t('footer.mirrored')}</p>
    </footer>
  );
}
