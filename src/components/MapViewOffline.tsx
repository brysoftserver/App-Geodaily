// ============================================================
// GEODAILY — Mapa Offline con MapLibre GL
// ============================================================
// Renderiza mapas offline usando teselas del servidor QGIS
// a través de @maplibre/maplibre-react-native.
//
// URL de teselas: /api/maps/tesela/{z}/{x}/{y}?capa=colombia
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, NativeModules, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../theme';
import { API_CONFIG } from '../theme';
import { Coordenadas } from '../types';

// Carga condicional de MapLibre (fallback si no hay módulo nativo)
// En Expo Go, el módulo JS se carga pero el native module no está registrado.
// Usamos NativeModules para verificar limpiamente, sin mutar console.error.
let MapLibreGL: any = null;
try {
  if (NativeModules.MLRNModule) {
    MapLibreGL = require('@maplibre/maplibre-react-native');
  } else {
    console.log('[MapView] MapLibre native module no disponible — usando WebView fallback');
  }
} catch {
  // Módulo nativo no disponible (Expo Go / web)
}

interface MarkerData {
  id: string;
  latitud: number;
  longitud: number;
  title?: string;
  color?: string;
  /** Emoji icon para mostrar en vez de círculo (ej: 🌱) */
  icon?: string;
}

interface MapViewOfflineProps {
  center?: Coordenadas;
  zoom?: number;
  /** Altura del mapa en píxels. Usar '100%' para que ocupe todo el contenedor flex */
  height?: number | '100%';
  markers?: MarkerData[];
  /** Tipo de mapa: relieve (CartoDB) o satélite (Esri) */
  mapStyle?: 'relieve' | 'satelite';
  /** Array de puntos para dibujar una polyline (ruta GPS) */
  polyline?: { latitud: number; longitud: number }[];
  /** Marcador verde de inicio de ruta */
  startMarker?: { latitud: number; longitud: number };
  /** Marcador azul de posición actual */
  endMarker?: { latitud: number; longitud: number };
  showUserLocation?: boolean;
  /** Posición GPS real del usuario (independiente del centro). Usada para el punto azul. */
  userLocation?: Coordenadas;
  /** Capas GeoJSON para dibujar polígonos (ej: veredas) */
  geojsonLayers?: Array<{
    id: string;
    /** Nombre visible de la capa */
    nombre?: string;
    /** Features GeoJSON (FeatureCollection o Feature[]) */
    features: any[];
    /** Color de relleno (con opacidad incluida, ej: rgba) */
    fillColor?: string;
    /** Color del borde */
    strokeColor?: string;
    /** Opacidad del relleno 0-1 */
    fillOpacity?: number;
    /** Opacidad del borde 0-1 */
    strokeOpacity?: number;
    /** Grosor del borde en píxels */
    strokeWidth?: number;
  }>;
  interactive?: boolean;
  onMarkerPress?: (id: string) => void;
  onMapPress?: (latitud: number, longitud: number) => void;
}

// ============================================================
// ESTILOS DE MAPA
// ============================================================

// URL de teselas vectoriales PBF (OpenMapTiles schema) — para relieve
const TILE_URL = `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.MAPS}/tesela/{z}/{x}/{y}?capa=colombia`;

// Estilo: Relieve — vectorial con colores tierra (GEODAILY offline)
const MAP_STYLE_RELIEVE = {
  version: 8 as const,
  name: 'GEODAILY - Relieve',
  sources: {
    'geodaily-vector': {
      type: 'vector' as const,
      tiles: [TILE_URL],
      minzoom: 0,
      maxzoom: 14,
      attribution: '© OpenStreetMap contributors | GEODAILY',
    },
    // Fallback online: CartoDB Positron (raster) se muestra si las teselas vectoriales fallan
    'carto-positron': {
      type: 'raster' as const,
      tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors, © CARTO',
    },
  },
  layers: [
    // Capa raster de respaldo (online) — se ve siempre como base
    { id: 'carto-bg', source: 'carto-positron', type: 'raster', paint: { 'raster-opacity': 1 } },
    { id: 'background', type: 'background', paint: { 'background-color': '#f8f4f0' } },
    { id: 'landuse', source: 'geodaily-vector', 'source-layer': 'landuse', type: 'fill', minzoom: 4, paint: { 'fill-color': ['match', ['get', 'class'], 'residential', '#e8ddd3', 'commercial', '#e8ddd3', 'industrial', '#e8ddd3', 'cemetery', '#c3d9b7', 'military', '#e8ddd3', 'park', '#b6d9a8', 'hospital', '#f0d0d0', 'school', '#f0e8d0', 'wood', '#b6d9a8', 'grass', '#cde5c1', 'forest', '#a8cfa0', 'farmland', '#e5e8c3', 'orchard', '#dce5b6', 'quarry', '#d0d0d0', 'beach', '#f0e8d0', 'glacier', '#e8f0f8', /* default */ '#e8ddd3'], 'fill-opacity': 0.7 } },
    { id: 'landcover', source: 'geodaily-vector', 'source-layer': 'landcover', type: 'fill', minzoom: 0, paint: { 'fill-color': ['match', ['get', 'class'], 'wood', '#b6d9a8', 'forest', '#a8cfa0', 'grass', '#cde5c1', 'wetland', '#b6cfe0', 'snow', '#f0f4f8', 'sand', '#f0e8d0', 'bare_rock', '#d8d0c8', 'scrub', '#d0dcc0', /* default */ '#dce5d0'], 'fill-opacity': 0.5 } },
    { id: 'park', source: 'geodaily-vector', 'source-layer': 'park', type: 'fill', minzoom: 11, paint: { 'fill-color': '#b6d9a8', 'fill-opacity': 0.5 } },
    { id: 'water', source: 'geodaily-vector', 'source-layer': 'water', type: 'fill', minzoom: 0, paint: { 'fill-color': '#a0c8e8', 'fill-opacity': 0.5 } },
    { id: 'waterway', source: 'geodaily-vector', 'source-layer': 'waterway', type: 'line', minzoom: 8, paint: { 'line-color': '#a0c8e8', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2] } },
    { id: 'boundary', source: 'geodaily-vector', 'source-layer': 'boundary', type: 'line', minzoom: 3, paint: { 'line-color': '#888', 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 14, 2], 'line-dasharray': [4, 2] } },
    { id: 'transportation', source: 'geodaily-vector', 'source-layer': 'transportation', type: 'line', minzoom: 4, paint: { 'line-color': ['match', ['get', 'class'], 'motorway', '#f08060', 'trunk', '#f0a060', 'primary', '#f0c060', 'secondary', '#f0e060', 'tertiary', '#e8e0c0', 'street', '#d0c8b0', 'path', '#c0b8a0', 'track', '#c0b8a0', 'rail', '#b0a090', 'pier', '#d0c8b0', 'bridge', '#d0c8b0', /* default */ '#d0c8b0'], 'line-width': ['interpolate', ['linear'], ['zoom'], 4, ['match', ['get', 'class'], 'motorway', 1, 'trunk', 0.8, 0.3], 14, ['match', ['get', 'class'], 'motorway', 6, 'trunk', 5, 'primary', 4, 'secondary', 3, 'tertiary', 2.5, 'street', 2, 1]] } },
    { id: 'transportation-tunnel', source: 'geodaily-vector', 'source-layer': 'transportation', type: 'line', minzoom: 8, filter: ['==', ['get', 'brunnel'], 'tunnel'], paint: { 'line-color': '#d0c8b0', 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 3], 'line-dasharray': [2, 2], 'line-opacity': 0.5 } },
    { id: 'building', source: 'geodaily-vector', 'source-layer': 'building', type: 'fill', minzoom: 13, paint: { 'fill-color': '#d0c8b8', 'fill-opacity': 0.8, 'fill-outline-color': '#b0a898' } },
    { id: 'aeroway', source: 'geodaily-vector', 'source-layer': 'aeroway', type: 'fill', minzoom: 11, paint: { 'fill-color': '#e8e0d8' } },
    { id: 'place-city', source: 'geodaily-vector', 'source-layer': 'place', type: 'symbol', minzoom: 4, layout: { 'text-field': '{name:latin}', 'text-font': ['Open Sans Regular', 'Noto Sans Regular'], 'text-size': ['interpolate', ['linear'], ['zoom'], 4, 8, 14, 14], 'text-anchor': 'center', 'text-offset': [0, 0], 'text-max-width': 10, 'text-padding': 4 }, paint: { 'text-color': '#333', 'text-halo-color': '#fff', 'text-halo-width': 2 } },
  ],
};

// Estilo: Satélite — raster desde Esri World Imagery
const MAP_STYLE_SATELITE = {
  version: 8 as const,
  name: 'GEODAILY - Satélite',
  sources: {
    'satellite': {
      type: 'raster' as const,
      tiles: [
        'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      ],
      tileSize: 256,
      attribution: '© Esri, Maxar, Earthstar Geographics',
    },
  },
  layers: [
    {
      id: 'satellite-layer',
      type: 'raster' as const,
      source: 'satellite',
      paint: {
        'raster-opacity': 1,
      },
    },
  ],
};

const MAP_STYLES = {
  relieve: MAP_STYLE_RELIEVE,
  satelite: MAP_STYLE_SATELITE,
};

const MapViewOffline: React.FC<MapViewOfflineProps> = ({
  center,
  zoom = 14,
  height = 300,
  markers = [],
  mapStyle = 'relieve',
  polyline,
  startMarker,
  endMarker,
  showUserLocation = false,
  userLocation,
  geojsonLayers,
  interactive = true,
  onMarkerPress,
  onMapPress,
}) => {
  const cameraRef = useRef<any>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasNativeModule, setHasNativeModule] = useState(!!MapLibreGL);

  // Altura del contenedor: '100%' usa flex, número usa altura fija
  const containerStyle = height === '100%'
    ? styles.containerFlex
    : [styles.container, { height }];

  // Centrar el mapa cuando cambien las coordenadas
  useEffect(() => {
    if (isLoaded && cameraRef.current && center) {
      cameraRef.current.setCamera({
        centerCoordinate: [center.longitud, center.latitud],
        zoomLevel: zoom,
        animationDuration: 500,
      });
    }
  }, [center, zoom, isLoaded]);

  // ========================================================
  // WebView + Leaflet (Fallback para Expo Go / Testing)
  // ========================================================
  const webViewRef = useRef<WebView>(null);
  const [webViewReady, setWebViewReady] = useState(false);

  // Web: iframe ref + ready state
  const webIframeRef = useRef<HTMLIFrameElement>(null);
  const [webIframeReady, setWebIframeReady] = useState(false);

  // Web: comunicación con el iframe vía postMessage
  const postMsg = useCallback((data: any) => {
    try {
      webIframeRef.current?.contentWindow?.postMessage(data, '*');
    } catch { /* iframe no disponible */ }
  }, []);

  // Web: listener de mensajes desde el iframe
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (event: MessageEvent) => {
      try {
        const msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (msg.type === 'mapReady') {
          setWebIframeReady(true);
        } else if (msg.type === 'mapPress' && onMapPress) {
          onMapPress(msg.latitud, msg.longitud);
        }
      } catch { /* ignorar mensajes no JSON */ }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onMapPress]);

  // Web: sincronizar marcadores
  useEffect(() => {
    if (Platform.OS !== 'web' || !webIframeReady) return;
    postMsg({ type: 'setMarkers', markers: markers.map(m => ({ id: m.id, lat: m.latitud, lng: m.longitud, title: m.title, color: m.color, icon: m.icon })) });
  }, [webIframeReady, markers, postMsg]);

  // Web: sincronizar polyline
  useEffect(() => {
    if (Platform.OS !== 'web' || !webIframeReady) return;
    postMsg({ type: 'setPolyline', polyline: polyline?.map(p => ({ lat: p.latitud, lng: p.longitud })) || [] });
  }, [webIframeReady, polyline, postMsg]);

  // Web: sincronizar marcador inicio
  useEffect(() => {
    if (Platform.OS !== 'web' || !webIframeReady) return;
    postMsg({ type: 'setStartMarker', data: startMarker ? { lat: startMarker.latitud, lng: startMarker.longitud } : null });
  }, [webIframeReady, startMarker, postMsg]);

  // Web: sincronizar marcador final
  useEffect(() => {
    if (Platform.OS !== 'web' || !webIframeReady) return;
    postMsg({ type: 'setEndMarker', data: endMarker ? { lat: endMarker.latitud, lng: endMarker.longitud } : null });
  }, [webIframeReady, endMarker, postMsg]);

  // Web: sincronizar centro/zoom
  useEffect(() => {
    if (Platform.OS !== 'web' || !webIframeReady || !center) return;
    postMsg({ type: 'setView', lat: center.latitud, lng: center.longitud, zoom });
  }, [webIframeReady, center, zoom, postMsg]);

  // Web: sincronizar ubicación usuario
  useEffect(() => {
    if (Platform.OS !== 'web' || !webIframeReady) return;
    const loc = userLocation || center;
    if (loc) postMsg({ type: 'setUserLocation', data: { lat: loc.latitud, lng: loc.longitud } });
  }, [webIframeReady, userLocation, center, postMsg]);

  // Web: sincronizar capas GeoJSON
  useEffect(() => {
    if (Platform.OS !== 'web' || !webIframeReady) return;
    postMsg({ type: 'setGeoJSONLayers', layers: (geojsonLayers || []).map(l => ({
      id: l.id,
      fillColor: l.fillColor || '#1B5E20',
      fillOpacity: l.fillOpacity ?? 0.15,
      strokeColor: l.strokeColor || '#1B5E20',
      strokeWidth: l.strokeWidth || 2,
      strokeOpacity: l.strokeOpacity ?? 0.6,
      features: l.features,
    })) });
  }, [webIframeReady, geojsonLayers, postMsg]);

  // HTML base del mapa — SOLO con valores estáticos. 
  // El centro/zoom se actualiza via injectJS para NO recargar el WebView.
  const webMapHtml = useMemo(() => {
    const lat = 4.711;
    const lon = -74.072;
    const initialZoom = 14;

    const tileUrl = mapStyle === 'satelite'
      ? `'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'`
      : `'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png'`;

    const tileAttribution = mapStyle === 'satelite'
      ? `'© Esri, Maxar, Earthstar Geographics'`
      : `'© OpenStreetMap contributors, © CARTO'`;

    return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no" />
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css" />
  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <style>
    * { margin: 0; padding: 0; }
    body { font-family: sans-serif; }
    #map { width: 100%; height: 100vh; }
  </style>
</head>
<body>
  <div id="map"></div>
  <script>
    var map = L.map('map', { zoomControl: false, attributionControl: false });
    L.tileLayer(${tileUrl}, {
      maxZoom: 19,
      attribution: ${tileAttribution}
    }).addTo(map);
    map.setView([${lat}, ${lon}], ${initialZoom});

      // --- Almacenes dinámicos (se actualizan vía injectJavaScript) ---
    window._markers = {};
    window._userLocFollow = false;
    window._polylineLayer = null;
    window._startMarkerLayer = null;
    window._endMarkerLayer = null;
    window._userLocLayer = null;

    window._setMarkers = function(data) {
      Object.values(window._markers).forEach(function(l) { map.removeLayer(l); });
      window._markers = {};
      data.forEach(function(m) {
        var layer;
        if (m.icon) {
          layer = L.marker([m.lat, m.lng], {
            icon: L.divIcon({
              html: '<span style="font-size:24px;line-height:1">' + m.icon + '</span>',
              className: '',
              iconSize: [24, 24],
              iconAnchor: [12, 12]
            })
          }).addTo(map);
        } else {
          layer = L.circleMarker([m.lat, m.lng], {
            radius: 8,
            fillColor: m.color || '#1B5E20',
            color: '#fff',
            weight: 2,
            fillOpacity: 1
          }).addTo(map);
        }
        if (m.title) layer.bindPopup(m.title);
        if (m.onClickMsg) {
          layer.on('click', function() {
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'markerPress', id: m.id }));
          });
        }
        window._markers[m.id] = layer;
      });
    };

    window._setPolyline = function(data) {
      if (window._polylineLayer) { map.removeLayer(window._polylineLayer); window._polylineLayer = null; }
      if (data && data.length > 1) {
        window._polylineLayer = L.polyline(data.map(function(p) { return [p.lat, p.lng]; }), {
          color: '#1B5E20', weight: 4, opacity: 0.8
        }).addTo(map);
        window._polylineLayer.bindPopup('🛣️ Ruta: ' + data.length + ' puntos');
      }
    };

    window._setStartMarker = function(data) {
      if (window._startMarkerLayer) { map.removeLayer(window._startMarkerLayer); }
      if (data) {
        window._startMarkerLayer = L.circleMarker([data.lat, data.lng], {
          radius: 10, fillColor: '#4CAF50', color: '#fff', weight: 3, fillOpacity: 1
        }).addTo(map).bindPopup('🏁 Inicio');
      }
    };

    window._setEndMarker = function(data) {
      if (window._endMarkerLayer) { map.removeLayer(window._endMarkerLayer); }
      if (data) {
        window._endMarkerLayer = L.circleMarker([data.lat, data.lng], {
          radius: 10, fillColor: '#2196F3', color: '#fff', weight: 3, fillOpacity: 1
        }).addTo(map).bindPopup('📍 Actual');
      }
    };
    window._setFollowUser = function(follow) {
      window._userLocFollow = follow;
    };
    window._setUserLocation = function(data) {
      if (window._userLocLayer) { map.removeLayer(window._userLocLayer); }
      if (data) {
        window._userLocLayer = L.circleMarker([data.lat, data.lng], {
          radius: 10, fillColor: '#2196F3', color: '#fff', weight: 3, fillOpacity: 0.8
        }).addTo(map).bindPopup('📍 Mi ubicación');
      }
    };

    // --- Capas GeoJSON (polígonos de veredas, etc.) ---
    window._geoJSONLayers = {};
    window._setGeoJSONLayers = function(layers) {
      // Limpiar capas anteriores
      Object.values(window._geoJSONLayers).forEach(function(l) { map.removeLayer(l); });
      window._geoJSONLayers = {};
      if (!layers) return;
      layers.forEach(function(layerDef) {
        var geoLayer = L.geoJSON(layerDef.features, {
          style: {
            fillColor: layerDef.fillColor || '#1B5E20',
            fillOpacity: layerDef.fillOpacity || 0.15,
            color: layerDef.strokeColor || '#1B5E20',
            weight: layerDef.strokeWidth || 2,
            opacity: layerDef.strokeOpacity || 0.6,
          },
          onEachFeature: function(feature, featureLayer) {
            if (feature.properties && feature.properties.nombre) {
              featureLayer.bindPopup(feature.properties.nombre);
              featureLayer.on('mouseover', function() {
                featureLayer.setStyle({ fillOpacity: 0.35 });
              });
              featureLayer.on('mouseout', function() {
                featureLayer.setStyle({ fillOpacity: layerDef.fillOpacity || 0.15 });
              });
            }
          }
        }).addTo(map);
        window._geoJSONLayers[layerDef.id] = geoLayer;
      });
    };

    window._fitBounds = function(data) {
      var bounds = [];
      data.forEach(function(p) { bounds.push([p.lat, p.lng]); });
      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [40, 40] });
      }
    };

    window._setView = function(lat, lng, z) {
      map.setView([lat, lng], z, { animate: true });
    };

    ${interactive ? `
    map.on('click', function(e) {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        type: 'mapPress',
        latitud: e.latlng.lat,
        longitud: e.latlng.lng
      }));
    });` : ''}

    // Notificar que el mapa está listo
    window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'mapReady' }));
  </script>
</body>
</html>`;
  }, [mapStyle, interactive]);

  // Inyectar datos dinámicos cuando el WebView está listo o cambian
  const injectJS = useCallback((js: string) => {
    try {
      webViewRef.current?.injectJavaScript(js);
    } catch { /* WebView no disponible */ }
  }, []);

  useEffect(() => {
    if (!webViewReady) return;
    const data = markers.map(m => ({
      id: m.id, lat: m.latitud, lng: m.longitud,
      title: m.title, color: m.color, icon: m.icon,
    }));
    injectJS(`window._setMarkers(${JSON.stringify(data)});true;`);
  }, [webViewReady, markers, injectJS]);

  useEffect(() => {
    if (!webViewReady) return;
    const data = polyline
      ? polyline.map(p => ({ lat: p.latitud, lng: p.longitud }))
      : [];
    injectJS(`window._setPolyline(${JSON.stringify(data)});true;`);
  }, [webViewReady, polyline, injectJS]);

  useEffect(() => {
    if (!webViewReady) return;
    if (startMarker) {
      injectJS(`window._setStartMarker(${JSON.stringify({ lat: startMarker.latitud, lng: startMarker.longitud })});true;`);
    } else {
      injectJS(`window._setStartMarker(null);true;`);
    }
  }, [webViewReady, startMarker, injectJS]);

  useEffect(() => {
    if (!webViewReady) return;
    if (endMarker) {
      injectJS(`window._setEndMarker(${JSON.stringify({ lat: endMarker.latitud, lng: endMarker.longitud })});true;`);
    } else {
      injectJS(`window._setEndMarker(null);true;`);
    }
  }, [webViewReady, endMarker, injectJS]);

  useEffect(() => {
    if (!webViewReady) return;
    if (showUserLocation && userLocation) {
      injectJS(`window._setUserLocation(${JSON.stringify({ lat: userLocation.latitud, lng: userLocation.longitud })});true;`);
    } else if (showUserLocation && center) {
      // Fallback: usar center si no hay userLocation
      injectJS(`window._setUserLocation(${JSON.stringify({ lat: center.latitud, lng: center.longitud })});true;`);
    } else {
      injectJS(`window._setUserLocation(null);true;`);
    }
  }, [webViewReady, showUserLocation, userLocation, injectJS]);

  // Mover el centro del mapa SIN recargar el WebView completo
  useEffect(() => {
    if (!webViewReady || hasNativeModule || !center) return;
    injectJS(`window._setView(${center.latitud}, ${center.longitud}, ${zoom});true;`);
  }, [webViewReady, center, zoom, injectJS, hasNativeModule]);

  // Inyectar capas GeoJSON (veredas)
  useEffect(() => {
    if (!webViewReady || hasNativeModule) return;
    if (geojsonLayers && geojsonLayers.length > 0) {
      const data = geojsonLayers.map(l => ({
        id: l.id,
        fillColor: l.fillColor || '#1B5E20',
        fillOpacity: l.fillOpacity ?? 0.15,
        strokeColor: l.strokeColor || '#1B5E20',
        strokeWidth: l.strokeWidth || 2,
        strokeOpacity: l.strokeOpacity ?? 0.6,
        features: l.features,
      }));
      injectJS(`window._setGeoJSONLayers(${JSON.stringify(data)});true;`);
    } else {
      injectJS(`window._setGeoJSONLayers(null);true;`);
    }
  }, [webViewReady, geojsonLayers, injectJS, hasNativeModule]);

  // Fit bounds cuando hay polyline o start/end marker
  useEffect(() => {
    if (!webViewReady) return;
    const points: { lat: number; lng: number }[] = [];
    if (polyline && polyline.length > 1) {
      polyline.forEach(p => points.push({ lat: p.latitud, lng: p.longitud }));
    }
    if (startMarker) points.push({ lat: startMarker.latitud, lng: startMarker.longitud });
    if (endMarker) points.push({ lat: endMarker.latitud, lng: endMarker.longitud });
    if (points.length > 1) {
      injectJS(`window._fitBounds(${JSON.stringify(points)});true;`);
    }
  }, [webViewReady, polyline, startMarker, endMarker, injectJS]);

  const handleWebViewMessage = useCallback(
    (event: { nativeEvent: { data: string } }) => {
      try {
        const msg = JSON.parse(event.nativeEvent.data);
        if (msg.type === 'mapReady') {
          setWebViewReady(true);
        } else if (msg.type === 'mapPress' && onMapPress) {
          onMapPress(msg.latitud, msg.longitud);
        }
      } catch (e) {
        console.warn('[MapViewOffline] Error parsing WebView message:', e);
      }
    },
    [onMapPress]
  );

  // Si no hay módulo nativo, usar WebView (nativo) o iframe (web) con Leaflet + OpenStreetMap
  if (!hasNativeModule) {
    if (Platform.OS === 'web') {
      // Web: usar iframe con postMessage (WebView no soportado en web)
      // Hooks ya declarados arriba: webIframeRef, webIframeReady, postMsg, webSyncEffects

      // Nota: los efectos de sincronización están declarados arriba (postMsg, webSyncEffects)
      // junto con el listener de mensajes

      // Agregar listener en el HTML para recibir postMessage
      const webHtmlWithListener = webMapHtml.replace(
        '</script>',
        `
    window.addEventListener('message', function(e) {
      var data = e.data;
      if (!data || !data.type) return;
      switch(data.type) {
        case 'setMarkers': window._setMarkers(data.markers); break;
        case 'setPolyline': window._setPolyline(data.polyline); break;
        case 'setStartMarker': window._setStartMarker(data.data); break;
        case 'setEndMarker': window._setEndMarker(data.data); break;
        case 'setUserLocation': window._setUserLocation(data.data); break;
        case 'setView': window._setView(data.lat, data.lng, data.zoom); break;
        case 'setGeoJSONLayers': window._setGeoJSONLayers(data.layers); break;
        case 'fitBounds': window._fitBounds(data.points); break;
      }
    });
    window.addEventListener('load', function() {
      window.parent.postMessage(JSON.stringify({ type: 'mapReady' }), '*');
    });
    if (document.readyState === 'complete') {
      window.parent.postMessage(JSON.stringify({ type: 'mapReady' }), '*');
    }
  </script>`
      );

      return (
        <View style={containerStyle}>
          <iframe
            ref={webIframeRef}
            srcDoc={webHtmlWithListener}
            style={{ width: '100%', height: '100%', border: 'none' }}
            title="Mapa GEODAILY"
          />
        </View>
      );
    }

    // Nativo: WebView con Leaflet + OpenStreetMap
    return (
      <View style={containerStyle}>
        <WebView
          ref={webViewRef}
          style={styles.webView}
          originWhitelist={['*']}
          source={{ html: webMapHtml }}
          scrollEnabled={false}
          onMessage={handleWebViewMessage}
          javaScriptEnabled={true}
          domStorageEnabled={true}
        />
      </View>
    );
  }

  const { MapView: MLMapView, Camera: MLCamera, PointAnnotation: MLAnnotation, UserLocation: MLUserLocation } = MapLibreGL;

  return (
    <View style={containerStyle}>
      <MLMapView
        style={StyleSheet.absoluteFill}
        styleURL={MAP_STYLES[mapStyle]}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        zoomEnabled={interactive}
        scrollEnabled={interactive}
        rotateEnabled={interactive}
        onDidFinishLoadingMap={() => setIsLoaded(true)}
        onPress={
          onMapPress
            ? (e: any) => {
                const geometry = e?.geometry || e?.nativeEvent?.geometry;
                if (geometry) {
                  onMapPress(geometry.coordinates[1], geometry.coordinates[0]);
                }
              }
            : undefined
        }
      >
        {/* Cámara inicial */}
        <MLCamera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: center
              ? [center.longitud, center.latitud]
              : [-74.072, 4.711],
            zoomLevel: zoom,
          }}
        />

        {/* Ubicación del usuario */}
        {showUserLocation && <MLUserLocation visible={true} />}

        {/* Polilínea de ruta (tracking GPS) */}
        {polyline && polyline.length > 1 && (
          <MapLibreGL.ShapeSource
            id="rutaSource"
            shape={{
              type: 'Feature',
              properties: {},
              geometry: {
                type: 'LineString',
                coordinates: polyline.map((p) => [p.longitud, p.latitud]),
              },
            }}
          >
            <MapLibreGL.LineLayer
              id="rutaLine"
              style={{
                lineColor: '#1B5E20',
                lineWidth: 4,
                lineOpacity: 0.8,
                lineCap: 'round',
                lineJoin: 'round',
              }}
            />
          </MapLibreGL.ShapeSource>
        )}

        {/* Capas GeoJSON (veredas, polígonos) — solo MapLibre nativo */}
        {geojsonLayers && geojsonLayers.map((layer) => (
          <MapLibreGL.ShapeSource
            key={layer.id}
            id={`geojson-${layer.id}`}
            shape={{
              type: 'FeatureCollection',
              features: layer.features,
            }}
          >
            <MapLibreGL.FillLayer
              id={`geojson-fill-${layer.id}`}
              style={{
                fillColor: layer.fillColor || '#1B5E20',
                fillOpacity: layer.fillOpacity ?? 0.15,
                fillOutlineColor: layer.strokeColor || '#1B5E20',
              }}
            />
            <MapLibreGL.LineLayer
              id={`geojson-line-${layer.id}`}
              style={{
                lineColor: layer.strokeColor || '#1B5E20',
                lineWidth: layer.strokeWidth || 2,
                lineOpacity: layer.strokeOpacity ?? 0.6,
              }}
            />
          </MapLibreGL.ShapeSource>
        ))}

        {/* Marcador de inicio de ruta */}
        {startMarker && (
          <MLAnnotation
            id="startMarker"
            coordinate={[startMarker.longitud, startMarker.latitud]}
          >
            <View style={styles.markerContainer}>
              <View style={[styles.markerDot, { backgroundColor: '#4CAF50', width: 16, height: 16 }]} />
            </View>
          </MLAnnotation>
        )}

        {/* Marcador de posición actual / final de ruta */}
        {endMarker && (
          <MLAnnotation
            id="endMarker"
            coordinate={[endMarker.longitud, endMarker.latitud]}
          >
            <View style={styles.markerContainer}>
              <View style={[styles.markerDot, { backgroundColor: '#2196F3', width: 16, height: 16 }]} />
            </View>
          </MLAnnotation>
        )}

        {/* Marcadores */}
        {markers.map((m) => (
          <MLAnnotation
            key={m.id}
            id={m.id}
            coordinate={[m.longitud, m.latitud]}
            onSelected={() => onMarkerPress?.(m.id)}
          >
            <View style={styles.markerContainer}>
              {m.icon ? (
                <Text style={{ fontSize: 22 }}>{m.icon}</Text>
              ) : (
                <View
                  style={[
                    styles.markerDot,
                    { backgroundColor: m.color || COLORS.primary },
                  ]}
                />
              )}
            </View>
          </MLAnnotation>
        ))}
      </MLMapView>

      {/* Overlay de carga */}
      {!isLoaded && (
        <View style={styles.loadingOverlay}>
          <ActivityIndicator size="large" color={COLORS.primary} />
          <Text style={styles.loadingText}>Cargando mapa offline...</Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    width: '100%',
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceAlt,
  },
  containerFlex: {
    flex: 1,
    width: '100%',
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    backgroundColor: COLORS.surfaceAlt,
  },
  // --- WebView (Fallback Leaflet + OSM) ---
  webView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  // --- Carga ---
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.8)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: SPACING.sm,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  // --- Marcadores ---
  markerContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    width: 24,
    height: 24,
  },
  markerDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: '#FFFFFF',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.3,
    shadowRadius: 2,
    elevation: 3,
  },
});

export default MapViewOffline;
