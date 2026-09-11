import { useLang } from '../i18n.jsx';

export default function CatalogOverview({ presentation, language, dataset = false }) {
  const { lang, t } = useLang();
  if (!presentation) return null;
  const selectedLanguage = language || lang;
  const fields = presentation.fields;
  const capabilities = presentation.capabilities || {};
  const actions = dataset ? [
    capabilities.ready > 0 && `${capabilities.ready} ${t('preview.ready_resources')}`,
    capabilities.loadable > 0 && `${capabilities.loadable} ${t('preview.loadable_resources')}`,
    capabilities.mapped > 0 && `${capabilities.mapped} ${t('preview.mapped_resources')}`
  ].filter(Boolean) : [
    capabilities.table === 'ready' && t('preview.ready'),
    capabilities.table === 'loadable' && t('preview.loadable'),
    capabilities.map && t('preview.map'), capabilities.download && t('preview.download')
  ].filter(Boolean);
  return <section data-cq-overview className="cq-card p-4 sm:p-5 space-y-3 min-w-0">
    <h2 className="text-base font-semibold">{t('preview.title')}</h2>
    {!dataset && <p className="text-sm leading-relaxed break-words">{presentation.summary?.[selectedLanguage]}</p>}
    <dl className="flex flex-wrap gap-x-8 gap-y-3 text-sm">
      {!!presentation.formats?.length && <div><dt className="text-base-content/60">{t('preview.formats')}</dt><dd>{presentation.formats.join(', ')}</dd></div>}
      {!!presentation.languages?.length && <div><dt className="text-base-content/60">{t('preview.languages')}</dt><dd>{presentation.languages.map(code => t('preview.language_' + code)).join(', ')}</dd></div>}
      {!!actions.length && <div><dt className="text-base-content/60">{t('preview.actions')}</dt><dd>{actions.join(' · ')}</dd></div>}
    </dl>
    {!!fields?.total && <div className="space-y-2">
      <h3 className="text-sm font-semibold">{t('preview.fields')} ({fields.items.length}/{fields.total})</h3>
      <p className="text-xs text-base-content/60">{t(fields.source === 'map' ? 'preview.map_fields' : 'preview.table_fields')}</p>
      <div className="overflow-x-auto"><table className="table table-sm w-full">
        <thead><tr><th scope="col">{t('preview.field_name')}</th><th scope="col">{t('preview.field_type')}</th></tr></thead>
        <tbody>{fields.items.map(field => <tr key={field.name}><th scope="row" className="font-normal break-all">{field.name}</th><td className="break-all">{field.type || t('preview.unknown')}</td></tr>)}</tbody>
      </table></div>
    </div>}
  </section>;
}
