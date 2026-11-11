import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, expect, test } from 'vitest';
import DatasetHubLink from './DatasetHubLink.jsx';
import { LangProvider } from '../i18n.jsx';
import { datasetHub, hubHasData } from '../utils/datasetHubs.js';

const LMIA = '90fed587-1364-4f33-a9ee-208181dc0b97';
const OAS = 'dfa4daf1-669e-4514-82cd-982f27707ed0';
// What the server puts in the head when a hub has data.
function mark(content) {
  const meta = document.createElement('meta');
  meta.name = 'cq-hubs';
  meta.content = content;
  document.head.appendChild(meta);
}
const show = (datasetId) => render(<LangProvider><MemoryRouter><DatasetHubLink datasetId={datasetId} /></MemoryRouter></LangProvider>);

afterEach(() => {
  document.querySelector('meta[name="cq-hubs"]')?.remove();
  localStorage.clear();
});

test('the LMIA dataset and its files link to the employer search; other datasets do not', () => {
  const { container, unmount } = show(LMIA);
  expect(screen.getByRole('link', { name: 'Search positive LMIA employers' })).toHaveAttribute('href', '/lmia');
  expect(screen.getByText('Search this list across every quarter since 2014, by employer, province or occupation.')).toBeInTheDocument();
  unmount();
  expect(show('something-else').container).toBeEmptyDOMElement();
  expect(container).toBeEmptyDOMElement();
  expect(show(undefined).container).toBeEmptyDOMElement();
  expect(show('constructor').container).toBeEmptyDOMElement();
});

test('the OAS benefit amounts dataset links to its lookup only on a site whose server has the tables', () => {
  expect(hubHasData('oas')).toBe(false);
  expect(datasetHub(OAS)).toBeNull();
  expect(show(OAS).container).toBeEmptyDOMElement();
  mark('oas');
  expect(hubHasData('oas')).toBe(true);
  show(OAS);
  expect(screen.getByRole('link', { name: 'Look up an amount' })).toHaveAttribute('href', '/oas');
  expect(screen.getByText('Find the monthly amount for a yearly income in these tables.')).toBeInTheDocument();
});

test('the callout leads to the page in the interface’s language', () => {
  mark('lmia-future oas');
  localStorage.setItem('cq-lang', 'fr');
  show(OAS);
  expect(screen.getByRole('link', { name: 'Trouver un montant' })).toHaveAttribute('href', '/fr/sv');
  expect(hubHasData('lmia')).toBe(false);
});
