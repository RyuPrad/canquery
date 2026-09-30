import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import InsightCarousel from './InsightCarousel.jsx';
import { LangProvider } from '../i18n.jsx';

// matchMedia is stubbed to matches:false in test setup, so perView resolves to 1
// and the page count equals the slide count - one dot per item.
const renderCarousel = (n, props = {}) => {
  const items = Array.from({ length: n }, (_, i) => ({ id: 'd' + i }));
  const renderSlide = vi.fn((it) => <div>slide {it.id}</div>);
  const view = render(
    <InsightCarousel
      items={items}
      getId={(it) => it.id}
      renderSlide={renderSlide}
      ariaLabel="Featured"
      {...props}
    />
  );
  return { items, renderSlide, ...view };
};

describe('InsightCarousel', () => {
  test('renders every slide (all live in the DOM, off-page ones translated)', () => {
    const { renderSlide } = renderCarousel(4);
    expect(renderSlide).toHaveBeenCalledTimes(4);
    expect(screen.getByText('slide d0')).toBeInTheDocument();
    expect(screen.getByText('slide d3')).toBeInTheDocument();
  });

  test('shows arrows and one dot per page when there are multiple pages', () => {
    renderCarousel(3);
    expect(screen.getByLabelText('Previous')).toBeInTheDocument();
    expect(screen.getByLabelText('Next')).toBeInTheDocument();
    expect(screen.getAllByLabelText(/Go to page/).length).toBe(3);
  });

  test('clicking next advances the active page', () => {
    renderCarousel(3);
    const dots = screen.getAllByLabelText(/Go to page/);
    expect(dots[0]).toHaveAttribute('aria-current', 'true');
    fireEvent.click(screen.getByLabelText('Next'));
    expect(dots[1]).toHaveAttribute('aria-current', 'true');
  });

  test('wraps from the first page back to the last', () => {
    renderCarousel(2);
    const dots = screen.getAllByLabelText(/Go to page/);
    fireEvent.click(screen.getByLabelText('Previous'));
    expect(dots[1]).toHaveAttribute('aria-current', 'true');
  });

  test('hides the controls when everything fits on one page', () => {
    renderCarousel(1);
    expect(screen.queryByLabelText('Next')).not.toBeInTheDocument();
    expect(screen.queryByLabelText(/Go to page/)).not.toBeInTheDocument();
  });

  test('pages to a deep-linked slide via focusId', () => {
    renderCarousel(4, { focusId: 'd2' });
    const dots = screen.getAllByLabelText(/Go to page/);
    expect(dots[2]).toHaveAttribute('aria-current', 'true');
  });

  test('off-screen slides are hidden from assistive technology and keyboard navigation', () => {
    renderCarousel(3);
    const firstPage = screen.getByText('slide d0').parentElement.parentElement;
    const secondPage = screen.getByText('slide d1').parentElement.parentElement;
    expect(firstPage).not.toHaveAttribute('inert');
    expect(secondPage).toHaveAttribute('inert');
    expect(secondPage).toHaveAttribute('aria-hidden', 'true');
    fireEvent.click(screen.getByLabelText('Next'));
    expect(firstPage).toHaveAttribute('inert');
    expect(secondPage).not.toHaveAttribute('inert');
    expect(secondPage).not.toHaveAttribute('aria-hidden', 'true');
  });

  test('keeps the carousel paused while keyboard focus remains inside after the pointer leaves', () => {
    vi.useFakeTimers();
    try {
      renderCarousel(3);
      const region = screen.getByRole('region', { name: 'Featured' });
      fireEvent.mouseEnter(region);
      fireEvent.focus(screen.getByLabelText('Next'));
      fireEvent.mouseLeave(region);
      act(() => vi.advanceTimersByTime(6500));
      expect(screen.getAllByLabelText(/Go to page/)[0]).toHaveAttribute('aria-current', 'true');
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('homepage showcase', () => {
  let width;
  let motion;
  let documentState;
  let motionListeners;

  beforeEach(() => {
    vi.useFakeTimers();
    localStorage.clear();
    width = 390;
    motion = false;
    documentState = 'visible';
    motionListeners = new Set();
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => documentState);
    vi.stubGlobal('IntersectionObserver', undefined);
    vi.stubGlobal('matchMedia', query => ({
      get matches() {
        if (query === '(prefers-reduced-motion: reduce)') return motion;
        if (query === '(min-width: 1024px)') return width >= 1024;
        if (query === '(min-width: 640px)') return width >= 640;
        return false;
      },
      media: query,
      addEventListener: (_event, listener) => { motionListeners.add(listener); },
      removeEventListener: (_event, listener) => { motionListeners.delete(listener); },
    }));
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  const start = (n = 9, props = {}) => renderCarousel(n, { showcase: true, ...props });
  const currentDot = () => screen.getAllByRole('button', { name: /Go to page/ }).find(button => button.hasAttribute('aria-current'));
  const advance = milliseconds => act(() => { vi.advanceTimersByTime(milliseconds); });
  const setDocument = state => act(() => {
    documentState = state;
    fireEvent(document, new Event('visibilitychange'));
  });
  const resize = nextWidth => act(() => {
    width = nextWidth;
    fireEvent(window, new Event('resize'));
  });
  const latestContext = (view, id) => [...view.renderSlide.mock.calls].reverse().find(([item]) => item.id === id)[2];

  function installObserver() {
    const observers = [];
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback, options) {
        this.callback = callback;
        this.options = options;
        this.disconnect = vi.fn();
        observers.push(this);
      }
      observe(element) { this.element = element; }
    });
    return observers;
  }

  function intersection(observer, ratio) {
    act(() => observer.callback([{ target: observer.element, isIntersecting: ratio > 0, intersectionRatio: ratio }]));
  }

  test.each([[390, 1], [768, 2], [1440, 3]])('a %ipx viewport groups %i visible cards per page', (viewport, expected) => {
    width = viewport;
    const view = start();
    const activeIds = view.items.filter(item => latestContext(view, item.id).active).map(item => item.id);
    expect(activeIds).toEqual(view.items.slice(0, expected).map(item => item.id));
    expect(latestContext(view, 'd0')).toEqual({ active: true, visible: true, reduced: false });
    expect(latestContext(view, 'd8').active).toBe(false);
  });

  test('footer controls bound the dot window, retain button focus and announce only manual navigation', () => {
    start();
    const next = screen.getByRole('button', { name: 'Next' });
    const region = screen.getByRole('region', { name: 'Featured' });
    const live = region.querySelector('[aria-live="polite"]');
    expect(next).toHaveClass('h-11', 'w-11');
    expect(next).not.toHaveClass('absolute');
    expect(live).toHaveTextContent('');
    expect(screen.getByText('Page 1 of 9')).toHaveAttribute('aria-live', 'off');
    expect(screen.getAllByRole('button', { name: /Go to page/ }).map(button => button.getAttribute('aria-label')))
      .toEqual(['Go to page 1', 'Go to page 2', 'Go to page 3', 'Go to page 4', 'Go to page 5']);
    act(() => next.focus());
    fireEvent.click(next);
    fireEvent.click(next);
    fireEvent.click(next);
    expect(next).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Next' })).toBe(next);
    expect(live).toHaveTextContent('Page 4 of 9');
    expect(screen.getAllByRole('button', { name: /Go to page/ }).map(button => button.getAttribute('aria-label')))
      .toEqual(['Go to page 2', 'Go to page 3', 'Go to page 4', 'Go to page 5', 'Go to page 6']);
    expect(screen.getAllByRole('button', { name: /Go to page/ }).every(button => button.classList.contains('w-11'))).toBe(true);
    fireEvent.blur(next, { relatedTarget: document.body });
    advance(6000);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 5');
    expect(live).toHaveTextContent('');
  });

  test('manual pause survives hover, focus and document visibility changes until explicitly resumed', () => {
    start(3);
    const region = screen.getByRole('region', { name: 'Featured' });
    const next = screen.getByRole('button', { name: 'Next' });
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Resume' })).not.toHaveAttribute('aria-pressed');
    fireEvent.mouseEnter(region);
    fireEvent.focus(next);
    fireEvent.mouseLeave(region);
    fireEvent.blur(next, { relatedTarget: document.body });
    setDocument('hidden');
    advance(60000);
    setDocument('visible');
    advance(12000);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 1');
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(vi.getTimerCount()).toBe(1);
    advance(5999);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 1');
    advance(1);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 2');
  });

  test('hover and focus pause independently and Resume does not bypass either gate', () => {
    start(3);
    const region = screen.getByRole('region', { name: 'Featured' });
    const next = screen.getByRole('button', { name: 'Next' });
    fireEvent.focus(next);
    fireEvent.mouseEnter(region);
    fireEvent.mouseLeave(region);
    advance(12000);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 1');
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(vi.getTimerCount()).toBe(0);
    fireEvent.mouseEnter(region);
    fireEvent.blur(next, { relatedTarget: document.body });
    advance(12000);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 1');
    fireEvent.mouseLeave(region);
    expect(vi.getTimerCount()).toBe(1);
    advance(6000);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 2');
  });

  test('hidden documents stop rotation and resume with a full interval and no catchup', () => {
    const view = start(3);
    advance(4000);
    setDocument('hidden');
    expect(latestContext(view, 'd0').visible).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    advance(60000);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 1');
    setDocument('visible');
    expect(latestContext(view, 'd0').visible).toBe(true);
    advance(5999);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 1');
    advance(1);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 2');
  });

  test('rotation and chart visibility require a quarter of the carousel in view', () => {
    const observers = installObserver();
    const view = start(3);
    const observer = observers[0];
    expect(observer.options).toEqual({ threshold: 0.25 });
    expect(latestContext(view, 'd0').visible).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
    intersection(observer, 0.24);
    advance(12000);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 1');
    intersection(observer, 0.25);
    expect(latestContext(view, 'd0').visible).toBe(true);
    expect(vi.getTimerCount()).toBe(1);
    advance(4000);
    intersection(observer, 0);
    expect(latestContext(view, 'd0').visible).toBe(false);
    advance(60000);
    intersection(observer, 0.5);
    advance(5999);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 1');
    advance(1);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 2');
    view.unmount();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  test('manual navigation restarts the interval even when choosing the current page', () => {
    start(3);
    advance(5000);
    fireEvent.click(screen.getByRole('button', { name: 'Go to page 1' }));
    advance(5999);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 1');
    advance(1);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 2');
    advance(5000);
    fireEvent.click(screen.getByRole('button', { name: 'Go to page 3' }));
    advance(5999);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 3');
    advance(1);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 1');
  });

  test('reduced motion stays static with manual navigation and no playback button', () => {
    motion = true;
    const view = start(3);
    expect(latestContext(view, 'd0').reduced).toBe(true);
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
    advance(60000);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 1');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 2');
    expect(latestContext(view, 'd1')).toEqual({ active: true, visible: true, reduced: true });
  });

  test('live reduced-motion changes stop rotation without clearing a manual pause', () => {
    const view = start(3);
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    act(() => {
      motion = true;
      motionListeners.forEach(listener => listener({ matches: true }));
    });
    expect(latestContext(view, 'd0').reduced).toBe(true);
    expect(screen.queryByRole('button', { name: 'Resume' })).not.toBeInTheDocument();
    act(() => {
      motion = false;
      motionListeners.forEach(listener => listener({ matches: false }));
    });
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('single-page and empty showcases expose no useless controls', () => {
    width = 1440;
    const view = start(3);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
    view.rerender(<InsightCarousel items={[]} getId={item => item.id} renderSlide={view.renderSlide} ariaLabel="Featured" showcase />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('inactive pages stay inert and hidden while manual controls remain focusable', () => {
    start(3);
    const first = screen.getByText('slide d0').parentElement.parentElement;
    const second = screen.getByText('slide d1').parentElement.parentElement;
    expect(first).not.toHaveAttribute('inert');
    expect(second).toHaveAttribute('inert');
    expect(second).toHaveAttribute('aria-hidden', 'true');
    const next = screen.getByRole('button', { name: 'Next' });
    act(() => next.focus());
    fireEvent.click(next);
    expect(first).toHaveAttribute('inert');
    expect(first).toHaveAttribute('aria-hidden', 'true');
    expect(second).not.toHaveAttribute('inert');
    expect(next).toHaveFocus();
  });

  test('responsive regrouping keeps the leading dataset visible', () => {
    width = 1440;
    const view = start(12);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(latestContext(view, 'd6').active).toBe(true);
    resize(768);
    expect(latestContext(view, 'd6').active).toBe(true);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 4');
    resize(390);
    expect(latestContext(view, 'd6').active).toBe(true);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 7');
  });

  test('data refresh follows a surviving visible dataset and clamps when none survives', () => {
    width = 1440;
    const view = start(9);
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    const refreshed = view.items.filter(item => item.id !== 'd3');
    view.rerender(<InsightCarousel items={refreshed} getId={item => item.id} renderSlide={view.renderSlide} ariaLabel="Featured" showcase />);
    expect(latestContext(view, 'd4').active).toBe(true);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 2');
    fireEvent.click(screen.getByRole('button', { name: 'Next' }));
    view.rerender(<InsightCarousel items={view.items.slice(0, 2)} getId={item => item.id} renderSlide={view.renderSlide} ariaLabel="Featured" showcase />);
    expect(latestContext(view, 'd0').active).toBe(true);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  test('data reorder retains the selected dataset and a manual pause', () => {
    const view = start(6);
    fireEvent.click(screen.getByRole('button', { name: 'Go to page 3' }));
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    const reordered = [view.items[2], ...view.items.filter(item => item.id !== 'd2')];
    view.rerender(<InsightCarousel items={reordered} getId={item => item.id} renderSlide={view.renderSlide} ariaLabel="Featured" showcase />);
    expect(latestContext(view, 'd2').active).toBe(true);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 1');
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument();
    expect(vi.getTimerCount()).toBe(0);
  });

  test('removing a focused dataset does not leave autoplay permanently suspended', () => {
    const renderLink = item => <a href={'#' + item.id}>{'Open ' + item.id}</a>;
    const view = start(6, { renderSlide: renderLink });
    const link = screen.getByRole('link', { name: 'Open d0' });
    act(() => link.focus());
    expect(link).toHaveFocus();
    advance(12000);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 1');
    view.rerender(<InsightCarousel items={view.items.slice(1)} getId={item => item.id} renderSlide={renderLink} ariaLabel="Featured" showcase />);
    expect(link).not.toBeInTheDocument();
    expect(document.body).toHaveFocus();
    advance(6000);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 2');
  });

  test('responsive regrouping clears a focus pause when the focused card remounts', () => {
    width = 1440;
    const renderLink = item => <a href={'#' + item.id}>{'Open ' + item.id}</a>;
    start(9, { renderSlide: renderLink });
    const link = screen.getByRole('link', { name: 'Open d2' });
    act(() => link.focus());
    advance(12000);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 1');
    resize(768);
    expect(link).not.toBeInTheDocument();
    expect(document.body).toHaveFocus();
    advance(6000);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 2');
  });

  test('a retained focused control still pauses autoplay after a data refresh', () => {
    const view = start(6);
    const next = screen.getByRole('button', { name: 'Next' });
    act(() => next.focus());
    view.rerender(<InsightCarousel items={view.items.slice(1)} getId={item => item.id} renderSlide={view.renderSlide} ariaLabel="Featured" showcase />);
    expect(next).toHaveFocus();
    expect(screen.getByRole('button', { name: 'Next' })).toBe(next);
    advance(12000);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 1');
    fireEvent.blur(next, { relatedTarget: document.body });
    advance(6000);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 2');
  });

  test('removing a focused playback control for reduced motion does not latch the focus pause', () => {
    start(3);
    const playback = screen.getByRole('button', { name: 'Pause' });
    act(() => playback.focus());
    advance(12000);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 1');
    act(() => {
      motion = true;
      motionListeners.forEach(listener => listener({ matches: true }));
    });
    expect(playback).not.toBeInTheDocument();
    expect(document.body).toHaveFocus();
    act(() => {
      motion = false;
      motionListeners.forEach(listener => listener({ matches: false }));
    });
    advance(6000);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 2');
  });

  test('French controls interpolate the current page and retain the resume action', () => {
    localStorage.setItem('cq-lang', 'fr');
    const items = Array.from({ length: 6 }, (_, i) => ({ id: 'd' + i }));
    render(<LangProvider><InsightCarousel items={items} getId={item => item.id} renderSlide={item => <div>{item.id}</div>} ariaLabel="Aperçus" showcase /></LangProvider>);
    expect(screen.getByText('Page 1 sur 6')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Suivant' }));
    expect(screen.getByText('Page 2 sur 6', { selector: '[aria-live="off"]' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pause' }));
    expect(screen.getByRole('button', { name: 'Reprendre' })).toBeInTheDocument();
  });

  test('the default gallery retains overlay controls and its existing hidden-tab autoplay', () => {
    installObserver();
    setDocument('hidden');
    renderCarousel(3);
    expect(screen.getByRole('button', { name: 'Next' })).toHaveClass('absolute');
    expect(screen.queryByRole('button', { name: 'Pause' })).not.toBeInTheDocument();
    expect(screen.queryByText(/Page .* of/)).not.toBeInTheDocument();
    advance(6000);
    expect(currentDot()).toHaveAttribute('aria-label', 'Go to page 2');
  });
});
