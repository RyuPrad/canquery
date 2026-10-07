import { useEffect, useMemo, useState } from 'react';
import { useLang } from '../../i18n.jsx';
import CodeSample from './CodeSample.jsx';

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head'];
const pointer = (document, value) => {
  if (!value?.$ref?.startsWith('#/')) return value || {};
  return value.$ref.slice(2).split('/').reduce((node, key) => node?.[key.replaceAll('~1', '/').replaceAll('~0', '~')], document) || {};
};
const local = (value, field, lang) => lang === 'fr' && value?.[`x-${field}-fr`] ? value[`x-${field}-fr`] : value?.[field] || '';
const typeName = (schema, document) => {
  const value = pointer(document, schema);
  if (value.oneOf || value.anyOf) return (value.oneOf || value.anyOf).map(item => typeName(item, document)).join(' | ');
  if (value.type === 'array') return `${typeName(value.items || {}, document)}[]`;
  return [Array.isArray(value.type) ? value.type.join(' | ') : value.type || (value.properties ? 'object' : '—'), value.format].filter(Boolean).join(' · ');
};
const shellQuote = value => "'" + String(value).replaceAll("'", "'\\''") + "'";

// Nullable object/array branches carry their fields behind anyOf in OpenAPI 3.1.
// Unwrap only a single non-null branch, and cap both resolution and rendered depth.
const structure = (document, definition) => {
  let value = pointer(document, definition);
  for (let step = 0; step < 4; step += 1) {
    const alternatives = value.anyOf || value.oneOf;
    if (!alternatives) break;
    const choices = alternatives.map(item => pointer(document, item)).filter(item => item.type !== 'null');
    if (choices.length !== 1) break;
    value = { ...value, ...choices[0] };
    delete value.anyOf;
    delete value.oneOf;
  }
  return value;
};

function SchemaFields({ value, document, depth = 0 }) {
  const { t, lang } = useLang();
  const schema = structure(document, value);
  const properties = { ...Object.assign({}, ...(schema.allOf || []).map(item => pointer(document, item).properties || {})), ...schema.properties };
  if (!Object.keys(properties).length) return <code className="cq-doc-schema-type">{typeName(schema, document)}</code>;
  return <div className="cq-doc-table-scroll" tabIndex={0} aria-label={t('docs.reference_schema')}>
    <table className="cq-doc-schema-table"><thead><tr>
      <th>{t('docs.reference_field')}</th><th>{t('docs.reference_type')}</th><th>{t('docs.reference_details')}</th>
    </tr></thead><tbody>{Object.entries(properties).map(([name, definition]) => {
      const field = structure(document, definition);
      const nested = field.type === 'array' ? structure(document, field.items) : field;
      return <tr key={name}><td><code>{name}</code>{schema.required?.includes(name) && <span className="cq-doc-required">{t('docs.reference_required')}</span>}</td>
        <td><code>{typeName(definition, document)}</code></td>
        <td>{local(field, 'description', lang)}{field.enum && <p><code>{field.enum.map(String).join(' | ')}</code></p>}
          {depth < 3 && (nested.properties || nested.allOf) && <details className="cq-doc-nested"><summary>{t('docs.reference_schema')}</summary><SchemaFields value={nested} document={document} depth={depth + 1} /></details>}
        </td></tr>;
    })}</tbody></table>
  </div>;
}

function ResponseExamples({ content, endpoint }) {
  const { t, lang } = useLang();
  const examples = content.example !== undefined ? [['default', { value: content.example }]] : Object.entries(content.examples || {});
  const [selected, setSelected] = useState(examples[0]?.[0]);
  const [name, definition] = examples.find(([key]) => key === selected) || examples[0] || [];
  if (!definition || definition.value === undefined) return null;
  return <div className="cq-doc-response-example">
    {examples.length > 1 && <div className="cq-doc-languages" role="group" aria-label={t('docs.reference_example')}>
      {examples.map(([key, value]) => <button key={key} type="button" aria-pressed={name === key} onClick={() => setSelected(key)}>{local(value, 'summary', lang) || key}</button>)}
    </div>}
    <CodeSample label={t('docs.reference_example')} code={typeof definition.value === 'string' ? definition.value : JSON.stringify(definition.value, null, 2)} endpoint={endpoint} />
  </div>;
}

function Parameter({ parameter, document }) {
  const { t, lang } = useLang();
  const schema = pointer(document, parameter.schema);
  const bounds = [['default', 'default'], ['minimum', 'minimum'], ['maximum', 'maximum'], ['maxLength', 'length']]
    .filter(([key]) => schema[key] !== undefined);
  return <div className="cq-doc-parameter">
    <div className="cq-doc-parameter-heading"><code>{parameter.name}</code><span>{parameter.in} · {typeName(schema, document)}</span><span className={parameter.required ? 'cq-doc-required' : ''}>{t(parameter.required ? 'docs.reference_required' : 'docs.reference_optional')}</span></div>
    {local(parameter, 'description', lang) && <p>{local(parameter, 'description', lang)}</p>}
    {(bounds.length > 0 || schema.enum) && <div className="cq-doc-parameter-bounds">
      {bounds.map(([key, label]) => <span key={key}>{t(`docs.reference_${label}`)}: <code>{String(schema[key])}</code></span>)}
      {schema.enum && <span>{t('docs.reference_values')}: <code>{schema.enum.map(String).join(' · ')}</code></span>}
    </div>}
  </div>;
}

function Operation({ document, path, method, operation, inheritedParameters, base }) {
  const { t, lang } = useLang();
  const parameters = [...inheritedParameters, ...(operation.parameters || [])].map(value => pointer(document, value));
  const id = operation.operationId || `${method}-${path.replace(/[^a-z\d]+/gi, '-')}`;
  const [expanded, setExpanded] = useState(() => window.location.hash.slice(1) === id);
  const security = operation.security ?? document.security;
  const publicEndpoint = Array.isArray(security) && (!security.length || security.every(item => !Object.keys(item).length));
  const serverUrl = new URL(operation.servers?.[0]?.url || document.servers?.[0]?.url || '/api/v1', base);
  const requestUrl = `${serverUrl.href.replace(/\/$/, '')}/${path.replace(/^\/+/, '')}`;
  const example = `curl --fail-with-body --silent --show-error${method === 'get' ? '' : ` --request ${method.toUpperCase()}`} \\\n  ${shellQuote(requestUrl)}${publicEndpoint ? '' : ' \\\n  --header "Authorization: Bearer $CANQUERY_API_KEY"'}`;
  const credit = lang === 'fr' && operation['x-credit-cost-fr'] !== undefined ? operation['x-credit-cost-fr'] : operation['x-credit-cost'] ?? operation['x-credits'];
  return <details id={id} className="cq-doc-operation" open={expanded} onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary><span className={`cq-method cq-method-${method === 'get' ? 'get' : 'post'}`}>{method.toUpperCase()}</span><span className="cq-doc-operation-name"><code>{path}</code><span>{local(operation, 'summary', lang)}</span></span><span aria-hidden="true" className="cq-doc-expand">+</span></summary>
    {expanded && <div className="cq-doc-operation-body">
      <div className="cq-doc-operation-meta">{credit !== undefined && <span>{t('docs.reference_credits')}: <strong>{typeof credit === 'object' ? JSON.stringify(credit) : String(credit)}</strong></span>}<a href={`#${id}`}>{t('docs.reference_link')}</a></div>
      <p>{local(operation, 'description', lang)}</p>
      <p className="cq-doc-muted">{t(publicEndpoint ? 'docs.reference_public' : 'docs.reference_auth')}</p>
      <p>{t('docs.reference_placeholders')}</p>
      <CodeSample label={t('docs.reference_request')} code={example} endpoint={path} />
      <h4>{t('docs.reference_parameters')}</h4>
      {parameters.length ? <div className="cq-doc-parameters">{parameters.map(parameter => <Parameter key={`${parameter.in}:${parameter.name}`} parameter={parameter} document={document} />)}</div> : <p>{t('docs.reference_no_parameters')}</p>}
      <h4>{t('docs.reference_responses')}</h4>
      <div className="cq-doc-responses">{Object.entries(operation.responses || {}).map(([status, raw]) => {
        const response = pointer(document, raw);
        return <details key={status} className="cq-doc-response"><summary><code>{status}</code><span>{local(response, 'description', lang)}</span></summary><div className="cq-doc-response-body">
          {Object.entries(response.content || {}).map(([mime, content]) => <div key={mime} className="cq-doc-content-schema">
            <code className="cq-doc-mime">{mime}</code>
            <ResponseExamples content={content} endpoint={path} />
            {content.schema && <details className="cq-doc-recipe"><summary>{t('docs.reference_schema')}</summary><SchemaFields value={content.schema} document={document} /></details>}
          </div>)}
          {Object.keys(response.headers || {}).length > 0 && <details className="cq-doc-recipe"><summary>{t('docs.reference_headers')}</summary><dl className="cq-doc-headers">{Object.entries(response.headers).map(([name, rawHeader]) => {
            const header = pointer(document, rawHeader);
            return <div key={name}><dt><code>{name}</code></dt><dd>{local(header, 'description', lang)}</dd></div>;
          })}</dl></details>}

        </div></details>;
      })}</div>
    </div>}
  </details>;
}

export default function EndpointReference({ base }) {
  const { t, lang } = useLang();
  const [document, setDocument] = useState(null);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState('');
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setFailed(false);
    const timeout = setTimeout(() => controller.abort(), 15000);
    fetch('/api/v1/openapi.json', { signal: controller.signal })
      .then(response => { if (!response.ok) throw new Error('openapi'); return response.json(); })
      .then(value => { if (!value?.openapi?.startsWith('3.') || !value.paths || typeof value.paths !== 'object') throw new Error('openapi'); if (active) setDocument(value); })
      .catch(() => { if (active) setFailed(true); })
      .finally(() => clearTimeout(timeout));
    return () => { active = false; controller.abort(); clearTimeout(timeout); };
  }, [attempt]);
  useEffect(() => {
    const reveal = () => {
      let id;
      try { id = decodeURIComponent(window.location.hash.slice(1)); } catch { return; }
      const target = window.document.getElementById(id);
      if (target?.classList.contains('cq-doc-operation')) {
        target.open = true;
        target.scrollIntoView?.({ block: 'start' });
      }
    };
    if (document) reveal();
    window.addEventListener('hashchange', reveal);
    return () => window.removeEventListener('hashchange', reveal);
  }, [document]);
  const operations = useMemo(() => Object.entries(document?.paths || {}).flatMap(([path, value]) => METHODS.filter(method => value[method]).map(method => ({ path, method, operation: value[method], inheritedParameters: value.parameters || [] }))), [document]);
  const filtered = operations.filter(({ path, operation }) => `${path} ${local(operation, 'summary', lang)} ${local(operation, 'description', lang)} ${(operation.tags || []).join(' ')} ${(operation.parameters || []).map(value => pointer(document, value).name).join(' ')}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase()));
  const tags = [...new Set([...(document?.tags || []).map(tag => tag.name), ...operations.flatMap(({ operation }) => operation.tags || ['API'])])];
  return <>
    <div className="cq-doc-reference-tools"><div className="cq-doc-reference-search"><label htmlFor="endpoint-search">{t('docs.reference_search')}</label><input id="endpoint-search" className="input input-bordered w-full" type="search" placeholder={t('docs.reference_placeholder')} value={search} onChange={event => setSearch(event.target.value)} /></div><a className="cq-doc-secondary-link" href="/api/v1/openapi.json">{t('docs.openapi_cta')} ↗</a></div>
    {failed ? <div className="cq-doc-notice" role="alert"><p>{t('docs.reference_error')}</p><button className="btn btn-outline min-h-11" onClick={() => setAttempt(value => value + 1)}>{t('docs.retry')}</button></div> : !document ? <div className="cq-doc-reference-loading" role="status">{t('docs.reference_loading')}</div> : <>
      <p className="cq-doc-results" role="status">{t(filtered.length === 1 ? 'docs.reference_count_one' : 'docs.reference_count').replace('{count}', String(filtered.length))}</p>
      {!filtered.length && <div className="cq-doc-notice"><p>{t('docs.reference_empty')}</p><button className="btn btn-ghost min-h-11" onClick={() => setSearch('')}>{t('docs.reference_clear')}</button></div>}
      {tags.map(tag => {
        const items = filtered.filter(({ operation }) => (operation.tags?.[0] || 'API') === tag);
        const definition = document.tags?.find(value => value.name === tag);
        return items.length > 0 && <div className="cq-doc-endpoint-group" key={tag}><h3>{lang === 'fr' ? definition?.['x-display-name-fr'] || definition?.['x-name-fr'] || tag : tag}</h3>{items.map(item => <Operation key={`${item.method}:${item.path}`} {...item} document={document} base={base} />)}</div>;
      })}
    </>}
  </>;
}
