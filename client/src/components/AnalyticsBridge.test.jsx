import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import AnalyticsBridge from './AnalyticsBridge.jsx';

afterEach(() => {
  delete window.umami;
});

test('turns marked interactions into bounded semantic events', () => {
  window.umami = { track: vi.fn() };
  render(<><AnalyticsBridge /><button data-analytics-event="resource_view" data-analytics-resource-id="r1" data-analytics-view="chart">Chart</button></>);
  fireEvent.click(screen.getByRole('button', { name: 'Chart' }));
  expect(window.umami.track).toHaveBeenCalledWith('resource_view', {
    resource_id: 'r1',
    view: 'chart',
  });
});

test('tracks outbound destinations without leaking their query string', () => {
  window.umami = { track: vi.fn() };
  render(<><AnalyticsBridge /><a href="https://example.com/file.csv?token=secret">Download</a></>);
  fireEvent.click(screen.getByRole('link', { name: 'Download' }));
  expect(window.umami.track).toHaveBeenCalledWith('outbound_link', {
    host: 'example.com',
    path: '/file.csv',
    label: 'Download',
  });
});
