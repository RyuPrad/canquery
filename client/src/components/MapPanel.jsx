import { useCallback, useEffect, useMemo, useState } from 'react';
import { circleMarker } from 'leaflet';
import { GeoJSON, MapContainer, TileLayer, useMapEvents } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import { fetchResourceMap } from '../api/catalog.js';
import useDebouncedValue from '../hooks/useDebouncedValue.js';
import { useLang } from '../i18n.jsx';
import { useTheme } from '../theme.jsx';
import { MapIcon } from './Icons.jsx';
import { track } from '../utils/analytics.js';

const GEOMETRY_TILES = 'https://maps-cartes.services.geo.ca/server2_serveur2/rest/services/BaseMaps/CBMT_CBCT_GEOM_3857/MapServer/tile/{z}/{y}/{x}';
const ENGLISH_TILES = 'https://maps-cartes.services.geo.ca/server2_serveur2/rest/services/BaseMaps/CBMT_TXT_3857/MapServer/tile/{z}/{y}/{x}';
const FRENCH_TILES = 'https://maps-cartes.services.geo.ca/server2_serveur2/rest/services/BaseMaps/CBCT_TXT_3857/MapServer/tile/{z}/{y}/{x}';
const ATTRIBUTION = '&copy; <a href="https://natural-resources.canada.ca/">Natural Resources Canada</a>, Open Government Licence - Canada';

function viewportOf(map) {
  const bounds = map.getBounds();
  return {
    bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
      .map(value => value.toFixed(5)).join(','),
    zoom: map.getZoom()
  };
}

function ViewportEvents({ onChange }) {
  const map = useMapEvents({
    moveend: () => onChange(viewportOf(map)),
    zoomend: () => onChange(viewportOf(map))
  });
  useEffect(() => onChange(viewportOf(map)), [map, onChange]);
  return null;
}

function initialBounds(extent) {
  if (Array.isArray(extent) && extent.length === 4 && extent.every(Number.isFinite)) {
    return [[extent[1], extent[0]], [extent[3], extent[2]]];
  }
  return [[43.75, -79.05], [44.02, -78.70]];
}

export default function MapPanel({ resourceId, map: mapInfo }) {
  const { lang, t } = useLang();
  const { dark } = useTheme();
  const [viewport, setViewport] = useState(null);
  const debouncedViewport = useDebouncedValue(viewport, 300);
  const [features, setFeatures] = useState(null);
  const [meta, setMeta] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const bounds = useMemo(() => initialBounds(mapInfo?.extent), [mapInfo?.extent]);
  const reportViewport = useCallback(next => setViewport(current =>
    current?.bbox === next.bbox && current?.zoom === next.zoom ? current : next
  ), []);

  useEffect(() => {
    if (!debouncedViewport) return undefined;
    const controller = new AbortController();
    setLoading(true);
    fetchResourceMap(resourceId, { ...debouncedViewport, limit: 1000, signal: controller.signal })
      .then(env => {
        setFeatures(env.data);
        setMeta(env.meta?.map || null);
        setError(null);
        track('map_viewport', {
          resource_id: resourceId,
          bbox: debouncedViewport.bbox,
          zoom: debouncedViewport.zoom,
          returned: Number(env.meta?.map?.returned) || 0,
          truncated: Boolean(env.meta?.map?.truncated),
          status: 'success',
        });
      })
      .catch(err => {
        if (err?.name !== 'AbortError') {
          track('map_viewport', {
            resource_id: resourceId,
            bbox: debouncedViewport.bbox,
            zoom: debouncedViewport.zoom,
            status: err?.status === 413 ? 'too_broad' : 'failed',
          });
          setError(err);
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [resourceId, debouncedViewport]);

  const layerStyle = useCallback(() => ({
    color: dark ? '#5eead4' : '#087f73',
    weight: 2,
    opacity: 0.9,
    fillColor: dark ? '#2dd4bf' : '#15998a',
    fillOpacity: 0.22
  }), [dark]);
  const bindFeatureDetails = useCallback((feature, layer) => {
    const aliases = new Map((mapInfo?.fields || []).map(field => [field.name, field.alias || field.name]));
    const entries = Object.entries(feature?.properties || {})
      .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object')
      .slice(0, 10);
    if (!entries.length) return;
    const container = document.createElement('dl');
    container.className = 'cq-map-popup';
    for (const [key, value] of entries) {
      const term = document.createElement('dt');
      const detail = document.createElement('dd');
      term.textContent = aliases.get(key) || key;
      detail.textContent = String(value);
      container.append(term, detail);
    }
    layer.bindPopup(container, { maxWidth: 320 });
    layer.on('popupopen', () => track('map_feature_open', {
      resource_id: resourceId,
      geometry_type: feature?.geometry?.type || mapInfo?.geometry_type || '',
    }));
  }, [mapInfo?.fields, mapInfo?.geometry_type, resourceId]);

  return (
    <div className="cq-card overflow-hidden relative">
      <MapContainer bounds={bounds} maxZoom={18} minZoom={3} scrollWheelZoom className="cq-map" preferCanvas>
        <TileLayer url={GEOMETRY_TILES} attribution={ATTRIBUTION} maxZoom={18} />
        <TileLayer url={lang === 'fr' ? FRENCH_TILES : ENGLISH_TILES} maxZoom={18} />
        <ViewportEvents onChange={reportViewport} />
        {features && (
          <GeoJSON
            key={resourceId + ':' + debouncedViewport?.bbox + ':' + dark}
            data={features}
            style={layerStyle}
            onEachFeature={bindFeatureDetails}
            pointToLayer={(feature, latlng) => circleMarker(latlng, {
              radius: 5,
              color: dark ? '#e9f2ff' : '#14233a',
              weight: 1.5,
              fillColor: '#d52b1e',
              fillOpacity: 0.9
            })}
          />
        )}
      </MapContainer>
      <div className="absolute left-3 top-3 z-[500] flex items-center gap-2 rounded-lg border border-base-content/10 bg-base-100/90 backdrop-blur px-3 py-2 text-xs shadow-lg">
        {loading ? <span className="loading loading-spinner loading-xs" /> : <MapIcon size={13} className="text-secondary" />}
        {loading ? t('map.loading') : meta ? meta.returned.toLocaleString() + ' ' + t('map.features') : t('map.live')}
      </div>
      {meta?.truncated && (
        <div className="absolute right-3 top-3 z-[500] rounded-lg bg-warning/90 text-warning-content px-3 py-2 text-xs shadow-lg">
          {t('map.zoom_in')}
        </div>
      )}
      {error && (
        <div className="absolute inset-x-4 bottom-8 z-[500] alert alert-error text-sm shadow-xl">
          {error.status === 413 ? t('map.zoom_in') : t('map.failed')}
        </div>
      )}
    </div>
  );
}
