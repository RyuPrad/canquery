import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ instances: [], lang: 'en', dark: true, failInitialization: false }));

vi.mock('../i18n.jsx', () => ({
  useLang: () => ({ lang: state.lang, t: key => ({
    'map.live': state.lang === 'fr' ? 'Carte en direct' : 'Live map',
    'map.failed': 'Map failed', 'common.retry': 'Retry',
    'map.zoom_in_control': state.lang === 'fr' ? 'Zoom avant' : 'Zoom in',
    'map.zoom_out_control': state.lang === 'fr' ? 'Zoom arrière' : 'Zoom out',
    'map.close_popup': state.lang === 'fr' ? 'Fermer la fenêtre' : 'Close popup',
    'map.toggle_attribution': state.lang === 'fr' ? 'Afficher ou masquer les attributions' : 'Toggle attribution',
  }[key] || key) }),
}));
vi.mock('../theme.jsx', () => ({ useTheme: () => ({ dark: state.dark }) }));

vi.mock('maplibre-gl', () => {
  class MapLibreMap {
    constructor(options) {
      if (state.failInitialization) throw new Error('WebGL is unavailable');
      this.options = options;
      this.handlers = [];
      this.remove = vi.fn();
      this.setStyle = vi.fn();
      this.source = { setTiles: vi.fn() };
      this.canvas = document.createElement('canvas');
      this.container = document.createElement('div');
      state.instances.push(this);
    }
    addControl() {
      for (const name of ['zoom-in', 'zoom-out', 'attrib-button']) {
        const button = document.createElement('button');
        button.className = 'maplibregl-ctrl-' + name;
        this.container.append(button);
      }
    }
    on(...args) { this.handlers.push(args); }
    getBounds() {
      return { getWest: () => -114.2, getSouth: () => 50.9, getEast: () => -113.9, getNorth: () => 51.2 };
    }
    getZoom() { return 9; }
    getCanvas() { return this.canvas; }
    getContainer() { return this.container; }
    getSource() { return this.source; }
  }
  class NavigationControl {}
  class Popup {
    setLngLat() { return this; }
    setDOMContent() { return this; }
    addTo() { return this; }
  }
  return { Map: MapLibreMap, NavigationControl, Popup, setWorkerUrl: vi.fn() };
});
vi.mock('maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url', () => ({ default: '/assets/maplibre-worker-audit.js' }));

import PmtilesMapPanel from './PmtilesMapPanel.jsx';
import { setWorkerUrl } from 'maplibre-gl';

const mapInfo = {
  provider: 'pmtiles', geometry_type: 'point',
  extent: [-114.2, 50.9, -113.9, 51.2],
  fields: [{ name: 'station', alias: 'Station' }],
  min_zoom: 0, max_zoom: 16, layer: 'features',
  tiles: '/api/v1/resources/r1/map/tiles/version/{z}/{x}/{y}.pbf',
};

describe('PMTiles MapLibre panel', () => {
  beforeEach(() => {
    state.instances.length = 0;
    state.lang = 'en';
    state.dark = true;
    state.failInitialization = false;
  });

  test('uses the same-origin immutable vector template without exposing object storage', async () => {
    expect(setWorkerUrl).toHaveBeenCalledWith('/assets/maplibre-worker-audit.js');
    const view = render(<PmtilesMapPanel resourceId="r1" map={mapInfo} />);
    expect(screen.getByText('Live map')).toBeInTheDocument();
    await waitFor(() => expect(state.instances).toHaveLength(1));
    const source = state.instances[0].options.style.sources.canquery;
    expect(source.tiles).toEqual([mapInfo.tiles]);
    expect(JSON.stringify(state.instances[0].options.style)).not.toContain('r2.cloudflarestorage.com');
    expect(state.instances[0].options.style.layers.map(layer => layer.id)).toEqual(expect.arrayContaining([
      'cq-polygons', 'cq-lines', 'cq-points'
    ]));
    view.unmount();
    expect(state.instances[0].remove).toHaveBeenCalled();
  });

  test('keeps the viewport and map instance when language and theme change', () => {
    const view = render(<PmtilesMapPanel resourceId="r1" map={mapInfo} />);
    const map = state.instances[0];
    state.lang = 'fr';
    state.dark = false;
    view.rerender(<PmtilesMapPanel resourceId="r1" map={mapInfo} />);
    expect(state.instances).toHaveLength(1);
    expect(map.remove).not.toHaveBeenCalled();
    const style = map.setStyle.mock.calls.at(-1)[0];
    expect(style.sources.labels.tiles[0]).toContain('CBCT_TXT_3857');
    expect(style.layers.find(layer => layer.id === 'cq-lines').paint['line-color']).toBe('#087f73');
    expect(map.canvas).toHaveAttribute('aria-label', 'Carte en direct');
    expect(map.container.querySelector('.maplibregl-ctrl-zoom-in')).toHaveAttribute('aria-label', 'Zoom avant');
    expect(map.container.querySelector('.maplibregl-ctrl-zoom-out')).toHaveAttribute('aria-label', 'Zoom arrière');
    expect(map.container.querySelector('.maplibregl-ctrl-attrib-button')).toHaveAttribute('aria-label', 'Afficher ou masquer les attributions');
  });

  test('respects archives whose maximum zoom is zero', () => {
    render(<PmtilesMapPanel resourceId="r1" map={{ ...mapInfo, min_zoom: 0, max_zoom: 0 }} />);
    expect(state.instances[0].options.maxZoom).toBe(0);
    expect(state.instances[0].options.minZoom).toBe(0);
    expect(state.instances[0].options.fitBoundsOptions.maxZoom).toBe(0);
  });

  test('clears a tile failure notice only after every failed tile recovers', () => {
    render(<PmtilesMapPanel resourceId="r1" map={mapInfo} />);
    const map = state.instances[0];
    const emit = (name, event) => map.handlers.filter(handler => handler[0] === name && handler.length === 2)
      .forEach(handler => handler[1](event));
    act(() => emit('error', { sourceId: 'canquery', error: new Error('Temporary tile failure'), tile: { tileID: { key: 'A' } } }));
    act(() => emit('error', { sourceId: 'canquery', error: new Error('Another tile failure'), tile: { tileID: { key: 'B' } } }));
    expect(screen.getByText('Map failed')).toBeInTheDocument();
    act(() => emit('sourcedata', { sourceId: 'geometry', isSourceLoaded: true }));
    expect(screen.getByText('Map failed')).toBeInTheDocument();
    act(() => emit('sourcedata', { sourceId: 'canquery', isSourceLoaded: true, tile: { state: 'errored' } }));
    expect(screen.getByText('Map failed')).toBeInTheDocument();
    act(() => emit('sourcedata', { sourceId: 'canquery', tile: { state: 'loaded', tileID: { key: 'C' } } }));
    expect(screen.getByText('Map failed')).toBeInTheDocument();
    act(() => emit('sourcedata', { sourceId: 'canquery', tile: { state: 'loaded', tileID: { key: 'A' } } }));
    expect(screen.getByText('Map failed')).toBeInTheDocument();
    act(() => emit('sourcedata', { sourceId: 'canquery', tile: { state: 'loaded', tileID: { key: 'B' } } }));
    expect(screen.queryByText('Map failed')).not.toBeInTheDocument();
  });

  test('retains failures without a tile identity until an explicit retry', () => {
    render(<PmtilesMapPanel resourceId="r1" map={mapInfo} />);
    const map = state.instances[0];
    const emit = (name, event) => map.handlers.filter(handler => handler[0] === name && handler.length === 2)
      .forEach(handler => handler[1](event));
    act(() => emit('error', { error: new Error('Renderer failure') }));
    act(() => emit('sourcedata', { sourceId: 'canquery', tile: { state: 'loaded', tileID: { key: 'A' } } }));
    expect(screen.getByRole('alert')).toHaveTextContent('Map failed');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('shows a recoverable map error when WebGL initialization fails', () => {
    state.failInitialization = true;
    expect(() => render(<PmtilesMapPanel resourceId="r1" map={mapInfo} />)).not.toThrow();
    expect(screen.getByRole('alert')).toHaveTextContent('Map failed');
    state.failInitialization = false;
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(state.instances).toHaveLength(1);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('retries failed tiles using the current source without resetting the viewport', () => {
    render(<PmtilesMapPanel resourceId="r1" map={mapInfo} />);
    const map = state.instances[0];
    act(() => map.handlers.find(handler => handler[0] === 'error')[1]({ sourceId: 'canquery', error: new Error('Tile failed') }));
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(map.source.setTiles).toHaveBeenCalledWith([mapInfo.tiles]);
    expect(state.instances).toHaveLength(1);
  });
});
