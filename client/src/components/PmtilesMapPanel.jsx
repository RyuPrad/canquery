import { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, NavigationControl, Popup } from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { useLang } from '../i18n.jsx';
import { useTheme } from '../theme.jsx';
import { track } from '../utils/analytics.js';
import { MapIcon } from './Icons.jsx';

const GEOMETRY_TILES = 'https://maps-cartes.services.geo.ca/server2_serveur2/rest/services/BaseMaps/CBMT_CBCT_GEOM_3857/MapServer/tile/{z}/{y}/{x}';
const ENGLISH_TILES = 'https://maps-cartes.services.geo.ca/server2_serveur2/rest/services/BaseMaps/CBMT_TXT_3857/MapServer/tile/{z}/{y}/{x}';
const FRENCH_TILES = 'https://maps-cartes.services.geo.ca/server2_serveur2/rest/services/BaseMaps/CBCT_TXT_3857/MapServer/tile/{z}/{y}/{x}';
const ATTRIBUTION = '&copy; Natural Resources Canada, Open Government Licence - Canada';
const FEATURE_LAYERS = ['cq-polygons', 'cq-lines', 'cq-points'];
const DEFAULT_EXTENT = [-114.32, 50.82, -113.85, 51.21];

function validExtent(value) {
  return Array.isArray(value) && value.length === 4 && value.every(Number.isFinite) &&
    value[0] < value[2] && value[1] < value[3];
}

function styleFor(mapInfo, lang, dark) {
  const line = dark ? '#5eead4' : '#087f73';
  const fill = dark ? '#2dd4bf' : '#15998a';
  return {
    version: 8,
    sources: {
      geometry: { type: 'raster', tiles: [GEOMETRY_TILES], tileSize: 256, attribution: ATTRIBUTION },
      labels: { type: 'raster', tiles: [lang === 'fr' ? FRENCH_TILES : ENGLISH_TILES], tileSize: 256 },
      canquery: {
        type: 'vector',
        tiles: [mapInfo.tiles],
        minzoom: mapInfo.min_zoom,
        maxzoom: mapInfo.max_zoom,
      },
    },
    layers: [
      { id: 'base', type: 'raster', source: 'geometry' },
      {
        id: 'cq-polygons', type: 'fill', source: 'canquery', 'source-layer': mapInfo.layer,
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': fill, 'fill-opacity': 0.24, 'fill-outline-color': line },
      },
      {
        id: 'cq-lines', type: 'line', source: 'canquery', 'source-layer': mapInfo.layer,
        filter: ['==', ['geometry-type'], 'LineString'],
        paint: { 'line-color': line, 'line-width': 2.2, 'line-opacity': 0.92 },
      },
      {
        id: 'cq-points', type: 'circle', source: 'canquery', 'source-layer': mapInfo.layer,
        filter: ['==', ['geometry-type'], 'Point'],
        paint: {
          'circle-radius': 5, 'circle-color': '#d52b1e',
          'circle-stroke-color': dark ? '#e9f2ff' : '#14233a', 'circle-stroke-width': 1.5,
        },
      },
      { id: 'labels', type: 'raster', source: 'labels' },
    ],
  };
}

function popupContent(feature, fields) {
  const aliases = new Map((fields || []).map(field => [field.name, field.alias || field.name]));
  const container = document.createElement('dl');
  container.className = 'cq-map-popup';
  for (const [key, value] of Object.entries(feature?.properties || {})
    .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object')
    .slice(0, 10)) {
    const term = document.createElement('dt');
    const detail = document.createElement('dd');
    term.textContent = aliases.get(key) || key;
    detail.textContent = String(value);
    container.append(term, detail);
  }
  return container.childNodes.length ? container : null;
}

export default function PmtilesMapPanel({ resourceId, map: mapInfo }) {
  const { lang, t } = useLang();
  const { dark } = useTheme();
  const containerRef = useRef(null);
  const [error, setError] = useState(false);
  const extent = validExtent(mapInfo?.extent) ? mapInfo.extent : DEFAULT_EXTENT;

  useEffect(() => {
    if (!containerRef.current || !mapInfo?.tiles || !mapInfo?.layer) return undefined;
    setError(false);
    const map = new MapLibreMap({
      container: containerRef.current,
      style: styleFor(mapInfo, lang, dark),
      bounds: [[extent[0], extent[1]], [extent[2], extent[3]]],
      fitBoundsOptions: { padding: 24, maxZoom: Math.min(14, Number(mapInfo.max_zoom) || 14) },
      minZoom: Math.max(2, Number(mapInfo.min_zoom) || 0),
      maxZoom: Number(mapInfo.max_zoom) || 16,
      attributionControl: true,
    });
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    const reportViewport = () => {
      const bounds = map.getBounds();
      track('map_viewport', {
        resource_id: resourceId,
        provider: 'pmtiles',
        bbox: [bounds.getWest(), bounds.getSouth(), bounds.getEast(), bounds.getNorth()]
          .map(value => value.toFixed(5)).join(','),
        zoom: Number(map.getZoom().toFixed(1)),
        status: 'success',
      });
    };
    map.on('load', reportViewport);
    map.on('moveend', reportViewport);
    map.on('error', event => {
      if (event?.error && (!event.sourceId || event.sourceId === 'canquery')) setError(true);
    });
    const onClick = event => {
      const feature = event.features?.[0];
      const content = popupContent(feature, mapInfo.fields);
      if (!feature || !content) return;
      new Popup({ maxWidth: '320px' })
        .setLngLat(event.lngLat)
        .setDOMContent(content)
        .addTo(map);
      track('map_feature_open', {
        resource_id: resourceId,
        provider: 'pmtiles',
        geometry_type: feature.geometry?.type || mapInfo.geometry_type || '',
      });
    };
    for (const layer of FEATURE_LAYERS) {
      map.on('click', layer, onClick);
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
    }
    return () => map.remove();
  }, [dark, extent, lang, mapInfo, resourceId]);

  return (
    <div className="cq-card overflow-hidden relative">
      <div ref={containerRef} className="cq-map" />
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-lg border border-base-content/10 bg-base-100/90 backdrop-blur px-3 py-2 text-xs shadow-lg">
        <MapIcon size={13} className="text-secondary" />
        {t('map.live')}
      </div>
      {error && (
        <div className="absolute inset-x-4 bottom-8 z-10 alert alert-error text-sm shadow-xl">
          {t('map.failed')}
        </div>
      )}
    </div>
  );
}
