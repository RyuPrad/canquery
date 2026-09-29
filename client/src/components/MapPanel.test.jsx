import { act, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, test, vi } from 'vitest';

const state = vi.hoisted(() => ({ events: null, bounds: [-79, 43, -78, 44], mapOptions: null }));
vi.mock('leaflet', () => ({ circleMarker: vi.fn() }));
vi.mock('react-leaflet', () => ({
  MapContainer: ({ children, ...options }) => {
    state.mapOptions = options;
    return <div>{children}</div>;
  },
  TileLayer: () => null,
  ZoomControl: options => { state.zoomOptions = options; return null; },
  GeoJSON: ({ data }) => <div data-testid="features">{data.features[0]?.properties.name}</div>,
  useMapEvents: events => {
    state.events = events;
    return state.map;
  },
}));
vi.mock('../api/catalog.js', () => ({ fetchResourceMap: vi.fn() }));
vi.mock('../utils/analytics.js', () => ({ track: vi.fn() }));

import { fetchResourceMap } from '../api/catalog.js';
import MapPanel from './MapPanel.jsx';

const mapInfo = { provider: 'arcgis', extent: [-79, 43, -78, 44], fields: [] };
const response = name => ({
  data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name }, geometry: null }] },
  meta: { map: { returned: 1 } },
});

describe('bounded viewport map', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.bounds = [-79, 43, -78, 44];
    state.map = {
      getBounds: () => ({
        getWest: () => state.bounds[0], getSouth: () => state.bounds[1],
        getEast: () => state.bounds[2], getNorth: () => state.bounds[3],
      }),
      getZoom: () => 11,
    };
    fetchResourceMap.mockResolvedValue(response('current'));
  });

  test('clips viewport queries to the WGS84 API bounds', async () => {
    state.bounds = [-185, -92, 185, 92];
    render(<MapPanel resourceId="r1" map={mapInfo} />);
    await waitFor(() => expect(fetchResourceMap).toHaveBeenCalled());
    expect(fetchResourceMap.mock.calls[0][1].bbox).toBe('-180.00000,-90.00000,180.00000,90.00000');
    expect(state.mapOptions.maxBounds).toEqual([[-85, -180], [85, 180]]);
  });

  test('ignores a superseded viewport response even when abort arrives after its body', async () => {
    let finishOld;
    fetchResourceMap.mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }));
    render(<MapPanel resourceId="r1" map={mapInfo} />);
    await waitFor(() => expect(fetchResourceMap).toHaveBeenCalledTimes(1));
    state.bounds = [-80, 43, -79, 44];
    act(() => state.events.moveend());
    await waitFor(() => expect(fetchResourceMap).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByTestId('features')).toHaveTextContent('current'));
    await act(async () => finishOld(response('stale')));
    expect(screen.getByTestId('features')).toHaveTextContent('current');
  });

  test('ignores errors from superseded viewport requests', async () => {
    let failOld;
    fetchResourceMap.mockImplementationOnce(() => new Promise((resolve, reject) => { failOld = reject; }));
    render(<MapPanel resourceId="r1" map={mapInfo} />);
    await waitFor(() => expect(fetchResourceMap).toHaveBeenCalledTimes(1));
    state.bounds = [-80, 43, -79, 44];
    act(() => state.events.moveend());
    await waitFor(() => expect(fetchResourceMap).toHaveBeenCalledTimes(2));
    await act(async () => failOld(new Error('Old failure')));
    expect(screen.queryByText(/temporarily unavailable/)).not.toBeInTheDocument();
  });
});
