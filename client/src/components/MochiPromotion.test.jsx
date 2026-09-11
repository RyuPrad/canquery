import { StrictMode, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { LangProvider, useLang } from '../i18n.jsx';
import AnalyticsBridge from './AnalyticsBridge.jsx';
import MochiPromotion from './MochiPromotion.jsx';
import { PromotionTracking } from './PromotionTracking.jsx';

let observers;
beforeEach(() => {
  vi.useFakeTimers();
  observers = [];
  vi.stubGlobal('IntersectionObserver', class {
    constructor(callback) { this.callback = callback; this.active = true; observers.push(this); }
    observe(target) { this.target = target; }
    disconnect() { this.active = false; }
  });
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  window.umami = { track: vi.fn() };
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
  delete window.umami;
});

function Controls() {
  const navigate = useNavigate();
  const { setLang } = useLang();
  const [shown, setShown] = useState(true);
  return <>
    <button onClick={() => navigate('/places')}>Navigate</button>
    <button onClick={() => navigate('/places', { replace: true })}>Same URL</button>
    <button onClick={() => setLang('fr')}>French</button>
    <button onClick={() => setShown(value => !value)}>Toggle promotion</button>
    {shown && <MochiPromotion />}
    <MochiPromotion placement="footer" />
  </>;
}
function setup() {
  return render(<StrictMode><MemoryRouter><LangProvider><PromotionTracking>
    <AnalyticsBridge /><Controls />
  </PromotionTracking></LangProvider></MemoryRouter></StrictMode>);
}
function visibility(placement, ratio) {
  act(() => observers.filter(o => o.active && o.target?.dataset.promotionPlacement === placement)
    .forEach(o => o.callback([{ target: o.target, isIntersecting: ratio > 0, intersectionRatio: ratio }])));
}
const tick = time => act(() => { vi.advanceTimersByTime(time); });
const views = () => window.umami.track.mock.calls.filter(([name]) => name === 'promotion_view');

test('requires a continuous second at half visibility, then stops observing that placement', () => {
  setup();
  visibility('home_card', .49); tick(1200); expect(views()).toHaveLength(0);
  visibility('home_card', .5); tick(700);
  visibility('home_card', .1); tick(400); expect(views()).toHaveLength(0);
  visibility('home_card', .5); tick(999); expect(views()).toHaveLength(0);
  tick(1); expect(views()).toEqual([['promotion_view', { promotion: 'hello_mochi', placement: 'home_card', language: 'en' }]]);
  expect(observers.filter(o => o.active && o.target.dataset.promotionPlacement === 'home_card')).toHaveLength(0);
  visibility('home_card', 0); visibility('home_card', 1); tick(1500); expect(views()).toHaveLength(1);
});

test('counts placements independently and preserves counts through language and same-page remounts', () => {
  setup(); visibility('home_card', 1); visibility('footer', 1); tick(1000); expect(views()).toHaveLength(2);
  fireEvent.click(screen.getByText('French'));
  fireEvent.click(screen.getByText('Toggle promotion')); fireEvent.click(screen.getByText('Toggle promotion'));
  visibility('home_card', 1); tick(1000); expect(views()).toHaveLength(2);
  fireEvent.click(screen.getByText('Navigate'));
  visibility('home_card', 1); visibility('footer', 1); tick(1000); expect(views()).toHaveLength(4);
  expect(views().at(-1)[1].language).toBe('fr');
  fireEvent.click(screen.getByText('Same URL')); visibility('footer', 1); tick(1000); expect(views()).toHaveLength(4);
});

test('background tabs restart the qualifying interval when active again', () => {
  setup(); visibility('home_card', 1); tick(700);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(true);
  act(() => document.dispatchEvent(new Event('visibilitychange'))); tick(3000); expect(views()).toHaveLength(0);
  vi.spyOn(document, 'hidden', 'get').mockReturnValue(false);
  act(() => document.dispatchEvent(new Event('visibilitychange'))); tick(999); expect(views()).toHaveLength(0);
  tick(1); expect(views()).toHaveLength(1);
});

test('waits for a delayed tracker and cancels pending work on navigation and unmount', () => {
  delete window.umami;
  const { unmount } = setup(); visibility('home_card', 1); tick(1500);
  window.umami = { track: vi.fn() };
  act(() => window.dispatchEvent(new Event('canquery:analytics-ready')));
  tick(500); fireEvent.click(screen.getByText('Navigate')); tick(700); expect(views()).toHaveLength(0);
  visibility('home_card', 1); tick(1000); expect(views()).toHaveLength(1);
  visibility('footer', 1); tick(600); unmount(); tick(1000); expect(views()).toHaveLength(1);
  expect(observers.some(o => o.active)).toBe(false);
});

test.each([{ doNotTrack: '1' }, { globalPrivacyControl: true }])('browser opt-outs suppress promotion views and clicks: %j', signals => {
  vi.stubGlobal('navigator', signals);
  setup(); visibility('home_card', 1); tick(1500);
  fireEvent.click(screen.getByRole('link', { name: /Discover Hello Mochi/ }));
  expect(window.umami.track).not.toHaveBeenCalled();
  expect(observers).toHaveLength(0);
});

test('each link emits one outbound event with bounded promotion properties and preserves native navigation', () => {
  setup();
  const link = screen.getByRole('link', { name: /Discover Hello Mochi/ });
  expect(link).toHaveAttribute('href', 'https://hellomochi.app/');
  expect(link).toHaveAttribute('target', '_blank');
  expect(link.rel).toContain('noopener'); expect(link.rel).toContain('noreferrer');
  link.closest('aside').dataset.promotionSecret = 'DO-NOT-COLLECT';
  fireEvent.click(link.querySelector('svg'));
  expect(window.umami.track).toHaveBeenCalledTimes(1);
  expect(window.umami.track).toHaveBeenCalledWith('outbound_link', {
    host: 'hellomochi.app', path: '/', label: 'Discover Hello Mochi (opens in a new tab)',
    promotion: 'hello_mochi', placement: 'home_card', language: 'en',
  });
  fireEvent.click(screen.getByText('French'));
  const footer = document.querySelector('[data-promotion-placement="footer"] a');
  fireEvent.click(footer);
  expect(window.umami.track).toHaveBeenCalledTimes(2);
  expect(window.umami.track.mock.calls[1][1]).toMatchObject({ placement: 'footer', language: 'fr' });
  expect(screen.getAllByText('Application en anglais')).toHaveLength(2);
});

test('unavailable visibility detection and rejected analytics leave links and translation usable', async () => {
  vi.stubGlobal('IntersectionObserver', undefined);
  window.umami.track.mockImplementation(() => Promise.reject(new Error('blocked')));
  setup(); tick(1500); expect(views()).toHaveLength(0);
  fireEvent.click(screen.getByRole('link', { name: /Discover Hello Mochi/ }));
  await act(async () => {});
  fireEvent.click(screen.getByText('French'));
  expect(screen.getByRole('heading', { name: 'Gardez le lien avec les personnes qui comptent.' })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /Découvrir Hello Mochi/ })).toHaveAttribute('href', 'https://hellomochi.app/');
});
