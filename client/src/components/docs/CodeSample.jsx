import { useState } from 'react';
import { CopyIcon, CheckIcon } from '../Icons.jsx';
import { useLang } from '../../i18n.jsx';
import { track } from '../../utils/analytics.js';

export default function CodeSample({ label, code, snippets, endpoint = 'quickstart' }) {
  const { t } = useLang();
  const [language, setLanguage] = useState('curl');
  const [copyState, setCopyState] = useState('idle');
  const languages = snippets ? Object.keys(snippets).filter(value => typeof snippets[value] === 'string') : [];
  const selectedLanguage = languages.includes(language) ? language : languages[0];
  const text = snippets ? snippets[selectedLanguage] : code;
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
      track('docs_action', { action: 'copy', endpoint, status: 'success' });
    } catch {
      setCopyState('failed');
      track('docs_action', { action: 'copy', endpoint, status: 'failed' });
    }
  };
  return <div className="cq-doc-code">
    <div className="cq-doc-code-toolbar">
      <span className="cq-doc-code-label">{label}</span>
      <button type="button" className="cq-doc-copy" onClick={copy} aria-label={t('docs.copy_named').replace('{label}', label)}>
        {copyState === 'copied' ? <CheckIcon size={15} /> : <CopyIcon size={15} />}
        <span>{copyState === 'copied' ? t('docs.copied') : t('docs.copy')}</span>
      </button>
    </div>
    {snippets && <div className="cq-doc-languages" role="group" aria-label={`${label} · ${t('docs.language')}`}>
      {languages.map(value => <button
        type="button" key={value} aria-pressed={selectedLanguage === value}
        onClick={() => { setLanguage(value); setCopyState('idle'); }}
      >{value === 'javascript' ? t('docs.code_javascript') : value === 'python' ? 'Python' : 'curl'}</button>)}
    </div>}
    <pre tabIndex={0} aria-label={`${label} · ${t('docs.example')}`}><code>{text}</code></pre>
    <div role="status" className={copyState === 'idle' ? 'sr-only' : 'cq-doc-copy-feedback'}>
      {copyState === 'failed' ? t('docs.copy_failed') : copyState === 'copied' ? t('docs.copied') : ''}
    </div>
  </div>;
}
