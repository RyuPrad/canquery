import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ instances: [] }));

vi.mock('maplibre-gl', () => {
  class MapLibreMap {
    constructor(options) {
      this.options = options;
      this.handlers = [];
      this.remove = vi.fn();
      state.instances.push(this);
    }
    addControl() {}
    on(...args) { this.handlers.push(args); }
    getBounds() {
      return { getWest: () => -114.2, getSouth: () => 50.9, getEast: () => -113.9, getNorth: () => 51.2 };
    }
    getZoom() { return 9; }
    getCanvas() { return { style: {} }; }
  }
  class NavigationControl {}
  class Popup {
    setLngLat() { return this; }
    setDOMContent() { return this; }
    addTo() { return this; }
  }
  return { Map: MapLibreMap, NavigationControl, Popup };
});

import PmtilesMapPanel from './PmtilesMapPanel.jsx';

const mapInfo = {
  provider: 'pmtiles', geometry_type: 'point',
  extent: [-114.2, 50.9, -113.9, 51.2],
  fields: [{ name: 'station', alias: 'Station' }],
  min_zoom: 0, max_zoom: 16, layer: 'features',
  tiles: '/api/v1/resources/r1/map/tiles/version/{z}/{x}/{y}.pbf',
};

describe('PMTiles MapLibre panel', () => {
  beforeEach(() => { state.instances.length = 0; });

  test('uses the same-origin immutable vector template without exposing object storage', async () => {
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
});
