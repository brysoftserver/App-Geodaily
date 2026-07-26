// ============================================================
// GEODAILY — Mapa Offline con MapLibre GL
// ============================================================
// Con el dev client (módulo nativo de MapLibre compilado), este mapa usa
// teselas raster reales (CartoDB/Esri) y soporta descarga real para uso sin
// conexión vía OfflineManager (ver src/services/offlineMap.service.ts y el
// botón ⬇️ en MapaScreen.tsx) — el técnico descarga la zona con señal antes
// de salir a campo. Sin ese módulo nativo (ej. Expo Go), cae al fallback
// WebView/Leaflet de más abajo, que siempre depende de internet.
//
// El estilo definido aquí (MAP_STYLE_RELIEVE/SATELITE) debe coincidir
// exactamente con el que sirve backend/src/routes/maps.js en
// GET /api/maps/style/:tipo — es lo que OfflineManager descarga; si
// difieren, las teselas cacheadas no calzan con lo que se renderiza.
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, NativeModules, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import Svg, { Path, Circle } from 'react-native-svg';
import NetInfo from '@react-native-community/netinfo';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../theme';
import { Coordenadas } from '../types';

/** Pin de mapa clásico (gota + punto blanco), tamaño 28×36, usado por markers con tipoIcono:'pin'. */
const PinIcon: React.FC<{ color: string }> = ({ color }) => (
  <Svg width={28} height={36} viewBox="0 0 28 36">
    <Path
      d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.268 21.732 0 14 0z"
      fill={color}
    />
    <Circle cx={14} cy={14} r={6} fill="#FFFFFF" />
  </Svg>
);

// Nota: el equivalente para el fallback WebView/Leaflet vive como JS de
// cliente embebido en `webMapHtml` (window._pinSvgHtml) — no se puede
// reusar esta función de React Native ahí porque corre en un contexto de
// JS completamente aislado (el WebView/iframe), sin acceso al bundle RN.

// Carga condicional de MapLibre (fallback si no hay módulo nativo)
// En Expo Go, el módulo JS se carga pero el native module no está registrado.
// Usamos NativeModules para verificar limpiamente, sin mutar console.error.
let MapLibreGL: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
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
  /** 'pin' dibuja un pin de mapa clásico (gota + punto blanco) en vez de emoji/círculo, coloreado con `color`. */
  tipoIcono?: 'pin';
  /** Si es true, el técnico puede mantener presionado el marcador y arrastrarlo a una nueva posición (ver `onMarkerDragEnd`). */
  draggable?: boolean;
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
    features: Record<string, any>[];
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
  /** Se dispara cuando se suelta un marcador `draggable` — trae su nueva posición. */
  onMarkerDragEnd?: (id: string, coords: { latitud: number; longitud: number }) => void;
  onMapPress?: (latitud: number, longitud: number) => void;
  /**
   * Centrado puntual "de una sola vez", independiente del seguimiento
   * continuo de `center`: cuando `nonce` cambia, la cámara se mueve a
   * `coords` SIN tocar el zoom actual (a diferencia de `center`, que
   * siempre reimpone `zoom`). Pensado para un botón "Centrar" manual en
   * pantallas donde el técnico está haciendo zoom/pan de precisión (medir,
   * contar) y no quiere que la cámara se resetee sola.
   */
  foco?: { coords: Coordenadas; nonce: number } | null;
}

// ============================================================
// ESTILOS DE MAPA
// ============================================================

// Estilo: Relieve — raster CartoDB Positron.
// IMPORTANTE: debe ser exactamente el mismo estilo (misma fuente/URL de
// teselas) que backend/src/routes/maps.js sirve en GET /api/maps/style/relieve,
// que es lo que OfflineManager.createPack() descarga para uso sin conexión —
// si difieren, las teselas cacheadas offline no coinciden con las que este
// componente pide al renderizar, y el mapa se ve en blanco igual estando
// "descargado". Antes esta capa tenía además una fuente vectorial que
// apuntaba a una ruta backend inexistente (/tesela) y una capa "background"
// opaca que tapaba por completo el raster — ambas eliminadas.
const MAP_STYLE_RELIEVE = {
  version: 8 as const,
  name: 'GEODAILY - Relieve',
  sources: {
    'carto-positron': {
      type: 'raster' as const,
      // Sin {r}: es una convención de Leaflet que MapLibre nativo NO
      // sustituye (la enviaría literal en la URL).
      tiles: ['https://a.basemaps.cartocdn.com/light_all/{z}/{x}/{y}.png'],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors, © CARTO',
    },
  },
  layers: [
    { id: 'carto-bg', source: 'carto-positron', type: 'raster' as const, paint: { 'raster-opacity': 1 } },
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
  onMarkerDragEnd,
  onMapPress,
  foco,
}) => {
  const cameraRef = useRef<Record<string, any> | null>(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const hasNativeModule = !!MapLibreGL;

  // Estado de conectividad — en el mapa nativo (con módulo MapLibre) no hay
  // forma sencilla de detectar si una tesela falló al cargar, así que
  // avisamos directamente cuando el dispositivo está offline: si el técnico
  // descargó el área con antelación (OfflineManager), el mapa se ve igual;
  // si no, es la señal más honesta de que puede verse incompleto.
  const [isOffline, setIsOffline] = useState(false);
  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      setIsOffline(!(state.isConnected && state.isInternetReachable !== false));
    });
    return () => unsubscribe();
  }, []);

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

  // Centrado puntual (botón "Centrar"): mueve la cámara SIN incluir
  // zoomLevel, así MapLibre conserva el nivel de zoom que el técnico ya
  // tenía — a diferencia del efecto de arriba, que siempre reimpone `zoom`.
  useEffect(() => {
    if (isLoaded && cameraRef.current && foco) {
      cameraRef.current.setCamera({
        centerCoordinate: [foco.coords.longitud, foco.coords.latitud],
        animationDuration: 500,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [foco?.nonce, isLoaded]);

  // ========================================================
  // WebView + Leaflet (Fallback para Expo Go / Testing)
  // ========================================================
  const webViewRef = useRef<WebView>(null);
  const [webViewReady, setWebViewReady] = useState(false);

  // Web: iframe ref + ready state
  const webIframeRef = useRef<HTMLIFrameElement>(null);
  const [webIframeReady, setWebIframeReady] = useState(false);

  // Fallback (WebView/iframe) depende 100% de internet (Leaflet + teselas
  // externas) — si no carga en unos segundos, lo más probable es que no
  // haya conexión. Mostrar un aviso claro en vez de dejar la pantalla en
  // blanco sin explicación.
  const [webLoadTimedOut, setWebLoadTimedOut] = useState(false);
  useEffect(() => {
    if (hasNativeModule) return; // no aplica al mapa nativo
    setWebLoadTimedOut(false);
    const timeout = setTimeout(() => setWebLoadTimedOut(true), 8000);
    return () => clearTimeout(timeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasNativeModule, mapStyle]);

  // Web: comunicación con el iframe vía postMessage
  const postMsg = useCallback((data: Record<string, any>) => {
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
        } else if (msg.type === 'markerPress' && onMarkerPress) {
          onMarkerPress(msg.id);
        } else if (msg.type === 'markerDragEnd' && onMarkerDragEnd) {
          onMarkerDragEnd(msg.id, { latitud: msg.lat, longitud: msg.lng });
        }
      } catch { /* ignorar mensajes no JSON */ }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onMapPress, onMarkerPress, onMarkerDragEnd]);

  // Web: sincronizar marcadores
  useEffect(() => {
    if (Platform.OS !== 'web' || !webIframeReady) return;
    postMsg({ type: 'setMarkers', markers: markers.map(m => ({ id: m.id, lat: m.latitud, lng: m.longitud, title: m.title, color: m.color, icon: m.icon, tipoIcono: m.tipoIcono, draggable: m.draggable, onClickMsg: !!onMarkerPress })) });
  }, [webIframeReady, markers, postMsg, onMarkerPress]);

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

  // Web: centrado puntual sin zoom (botón "Centrar")
  useEffect(() => {
    if (Platform.OS !== 'web' || !webIframeReady || !foco) return;
    postMsg({ type: 'centrarSinZoom', lat: foco.coords.latitud, lng: foco.coords.longitud });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webIframeReady, foco?.nonce, postMsg]);

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

    window._pinSvgHtml = function(color) {
      return '<svg width="28" height="36" viewBox="0 0 28 36" xmlns="http://www.w3.org/2000/svg">'
        + '<path d="M14 0C6.268 0 0 6.268 0 14c0 10.5 14 22 14 22s14-11.5 14-22C28 6.268 21.732 0 14 0z" fill="' + color + '"/>'
        + '<circle cx="14" cy="14" r="6" fill="#FFFFFF"/>'
        + '</svg>';
    };

    window._setMarkers = function(data) {
      Object.values(window._markers).forEach(function(l) { map.removeLayer(l); });
      window._markers = {};
      data.forEach(function(m) {
        var layer;
        if (m.tipoIcono === 'pin') {
          layer = L.marker([m.lat, m.lng], {
            draggable: !!m.draggable,
            icon: L.divIcon({
              html: window._pinSvgHtml(m.color || '#1B5E20'),
              className: '',
              iconSize: [28, 36],
              iconAnchor: [14, 36]
            })
          }).addTo(map);
        } else if (m.icon) {
          layer = L.marker([m.lat, m.lng], {
            draggable: !!m.draggable,
            icon: L.divIcon({
              html: '<span style="font-size:24px;line-height:1">' + m.icon + '</span>',
              className: '',
              iconSize: [24, 24],
              iconAnchor: [12, 12]
            })
          }).addTo(map);
        } else if (m.draggable) {
          // L.circleMarker no soporta arrastre (no tiene el handler Draggable
          // de Leaflet) — para un punto simple que se pueda mover, se usa un
          // L.marker con un divIcon que dibuja el mismo círculo de color.
          layer = L.marker([m.lat, m.lng], {
            draggable: true,
            icon: L.divIcon({
              html: '<div style="width:16px;height:16px;border-radius:50%;background:' + (m.color || '#1B5E20') + ';border:2px solid #fff;box-shadow:0 1px 2px rgba(0,0,0,0.35);"></div>',
              className: '',
              iconSize: [16, 16],
              iconAnchor: [8, 8]
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
        if (m.draggable) {
          layer.on('dragend', function(e) {
            var pos = e.target.getLatLng();
            window.ReactNativeWebView.postMessage(JSON.stringify({ type: 'markerDragEnd', id: m.id, lat: pos.lat, lng: pos.lng }));
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

    // Centrado puntual sin tocar el zoom (botón "Centrar" manual) — panTo
    // mueve la cámara conservando el nivel de zoom actual del técnico.
    window._centrarSinZoom = function(lat, lng) {
      map.panTo([lat, lng], { animate: true });
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
      tipoIcono: m.tipoIcono, draggable: m.draggable, onClickMsg: !!onMarkerPress,
    }));
    injectJS(`window._setMarkers(${JSON.stringify(data)});true;`);
  }, [webViewReady, markers, injectJS, onMarkerPress]);

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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webViewReady, showUserLocation, userLocation, injectJS]);

  // Mover el centro del mapa SIN recargar el WebView completo
  useEffect(() => {
    if (!webViewReady || hasNativeModule || !center) return;
    injectJS(`window._setView(${center.latitud}, ${center.longitud}, ${zoom});true;`);
  }, [webViewReady, center, zoom, injectJS, hasNativeModule]);

  // Centrado puntual sin zoom (botón "Centrar")
  useEffect(() => {
    if (!webViewReady || hasNativeModule || !foco) return;
    injectJS(`window._centrarSinZoom(${foco.coords.latitud}, ${foco.coords.longitud});true;`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webViewReady, foco?.nonce, injectJS, hasNativeModule]);

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
        } else if (msg.type === 'markerPress' && onMarkerPress) {
          onMarkerPress(msg.id);
        } else if (msg.type === 'markerDragEnd' && onMarkerDragEnd) {
          onMarkerDragEnd(msg.id, { latitud: msg.lat, longitud: msg.lng });
        }
      } catch (e) {
        console.warn('[MapViewOffline] Error parsing WebView message:', e);
      }
    },
    [onMapPress, onMarkerPress, onMarkerDragEnd]
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
    // Shim: en el iframe web no existe window.ReactNativeWebView (eso solo
    // lo inyecta el WebView nativo) — sin esto, el click de un marcador
    // (que llama a window.ReactNativeWebView.postMessage) fallaba en
    // silencio y onMarkerPress nunca se disparaba en la vista web.
    if (!window.ReactNativeWebView) {
      window.ReactNativeWebView = { postMessage: function(data) { window.parent.postMessage(data, '*'); } };
    }
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
        case 'centrarSinZoom': window._centrarSinZoom(data.lat, data.lng); break;
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
          {webLoadTimedOut && !webIframeReady && (
            <View style={styles.offlineOverlay} pointerEvents="none">
              <Text style={styles.offlineOverlayIcon}>📡</Text>
              <Text style={styles.offlineOverlayText}>Sin conexión</Text>
              <Text style={styles.offlineOverlaySubtext}>No se pudo cargar el mapa ni hay un mapa descargado para esta zona. Verifica tu conexión a internet.</Text>
            </View>
          )}
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
        {webLoadTimedOut && !webViewReady && (
          <View style={styles.offlineOverlay} pointerEvents="none">
            <Text style={styles.offlineOverlayIcon}>📡</Text>
            <Text style={styles.offlineOverlayText}>Sin conexión</Text>
            <Text style={styles.offlineOverlaySubtext}>No se pudo cargar el mapa ni hay un mapa descargado para esta zona. Verifica tu conexión a internet.</Text>
          </View>
        )}
      </View>
    );
  }

  const { MapView: MLMapView, Camera: MLCamera, PointAnnotation: MLAnnotation, UserLocation: MLUserLocation } = MapLibreGL;

  return (
    <View style={containerStyle}>
      <MLMapView
        style={StyleSheet.absoluteFill}
        mapStyle={MAP_STYLES[mapStyle]}
        logoEnabled={false}
        attributionEnabled={false}
        compassEnabled={false}
        zoomEnabled={interactive}
        scrollEnabled={interactive}
        rotateEnabled={interactive}
        onDidFinishLoadingMap={() => setIsLoaded(true)}
        onPress={
          onMapPress
            ? (e: Record<string, any>) => {
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
            anchor={m.tipoIcono === 'pin' ? { x: 0.5, y: 1 } : undefined}
            draggable={m.draggable}
            onDragEnd={
              m.draggable
                ? (e: Record<string, any>) => {
                    const geometry = e?.geometry || e?.nativeEvent?.geometry;
                    if (geometry?.coordinates) {
                      onMarkerDragEnd?.(m.id, {
                        latitud: geometry.coordinates[1],
                        longitud: geometry.coordinates[0],
                      });
                    }
                  }
                : undefined
            }
          >
            <View style={m.tipoIcono === 'pin' ? styles.pinContainer : styles.markerContainer}>
              {m.tipoIcono === 'pin' ? (
                <PinIcon color={m.color || COLORS.primary} />
              ) : m.icon ? (
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

      {/* Aviso discreto de conectividad — si el área fue descargada antes
          (OfflineManager) el mapa se sigue viendo igual; esto es solo
          informativo, no bloquea el mapa como en el fallback WebView */}
      {isLoaded && isOffline && (
        <View style={styles.offlineBanner} pointerEvents="none">
          <Text style={styles.offlineBannerText}>📡 Sin conexión — si descargaste este mapa antes, se sigue viendo</Text>
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
  offlineOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(255,255,255,0.95)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  offlineOverlayIcon: {
    fontSize: 40,
    marginBottom: SPACING.sm,
  },
  offlineOverlayText: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  offlineOverlaySubtext: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  offlineBanner: {
    position: 'absolute',
    bottom: SPACING.sm,
    left: SPACING.sm,
    right: SPACING.sm,
    backgroundColor: 'rgba(0,0,0,0.75)',
    borderRadius: BORDER_RADIUS.sm,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
  },
  offlineBannerText: {
    color: '#fff',
    fontSize: FONTS.sizes.xs,
    textAlign: 'center',
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
  pinContainer: {
    width: 28,
    height: 36,
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
