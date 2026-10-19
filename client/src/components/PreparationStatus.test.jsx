import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, test, vi } from 'vitest';
import { LangProvider, STRINGS } from '../i18n.jsx';
import PreparationStatus from './PreparationStatus.jsx';

afterEach(() => { cleanup(); localStorage.clear(); });
const reasons = ['invalid_file', 'upstream_unavailable', 'capacity', 'temporary'];
describe.each(['en', 'fr'])('preparation failure messages in %s', lang => {
  test.each(reasons)('explains %s and includes the retry date and time', reason => {
    localStorage.setItem('cq-lang', lang);
    const retryAt = new Date('2026-10-02T16:30:00Z').getTime();
    render(<LangProvider><PreparationStatus preparation={{ phase: 'failed', supported: true,
      enabled: true, failureReason: reason, retryAt, retry: vi.fn(), working: false }} /></LangProvider>);
    expect(screen.getByRole('status')).toHaveTextContent(STRINGS[lang]['preparation.failure.' + reason]);
    expect(screen.getByText(new RegExp(STRINGS[lang]['preparation.retry_at']))).toHaveTextContent(
      new Date(retryAt).toLocaleString(lang === 'fr' ? 'fr-CA' : 'en-CA'));
    expect(screen.queryByText(STRINGS[lang]['preparation.automatic'])).not.toBeInTheDocument();
  });
});
test('unknown reasons use the generic message without disclosing their value', () => {
  render(<PreparationStatus preparation={{ phase: 'failed', supported: true, enabled: true,
    failureReason: 'private.host.example SQL', retry: vi.fn(), working: false }} />);
  expect(screen.getByRole('status')).toHaveTextContent(STRINGS.en['preparation.failed']);
  expect(screen.getByRole('status')).not.toHaveTextContent('private.host');
  expect(screen.getByRole('button')).toBeEnabled();
});

describe('preparation progress', () => {
  const running = { phase: 'running', supported: true, enabled: true, failureReason: null, retryAt: null, retry: vi.fn(), working: true };
  test('shows the download against the file length, then rows, then finishing', () => {
    const view = render(<PreparationStatus preparation={running} elapsed="0:12" progress={{ phase: 'downloading', bytes: 52428800, content_length: 111600495 }} />);
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', String(52428800 / 111600495));
    expect(screen.getByText('Downloading 52.4 MB of 111.6 MB')).toBeInTheDocument();
    view.rerender(<PreparationStatus preparation={running} elapsed="0:20" progress={{ phase: 'downloading', bytes: 2048, content_length: null }} />);
    expect(screen.getByText('Downloaded 2.0 KB')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).not.toHaveAttribute('value');
    view.rerender(<PreparationStatus preparation={running} elapsed="0:40" progress={{ phase: 'loading', rows: 250000 }} />);
    expect(screen.getByText('Loading rows: 250,000')).toBeInTheDocument();
    view.rerender(<PreparationStatus preparation={running} elapsed="0:55" progress={{ phase: 'finishing', rows: 645327 }} />);
    expect(screen.getByText('Finishing the table…')).toBeInTheDocument();
    expect(screen.getByRole('progressbar')).toHaveAttribute('value', '1');
    view.rerender(<PreparationStatus preparation={running} elapsed="0:55" progress={{ phase: 'other' }} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
  test('is bilingual and hidden once the job is not working', () => {
    localStorage.setItem('cq-lang', 'fr');
    render(<LangProvider><PreparationStatus preparation={running} elapsed="0:12" progress={{ phase: 'downloading', bytes: 52428800, content_length: 111600495 }} /></LangProvider>);
    expect(screen.getByText('Téléchargement : 52,4 Mo sur 111,6 Mo')).toBeInTheDocument();
    cleanup();
    render(<PreparationStatus preparation={{ ...running, phase: 'failed', working: false }} progress={{ phase: 'loading', rows: 5 }} />);
    expect(screen.queryByRole('progressbar')).toBeNull();
  });
});

describe.each(['en', 'fr'])('before anybody uses the page, in %s', lang => {
  const standby = { phase: 'idle', supported: true, enabled: true, failureReason: null, retryAt: null,
    retry: vi.fn(), working: false, awaitingVisitor: true };
  test('says the table is not loaded and offers to load it', async () => {
    localStorage.setItem('cq-lang', lang);
    const start = vi.fn();
    render(<LangProvider><PreparationStatus preparation={{ ...standby, start }} /></LangProvider>);
    expect(screen.getByRole('status')).toHaveTextContent(STRINGS[lang]['preparation.standby']);
    expect(screen.getByRole('status')).not.toHaveTextContent(STRINGS[lang]['preparation.pending']);
    expect(screen.getByText(STRINGS[lang]['preparation.automatic'])).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: STRINGS[lang]['preparation.start'] }));
    expect(start).toHaveBeenCalledTimes(1);
  });
  test('a failure or an unavailable file never offers the button', () => {
    localStorage.setItem('cq-lang', lang);
    const view = render(<LangProvider><PreparationStatus preparation={{ ...standby, phase: 'failed', start: vi.fn() }} /></LangProvider>);
    expect(screen.queryByRole('button', { name: STRINGS[lang]['preparation.start'] })).toBeNull();
    view.rerender(<LangProvider><PreparationStatus preparation={{ ...standby, supported: false, start: vi.fn() }} /></LangProvider>);
    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByRole('status')).toHaveTextContent(STRINGS[lang]['preparation.unavailable']);
  });
});
