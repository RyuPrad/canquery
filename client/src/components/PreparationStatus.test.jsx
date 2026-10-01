import { cleanup, render, screen } from '@testing-library/react';
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
