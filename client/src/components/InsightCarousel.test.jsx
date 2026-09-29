import { describe, expect, test, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import InsightCarousel from './InsightCarousel.jsx';

// matchMedia is stubbed to matches:false in test setup, so perView resolves to 1
// and the page count equals the slide count - one dot per item.
const renderCarousel = (n, props = {}) => {
  const items = Array.from({ length: n }, (_, i) => ({ id: 'd' + i }));
  const renderSlide = vi.fn((it) => <div>slide {it.id}</div>);
  render(
    <InsightCarousel
      items={items}
      getId={(it) => it.id}
      renderSlide={renderSlide}
      ariaLabel="Featured"
      {...props}
    />
  );
  return { items, renderSlide };
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
