import { useEffect, useRef, useState } from 'react';
import { PlayIcon } from '../components/Icons.jsx';
import { useLang } from '../i18n.jsx';
import { track } from '../utils/analytics.js';
import CodeSample from '../components/docs/CodeSample.jsx';
import EndpointReference from '../components/docs/EndpointReference.jsx';
import CreditWorkflows from '../components/docs/CreditWorkflows.jsx';
import { createDocsSnippets, PERMITS_RESOURCE } from '../utils/docs/snippets.js';
import './DocsPage.css';

const SECTIONS = [
  ['quickstart', 'first'], ['workflow', 'workflow'], ['preparation-example', 'preparation_example'], ['capabilities', 'capabilities'],
  ['reference', 'reference'], ['reliability', 'reliability'],
];

function SectionHeading({ number, title, intro }) {
  return <header className="cq-doc-section-heading"><span className="cq-doc-section-number" aria-hidden="true">{number}</span><div><h2>{title}</h2><p>{intro}</p></div></header>;
}

function MetadataPreview() {
  const { t } = useLang();
  const [state, setState] = useState('idle');
  const [result, setResult] = useState(null);
  const controller = useRef(null);
  useEffect(() => () => { const pending = controller.current; controller.current = null; pending?.abort(); }, []);
  const run = async () => {
    if (controller.current) return;
    const request = new AbortController();
    controller.current = request;
    const timeout = setTimeout(() => request.abort(), 15000);
    setState('loading');
    track('docs_action', { action: 'run', endpoint: '/resources/:id', status: 'requested' });
    try {
      const response = await fetch(`/web-api/v1/resources/${PERMITS_RESOURCE}`, { signal: request.signal });
      if (!response.ok) throw new Error('metadata');
      const body = await response.json();
      if (request.signal.aborted) return;
      setResult(body);
      setState('done');
      track('docs_action', { action: 'run', endpoint: '/resources/:id', status: 'success' });
    } catch {
      if (controller.current !== request) return;
      setState('error');
      track('docs_action', { action: 'run', endpoint: '/resources/:id', status: 'failed' });
    } finally {
      clearTimeout(timeout);
      controller.current = null;
    }
  };
  return <div className="cq-doc-preview">
    <div className="cq-doc-preview-action"><button className="btn btn-outline min-h-11" type="button" disabled={state === 'loading'} onClick={run}><PlayIcon size={14} />{t(state === 'loading' ? 'docs.preview_loading' : 'docs.preview')}</button><p>{t('docs.preview_note')}</p></div>
    {state === 'error' && <p role="alert" className="cq-doc-preview-error">{t('docs.preview_error')}</p>}
    {result && <details className="cq-doc-preview-result" open><summary>{t('docs.preview_response')}</summary><pre tabIndex={0} aria-label={t('docs.preview_response')}><code>{JSON.stringify(result, null, 2)}</code></pre></details>}
  </div>;
}

export default function DocsPage() {
  const { t } = useLang();
  const base = window.location.origin;
  const snippets = createDocsSnippets(base);
  const [mobileContents, setMobileContents] = useState(false);
  const navigation = <>{SECTIONS.map(([id, key], index) => <a key={id} href={`#${id}`} onClick={() => setMobileContents(false)}><span aria-hidden="true">0{index + 1}</span>{t(`docs.nav_${key}`)}</a>)}</>;

  return <div className="cq-docs cq-fade">
    <header className="cq-doc-hero">
      <div className="cq-doc-eyebrow"><span aria-hidden="true" />{t('docs.eyebrow')}</div>
      <h1>{t('docs.title')}</h1>
      <p>{t('docs.intro')}</p>
      <div className="cq-doc-hero-actions"><a className="btn btn-primary min-h-12" href="/signup">{t('docs.key_cta')} <span aria-hidden="true">→</span></a><a className="cq-doc-secondary-link" href="/pricing">{t('docs.pricing_cta')} <span aria-hidden="true">↗</span></a></div>
    </header>
    <div className="cq-doc-mobile-nav"><button type="button" aria-expanded={mobileContents} aria-controls="docs-mobile-contents" onClick={() => setMobileContents(value => !value)}>{t('docs.contents')}<span aria-hidden="true">{mobileContents ? '−' : '+'}</span></button><nav id="docs-mobile-contents" aria-label={t('docs.contents')} hidden={!mobileContents}>{navigation}</nav></div>
    <div className="cq-doc-layout">
      <aside className="cq-doc-sidebar"><nav aria-label={t('docs.contents')}><p className="cq-doc-nav-label">{t('docs.contents')}</p>{navigation}</nav><div className="cq-doc-sidebar-bottom"><a href="/api/v1/openapi.json">{t('docs.openapi_cta')} <span aria-hidden="true">↗</span></a><p>{t('docs.sidebar_note')}</p></div></aside>
      <div className="cq-doc-main">
        <section id="quickstart" className="cq-doc-section">
          <SectionHeading number="01" title={t('docs.first_title')} intro={t('docs.first_intro')} />
          <ol className="cq-doc-steps">
            <li><span className="cq-doc-step-dot" aria-hidden="true">1</span><div><h3>{t('docs.first_account')}</h3><p>{t('docs.first_account_body')} <a href="/account">{t('account.api_keys')} →</a></p></div></li>
            <li><span className="cq-doc-step-dot" aria-hidden="true">2</span><div><h3>{t('docs.first_key')}</h3><p>{t('docs.first_key_body')}</p><CodeSample label={t('docs.setup_label')} code={'export CANQUERY_API_KEY=\'YOUR_API_KEY\''} /></div></li>
            <li><span className="cq-doc-step-dot" aria-hidden="true">3</span><div><h3>{t('docs.first_request')}</h3><p>{t('docs.first_request_body')}</p><CodeSample label={t('docs.search_label')} snippets={snippets.first} endpoint="/datasets" /></div></li>
          </ol>
          <div className="cq-doc-response-explainer"><h3>{t('docs.understand_title')}</h3><p>{t('docs.understand_body')}</p><dl>{[['data', 'data'], ['pagination.nextCursor', 'cursor'], ['meta', 'meta']].map(([name, key]) => <div key={name}><dt><code>{name}</code></dt><dd>{t(`docs.envelope_${key}`)}</dd></div>)}</dl></div>
          <p className="cq-doc-footnote">{t('docs.anonymous_note')}</p>
        </section>

        <section id="workflow" className="cq-doc-section">
          <SectionHeading number="02" title={t('docs.workflow_title')} intro={t('docs.workflow_intro')} />
          <div className="cq-doc-source-note"><a href="https://open.toronto.ca/dataset/building-permits-active-permits/" target="_blank" rel="noopener noreferrer">{t('docs.workflow_source')} ↗</a><p>{t('docs.workflow_scope')}</p></div>
          <div className="cq-doc-workflow-step"><h3><span aria-hidden="true">1.</span> {t('docs.workflow_find')}</h3><p>{t('docs.workflow_find_body')}</p><details className="cq-doc-recipe"><summary>{t('docs.workflow_discovery')}</summary><CodeSample label={t('docs.workflow_discovery')} snippets={snippets.discover} endpoint="/datasets" /></details><CodeSample label={t('docs.workflow_metadata')} snippets={snippets.metadata} endpoint="/resources/:id" /><MetadataPreview /></div>
          <div className="cq-doc-workflow-step"><h3><span aria-hidden="true">2.</span> {t('docs.workflow_query')}</h3><p>{t('docs.workflow_query_body')}</p><CodeSample label={t('docs.workflow_query_label')} snippets={snippets.rows} endpoint="/resources/:id/query" /><p className="cq-doc-footnote">{t('docs.workflow_fallback')} <a href="#preparation">{t('docs.prepare_title')} →</a></p></div>
          <div className="cq-doc-workflow-step"><h3><span aria-hidden="true">3.</span> {t('docs.workflow_export')}</h3><p>{t('docs.workflow_export_body')}</p><CodeSample label={t('docs.workflow_export_label')} code={snippets.export} endpoint="/resources/:id/query.csv" /></div>
        </section>

        <section id="preparation-example" className="cq-doc-section">
          <SectionHeading number="03" title={t('docs.cabin_title')} intro={t('docs.cabin_intro')} />
          <div className="cq-doc-source-note"><a href="https://open.canada.ca/data/en/dataset/13564ca4-e330-40a5-9521-bfb1be767147" target="_blank" rel="noopener noreferrer">{t('docs.cabin_source')} ↗</a><p>{t('docs.cabin_source_context')}</p><a href="https://cabin-rcba.ec.gc.ca/Cabin/opendata/cabin_benthic_data_mda09_1987-present.csv">{t('docs.cabin_download')}</a> · <a href="https://www.canada.ca/en/environment-climate-change/services/canadian-aquatic-biomonitoring-network/database.html">{t('docs.cabin_publisher_tools')}</a></div>
          <div className="cq-doc-workflow-step"><h3>{t('docs.cabin_inspect')}</h3><p>{t('docs.cabin_inspect_body')}</p><CodeSample label={t('docs.cabin_metadata_label')} snippets={snippets.cabinMetadata} endpoint="/resources/:id" /></div>
          <div className="cq-doc-workflow-step"><h3>{t('docs.cabin_prepare')}</h3><p>{t('docs.cabin_prepare_body')}</p><details className="cq-doc-recipe"><summary>{t('docs.cabin_admission_label')}</summary><CodeSample label={t('docs.cabin_admission_label')} snippets={snippets.cabinPrepare} endpoint="/resources/:id/prepare" /></details><details className="cq-doc-recipe"><summary>{t('docs.cabin_workflow_label')}</summary><CodeSample label={t('docs.cabin_workflow_label')} snippets={snippets.cabinWorkflow} endpoint="/resources/:id/prepare" /></details><p className="cq-doc-footnote">{t('docs.cabin_poll_note')}</p></div>
          <div className="cq-doc-workflow-step"><h3>{t('docs.cabin_query')}</h3><p>{t('docs.cabin_query_body')}</p><CodeSample label={t('docs.cabin_query_label')} snippets={snippets.cabinRows} endpoint="/resources/:id/query" />
            <div className="cq-doc-notice"><p>{t('docs.cabin_result')}</p><p>{t('docs.cabin_result_limit')}</p></div>
            <CodeSample label={t('docs.cabin_result_label')} code={JSON.stringify({ data: { total: 327, records: [{ _id: '7548', 'Year/Année': '2024', 'Family/Famille': 'Chironomidae' }, { _id: '7549', 'Year/Année': '2024', 'Family/Famille': 'Chironomidae' }] } }, null, 2)} />
          </div>
          <div className="cq-doc-workflow-step"><h3>{t('docs.cabin_reuse')}</h3><p>{t('docs.cabin_reuse_body')}</p><p className="cq-doc-footnote">{t('docs.cabin_dates')}</p></div>
          <CreditWorkflows />
        </section>

        <section id="capabilities" className="cq-doc-section">
          <SectionHeading number="04" title={t('docs.capabilities_title')} intro={t('docs.capabilities_intro')} />
          <div className="cq-doc-table-scroll" tabIndex={0} aria-label={t('docs.capabilities_title')}><table className="cq-doc-capabilities"><thead><tr><th>{t('docs.cap_mode')}</th><th>{t('docs.cap_available')}</th><th>{t('docs.cap_next')}</th></tr></thead><tbody>{[['ingested', 'ingested'], ['datastore', 'datastore'], ['ingestable', 'ingestable'], ['file-only', 'fileonly']].map(([mode, key]) => <tr key={mode}><td><code>{mode}</code></td><td>{t(`docs.cap_${key}`)}</td><td>{t(`docs.cap_${key}_next`)}</td></tr>)}</tbody></table></div>
          <div className="cq-doc-notice"><p>{t('docs.cap_maps')}</p></div>
        </section>

        <section id="reference" className="cq-doc-section">
          <SectionHeading number="05" title={t('docs.reference_title')} intro={t('docs.reference_intro')} />
          <EndpointReference base={base} />
        </section>

        <section id="reliability" className="cq-doc-section">
          <SectionHeading number="06" title={t('docs.reliability_title')} intro={t('docs.reliability_intro')} />
          <div className="cq-doc-reliability-section"><h3>{t('docs.pagination_title')}</h3><p>{t('docs.pagination_catalogue')}</p><p>{t('docs.pagination_rows')}</p></div>
          <div className="cq-doc-reliability-section"><h3>{t('docs.filters_title')}</h3><p>{t('docs.filters_body')}</p></div>
          <div id="preparation" className="cq-doc-reliability-section"><h3>{t('docs.prepare_title')}</h3><p>{t('docs.prepare_body')}</p><CodeSample label={t('docs.prepare_label')} code={snippets.prepare} endpoint="/resources/:id/prepare" /><p>{t('docs.prepare_steps')}</p><details className="cq-doc-recipe"><summary>{t('docs.job_label')}</summary><CodeSample label={t('docs.job_label')} code={snippets.job} endpoint="/jobs/:id" /></details><p className="cq-doc-footnote">{t('docs.prepare_limits')}</p></div>
          <div className="cq-doc-reliability-section"><h3>{t('docs.limits_title')}</h3><p>{t('docs.limits_body')}</p><p>{t('docs.limits_headers')}</p><p>{t('docs.retry_body')}</p><a className="cq-doc-secondary-link" href="/pricing">{t('docs.pricing_cta')} →</a></div>
          <div className="cq-doc-reliability-section"><h3>{t('docs.errors_title')}</h3><dl className="cq-doc-error-list">{[['400', '400'], ['401 / 403', '401'], ['409', '409'], ['422', '422'], ['429', '429'], ['502 / 503', '5xx']].map(([status, key]) => <div key={key}><dt><code>{status}</code></dt><dd>{t(`docs.error_${key}`)}</dd></div>)}</dl></div>
          <div className="cq-doc-reliability-section"><h3>{t('docs.freshness_title')}</h3><p>{t('docs.freshness_body')}</p><p>{t('docs.freshness_licence')}</p></div>
          <div className="cq-doc-support"><h3>{t('docs.support_title')}</h3><p>{t('docs.support_body')}</p><a href="mailto:support@canquery.com">support@canquery.com <span aria-hidden="true">↗</span></a></div>
        </section>
      </div>
    </div>
  </div>;
}
