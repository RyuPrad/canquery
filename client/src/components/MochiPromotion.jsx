import { useLang } from '../i18n.jsx';
import { usePromotionView } from './PromotionTracking.jsx';
import { ArrowUpRightIcon } from './Icons.jsx';
import cat from '../assets/mochi-cat.svg';
import './MochiPromotion.css';

const DESTINATION = 'https://hellomochi.app/';

export default function MochiPromotion({ placement = 'home_card' }) {
  const { t, lang } = useLang();
  const ref = usePromotionView(placement);
  const compact = placement === 'footer';
  const link = <a href={DESTINATION} target="_blank" rel="noopener noreferrer sponsored" className="mochi-promotion-link">
    {compact ? 'Hello Mochi' : t('promotion.cta')}
    <ArrowUpRightIcon size={16} />
    <span className="sr-only"> {t('promotion.new_tab')}</span>
  </a>;

  return <aside ref={ref} aria-label={t(compact ? 'promotion.footer_label' : 'promotion.label')}
    className={`mochi-promotion ${compact ? 'mochi-promotion-compact' : 'mochi-promotion-home'}`}
    data-promotion="hello_mochi" data-promotion-placement={placement} data-promotion-language={lang}>
    <img className="mochi-promotion-cat" src={cat} width="180" height="150" alt="" />
    <div className="mochi-promotion-copy">
      <p className="mochi-promotion-attribution">{t(compact ? 'promotion.footer_attribution' : 'promotion.attribution')}</p>
      {compact ? link : <>
        <p className="mochi-promotion-brand">Hello Mochi</p>
        <h2>{t('promotion.headline')}</h2>
        <p className="mochi-promotion-description">{t('promotion.description')}</p>
      </>}
      {compact && lang === 'fr' && <p className="mochi-promotion-language">{t('promotion.english_app')}</p>}
    </div>
    {!compact && <div className="mochi-promotion-action">
      {link}
      {lang === 'fr' && <p className="mochi-promotion-language">{t('promotion.english_app')}</p>}
    </div>}
  </aside>;
}
