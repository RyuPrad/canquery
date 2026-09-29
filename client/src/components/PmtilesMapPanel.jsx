import { useEffect, useRef, useState } from 'react';
import { Map as MapLibreMap, NavigationControl, Popup, setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';
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
const UNKNOWN_MAP_ERROR = Symbol('unknown-map-error');

// MapLibre's relative default URL is lost during Vite dependency/bundle builds.
setWorkerUrl(workerUrl);

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

function applyMapLabels(map, labels) {
  map.getCanvas().setAttribute('aria-label', labels.map);
  for (const [selector, label] of [
    ['.maplibregl-ctrl-zoom-in', labels.zoomIn],
    ['.maplibregl-ctrl-zoom-out', labels.zoomOut],
    ['.maplibregl-ctrl-attrib-button', labels.attribution],
    ['.maplibregl-popup-close-button', labels.closePopup],
  ]) {
    for (const button of map.getContainer().querySelectorAll(selector)) {
      button.setAttribute('title', label);
      button.setAttribute('aria-label', label);
    }
  }
}

export default function PmtilesMapPanel({ resourceId, map: mapInfo }) {
  const { lang, t } = useLang();
  const { dark } = useTheme();
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const styleRef = useRef(null);
  const labelsRef = useRef(null);
  const failedTilesRef = useRef(new Set());
  const [error, setError] = useState(false);
  const [retry, setRetry] = useState(0);
  const extent = validExtent(mapInfo?.extent) ? mapInfo.extent : DEFAULT_EXTENT;

  useEffect(() => {
    if (!mapInfo?.tiles || !mapInfo?.layer) return;
    const style = styleFor(mapInfo, lang, dark);
    styleRef.current = style;
    labelsRef.current = {
      map: t('map.live'), zoomIn: t('map.zoom_in_control'),
      zoomOut: t('map.zoom_out_control'), closePopup: t('map.close_popup'),
      attribution: t('map.toggle_attribution'),
    };
    // Changing presentation must preserve the user's current camera position.
    mapRef.current?.setStyle(style);
    if (mapRef.current) applyMapLabels(mapRef.current, labelsRef.current);
  }, [lang, dark, mapInfo, t]);

  useEffect(() => {
    if (!containerRef.current || !mapInfo?.tiles || !mapInfo?.layer) return undefined;
    failedTilesRef.current.clear();
    setError(false);
    let map;
    try {
      const maxZoom = Number.isFinite(mapInfo.max_zoom) ? mapInfo.max_zoom : 16;
      map = new MapLibreMap({
        container: containerRef.current,
        style: styleRef.current,
        bounds: [[extent[0], extent[1]], [extent[2], extent[3]]],
        fitBoundsOptions: { padding: 24, maxZoom: Math.min(14, maxZoom) },
        minZoom: Math.min(maxZoom, Math.max(2, Number(mapInfo.min_zoom) || 0)),
        maxZoom,
        attributionControl: true,
      });
    } catch {
      containerRef.current.replaceChildren();
      setError(true);
      return undefined;
    }
    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), 'top-right');
    applyMapLabels(map, labelsRef.current);
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
      if (event?.error && (!event.sourceId || event.sourceId === 'canquery')) {
        failedTilesRef.current.add(event.tile?.tileID?.key ?? UNKNOWN_MAP_ERROR);
        setError(true);
      }
    });
    map.on('sourcedata', event => {
      if (event.sourceId !== 'canquery' || event.tile?.state !== 'loaded') return;
      const tileKey = event.tile?.tileID?.key;
      if (tileKey === undefined) return;
      failedTilesRef.current.delete(tileKey);
      if (!failedTilesRef.current.size) setError(false);
    });
    const onClick = event => {
      const feature = event.features?.[0];
      const content = popupContent(feature, mapInfo.fields);
      if (!feature || !content) return;
      new Popup({ maxWidth: '320px' })
        .setLngLat(event.lngLat)
        .setDOMContent(content)
        .addTo(map);
      applyMapLabels(map, labelsRef.current);
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
    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, [extent, mapInfo, resourceId, retry]);

  const retryMap = () => {
    const source = mapRef.current?.getSource('canquery');
    if (source) {
      failedTilesRef.current.clear();
      setError(false);
      source.setTiles([mapInfo.tiles]);
    } else {
      setRetry(value => value + 1);
    }
  };

  return (
    <div role="region" aria-label={t('map.live')} className="cq-card overflow-hidden relative">
      <div ref={containerRef} className="cq-map" />
      <div className="absolute left-3 top-3 z-10 flex items-center gap-2 rounded-lg border border-base-content/10 bg-base-100/90 backdrop-blur px-3 py-2 text-xs shadow-lg">
        <MapIcon size={13} className="text-secondary" />
        {t('map.live')}
      </div>
      {error && (
        <div role="alert" className="absolute inset-x-4 bottom-8 z-10 alert alert-error text-sm shadow-xl">
          <span>{t('map.failed')}</span>
          <button className="btn btn-sm btn-outline" onClick={retryMap}>{t('common.retry')}</button>
        </div>
      )}
    </div>
  );
}
