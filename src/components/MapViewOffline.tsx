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
// Los estilos definidos aquí (MAP_STYLE_TERRENO / MAP_STYLE_SATELITE /
// MAP_STYLE_SATELITE_RECIENTE) deben coincidir exactamente con los que sirve
// backend/src/routes/maps.js en GET /api/maps/style/:tipo — es lo que
// OfflineManager descarga; si difieren, las teselas cacheadas no calzan con
// lo que se renderiza.
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, NativeModules, Platform } from 'react-native';
import { WebView } from 'react-native-webview';
import Svg, { Path, Circle } from 'react-native-svg';
import NetInfo from '@react-native-community/netinfo';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../theme';
import { Coordenadas } from '../types';

// ============================================================
// VALIDACIÓN DE COORDENADAS
// ============================================================
// Caja envolvente de Colombia (con margen). Cualquier punto fuera de aquí es
// un dato corrupto: en la base real hay 9 mediciones con vértices en Madrid
// (lat ≈ 40.4, lng ≈ -3.7) que hacían que `fitBounds` encuadrara medio
// Atlántico y el mapa pareciera vacío/roto al seleccionar a ese técnico.
const COORD_BOUNDS = { minLat: -5, maxLat: 14, minLng: -82, maxLng: -66 };

/** true si la coordenada es un número finito y cae dentro de Colombia. */
export const esCoordenadaValida = (lat: unknown, lng: unknown): boolean =>
  typeof lat === 'number' && typeof lng === 'number' &&
  Number.isFinite(lat) && Number.isFinite(lng) &&
  lat >= COORD_BOUNDS.minLat && lat <= COORD_BOUNDS.maxLat &&
  lng >= COORD_BOUNDS.minLng && lng <= COORD_BOUNDS.maxLng;

/** Filtra una lista de puntos dejando solo los que están dentro de Colombia. */
export const filtrarPuntosValidos = <T extends { latitud: number; longitud: number }>(puntos: T[]): T[] =>
  (puntos || []).filter((p) => esCoordenadaValida(p?.latitud, p?.longitud));

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
  /** Si es true, el `icon` se pinta con `color` y un halo blanco (útil para glifos como ◈). */
  iconColoreado?: boolean;
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
  /**
   * Tipo de mapa base:
   * - `terreno`: Esri World Topo Map (relieve + curvas de nivel + drenajes + vías).
   *   Se muestra como «Terreno/Calles».
   * - `satelite`: Esri World Imagery (satélite nítido, ~0.5 m, hasta zoom 18)
   * - `satelite-reciente`: Sentinel-2 cloudless 2025 (imagen reciente, ~10 m/píxel).
   *   Se muestra como «Satélite Relieve».
   */
  mapStyle?: 'terreno' | 'satelite' | 'satelite-reciente';
  /** Array de puntos para dibujar una polyline (ruta GPS) */
  polyline?: { latitud: number; longitud: number }[];
  /** Color de la polyline (por defecto verde #1B5E20). Usar naranja/amarillo en terreno con bosque. */
  polylineColor?: string;
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
  /** Se dispara al tocar una feature de una capa GeoJSON (ej: un polígono de vereda). */
  onFeaturePress?: (layerId: string, properties: Record<string, any>) => void;
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
  /**
   * Reset explícito de cámara (botón "Puerto Rico"): cuando `nonce` cambia,
   * se aplica `center` + `zoom` IGNORANDO el hecho de que el usuario haya
   * hecho zoom/pan manual. Sin esto, el reset no tendría efecto una vez que
   * el usuario exploró el mapa.
   */
  resetNonce?: number;
  /**
   * Encuadre automático de un conjunto de puntos (ej: los polígonos de las
   * mediciones de los técnicos seleccionados). Cuando `nonce` cambia, la
   * cámara se ajusta para que TODOS los puntos queden visibles. Es
   * independiente de `center`/`zoom` y no se re-aplica en cada render.
   */
  fitBounds?: { points: Coordenadas[]; nonce: number } | null;
  /**
   * Recentrado puntual SIN tocar el zoom (botón "Centrar" del mapa general).
   * Cuando `nonce` cambia, la cámara se mueve a `coords` conservando el nivel
   * de zoom que el usuario tenía. Es el equivalente de `foco` para el mapa
   * general, donde el centro es la ubicación GPS y no debe reimponer zoom.
   */
  recentrar?: { coords: Coordenadas; nonce: number } | null;
}

// ============================================================
// ESTILOS DE MAPA
// ============================================================

// Estilo: Terreno/Calles — raster OpenStreetMap (tile.openstreetmap.org).
// Los cascos urbanos y las vías se ven mucho mejor que con Esri Topo, que es
// la razón por la que se cambió. Contra conocida y aceptada: en zona rural
// de Caquetá OSM no tiene datos por encima de zoom ~15 (verificado: teselas
// de 103 bytes = PNG vacío en z16–z18), así que al acercar mucho el mapa se
// ve borroso (Leaflet estira la última tesela buena) en vez de blanco.
// Debe coincidir con backend/src/routes/maps.js GET /api/maps/style/terreno.
const MAP_STYLE_TERRENO = {
  version: 8 as const,
  name: 'GEODAILY - Terreno/Calles (OpenStreetMap)',
  sources: {
    osm: {
      type: 'raster' as const,
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 19,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [
    { id: 'osm-bg', source: 'osm', type: 'raster' as const, paint: { 'raster-opacity': 1 } },
  ],
};

// Estilo: Satélite HD — raster Esri World Imagery.
// Es el satélite NÍTIDO: ~0.5 m/píxel y con datos hasta zoom 18, así que al
// acercar a nivel de potrero/lote se sigue viendo definido (a diferencia de
// Sentinel-2, que a ~10 m/píxel se ve borroso desde zoom 15). Contra: en
// Puerto Rico, Caquetá la imagen es de ENERO 2020 (verificado con el endpoint
// /identify del MapServer: DATE 20200104, RESOLUTION 0.5, WV02). Debe
// coincidir con backend/src/routes/maps.js GET /api/maps/style/satelite.
const MAP_STYLE_SATELITE = {
  version: 8 as const,
  name: 'GEODAILY - Satélite HD (Esri World Imagery)',
  sources: {
    'esri-imagery': {
      type: 'raster' as const,
      tiles: ['https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}'],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 18,
      attribution: '© Esri, Maxar, Earthstar Geographics',
    },
  },
  layers: [
    { id: 'esri-imagery-bg', source: 'esri-imagery', type: 'raster' as const, paint: { 'raster-opacity': 1 } },
  ],
};

// Estilo: Satélite Relieve — Sentinel-2 cloudless 2025 (EOX).
// Se refresca cada año, así que sirve para ver cambios de cobertura recientes
// (potreros nuevos, rastrojos, tala). Contra: ~10 m/píxel — al acercar a
// nivel de lote se ve borroso porque el servidor no tiene más detalle y el
// cliente termina estirando la misma tesela. Debe coincidir con
// backend/src/routes/maps.js GET /api/maps/style/satelite-reciente.
const MAP_STYLE_SATELITE_RECIENTE = {
  version: 8 as const,
  name: 'GEODAILY - Satélite Relieve (Sentinel-2 2025)',
  sources: {
    's2cloudless': {
      type: 'raster' as const,
      tiles: ['https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg'],
      tileSize: 256,
      minzoom: 0,
      maxzoom: 16,
      attribution: 'Sentinel-2 cloudless 2025 © EOX IT Services GmbH (CC BY-NC-SA 4.0)',
    },
  },
  layers: [
    { id: 's2cloudless-bg', source: 's2cloudless', type: 'raster' as const, paint: { 'raster-opacity': 1 } },
  ],
};

const MAP_STYLES = {
  terreno: MAP_STYLE_TERRENO,
  satelite: MAP_STYLE_SATELITE,
  'satelite-reciente': MAP_STYLE_SATELITE_RECIENTE,
};

/**
 * Tesela + límites de zoom de cada mapa base para el fallback Leaflet.
 * `maxNativeZoom` es el último zoom que el servidor realmente tiene: por
 * encima de eso Leaflet estira la última tesela (mapa borroso). Antes estaba
 * fijo en 16 para todos, lo que desperdiciaba el detalle de Esri hasta 18.
 */
const WEB_TILE_CONFIG: Record<
  'terreno' | 'satelite' | 'satelite-reciente',
  { url: string; attribution: string; maxZoom: number; maxNativeZoom: number }
> = {
  terreno: {
    // OpenStreetMap. maxNativeZoom 15: por encima de ese zoom OSM no tiene
    // datos en la zona rural de Puerto Rico (Caquetá) y devuelve teselas
    // vacías — con 15 Leaflet estira la última buena y el mapa queda
    // borroso pero visible en vez de blanco.
    url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '© OpenStreetMap contributors',
    maxZoom: 19,
    maxNativeZoom: 15,
  },
  satelite: {
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: '© Esri, Maxar, Earthstar Geographics',
    maxZoom: 19,
    maxNativeZoom: 18,
  },
  'satelite-reciente': {
    url: 'https://tiles.maps.eox.at/wmts/1.0.0/s2cloudless-2025_3857/default/g/{z}/{y}/{x}.jpg',
    attribution: 'Sentinel-2 cloudless 2025 © EOX IT Services GmbH',
    maxZoom: 16,
    maxNativeZoom: 16,
  },
};

const MapViewOffline: React.FC<MapViewOfflineProps> = ({
  center,
  zoom = 14,
  height = 300,
  markers = [],
  mapStyle = 'terreno',
  polyline,
  polylineColor,
  startMarker,
  endMarker,
  showUserLocation = false,
  userLocation,
  geojsonLayers,
  interactive = true,
  onMarkerPress,
  onFeaturePress,
  onMarkerDragEnd,
  onMapPress,
  foco,
  resetNonce,
  fitBounds,
  recentrar,
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

  // Recentrado sin zoom (mapa general): mismo comportamiento que `foco` pero
  // con un prop propio para no mezclar semánticas.
  useEffect(() => {
    if (isLoaded && cameraRef.current && recentrar) {
      cameraRef.current.setCamera({
        centerCoordinate: [recentrar.coords.longitud, recentrar.coords.latitud],
        animationDuration: 500,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentrar?.nonce, isLoaded]);

  // Encuadre automático (ej: mediciones de los técnicos seleccionados).
  // Se calcula el bounding box de los puntos y se centra la cámara con un
  // zoom aproximado según el tamaño del área. Solo corre cuando cambia el
  // `nonce`, para no pelear con el zoom/pan manual del usuario.
  useEffect(() => {
    if (!isLoaded || !cameraRef.current || !fitBounds) return;
    // Solo puntos dentro de Colombia: un vértice corrupto (p. ej. en Madrid)
    // estiraba el bounding box hasta medio Atlántico y el mapa abría en
    // zoom 3 sin mostrar nada útil.
    const pts = filtrarPuntosValidos(fitBounds.points || []);
    if (pts.length === 0) return;
    let minLat = pts[0].latitud, maxLat = pts[0].latitud;
    let minLng = pts[0].longitud, maxLng = pts[0].longitud;
    pts.forEach((p) => {
      if (p.latitud < minLat) minLat = p.latitud;
      if (p.latitud > maxLat) maxLat = p.latitud;
      if (p.longitud < minLng) minLng = p.longitud;
      if (p.longitud > maxLng) maxLng = p.longitud;
    });
    const centerLat = (minLat + maxLat) / 2;
    const centerLng = (minLng + maxLng) / 2;
    const span = Math.max(maxLat - minLat, maxLng - minLng);
    // Aproximación: ~0.02° de span ≈ zoom 13; cada duplicación del span
    // baja un nivel de zoom. Se acota entre 8 y 17.
    const zoomLevel = span <= 0
      ? 16
      : Math.min(17, Math.max(8, Math.round(13 - Math.log2(span / 0.02))));
    cameraRef.current.setCamera({
      centerCoordinate: [centerLng, centerLat],
      zoomLevel,
      animationDuration: 600,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitBounds?.nonce, isLoaded]);

  // ========================================================
  // WebView + Leaflet (Fallback para Expo Go / Testing)
  // ========================================================
  const webViewRef = useRef<WebView>(null);
  const [webViewReady, setWebViewReady] = useState(false);

  // Web: iframe ref + ready state
  const webIframeRef = useRef<HTMLIFrameElement>(null);
  // Contador de generación del iframe. El iframe se RECREA cada vez que
  // cambia el mapa base (el srcDoc cambia), así que un booleano "listo"
  // no sirve: al pasar de false→true en el mismo tick React 18 agrupa las
  // actualizaciones y el estado no cambia → los efectos de sincronización
  // no se volvían a ejecutar y el mapa nuevo quedaba SIN capas (técnicos,
  // mediciones, etc.). Con un contador que siempre incrementa, cada
  // `mapReady` garantiza que los efectos se re-ejecuten.
  const [iframeGen, setIframeGen] = useState(0);
  const webIframeReady = iframeGen > 0;

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

  // Cámara que el usuario tenía ANTES de recrear el iframe (cambio de mapa
  // base). El iframe se destruye y se crea de nuevo, así que Leaflet pierde
  // el centro/zoom que el usuario había elegido. Se guarda aquí y se
  // restaura en el primer `mapReady` del iframe nuevo.
  const camaraPreviaRef = useRef<{ lat: number; lng: number; zoom: number } | null>(null);

  // Web: reenvía TODO el estado al documento del iframe. Se llama en cada
  // `mapReady` (el iframe se recrea al cambiar de mapa base) y también desde
  // los efectos de sincronización. Usa refs para leer siempre los valores
  // más recientes sin depender de que React vuelva a ejecutar los efectos.
  const syncAllRef = useRef<() => void>(() => {});
  syncAllRef.current = () => {
    if (Platform.OS !== 'web') return;
    postMsg({ type: 'setMarkers', markers: markers.map(m => ({ id: m.id, lat: m.latitud, lng: m.longitud, title: m.title, color: m.color, icon: m.icon, iconColoreado: m.iconColoreado, tipoIcono: m.tipoIcono, draggable: m.draggable, onClickMsg: !!onMarkerPress })) });
    postMsg({ type: 'setPolyline', polyline: polyline?.map(p => ({ lat: p.latitud, lng: p.longitud })) || [], color: polylineColor });
    postMsg({ type: 'setStartMarker', data: startMarker ? { lat: startMarker.latitud, lng: startMarker.longitud } : null });
    postMsg({ type: 'setEndMarker', data: endMarker ? { lat: endMarker.latitud, lng: endMarker.longitud } : null });
    postMsg({ type: 'setGeoJSONLayers', layers: (geojsonLayers || []).map(l => ({
      id: l.id,
      fillColor: l.fillColor || '#1B5E20',
      fillOpacity: l.fillOpacity ?? 0.15,
      strokeColor: l.strokeColor || '#1B5E20',
      strokeWidth: l.strokeWidth || 2,
      strokeOpacity: l.strokeOpacity ?? 0.6,
      features: l.features,
    })) });
    const loc = userLocation || center;
    if (loc) postMsg({ type: 'setUserLocation', data: { lat: loc.latitud, lng: loc.longitud } });

    // Cámara: si venimos de un cambio de mapa base, se restaura EXACTAMENTE
    // la vista que el usuario tenía (centro + zoom). Antes se enviaba
    // `resetView` con el centro/zoom por defecto y luego `fitBounds`, lo que
    // producía dos saltos visibles (zoom 13 → 10 → 13) cada vez que se
    // cambiaba entre Terreno/Calles, Satélite HD y Satélite Relieve.
    //
    // La cámara NO se consume aquí: el iframe emite `mapReady` varias veces
    // (load, readyState, retry 300/900 ms) y los efectos con `iframeGen`
    // vuelven a llamar a `syncAll`. Si se anulara en la primera llamada, las
    // siguientes reenviaban `resetView` + `fitBounds` y el mapa saltaba de
    // nuevo. Se mantiene hasta que el usuario interactúe con el mapa.
    const camara = camaraPreviaRef.current;
    if (camara) {
      postMsg({ type: 'restaurarCamara', lat: camara.lat, lng: camara.lng, zoom: camara.zoom });
      return; // no se re-encuadra: se respeta la vista del usuario
    }

    if (center) postMsg({ type: 'resetView', lat: center.latitud, lng: center.longitud, zoom });
    const ptsFit = filtrarPuntosValidos(fitBounds?.points || []);
    if (ptsFit.length > 0) {
      postMsg({ type: 'fitBounds', points: ptsFit.map(p => ({ lat: p.latitud, lng: p.longitud })) });
    }
  };

  // Web: antes de que el iframe se recree por cambio de mapa base, se pide
  // al iframe actual su centro/zoom reales y se guardan en `camaraPreviaRef`.
  // Se hace en el render (no en un efecto) para que el valor esté listo
  // antes de que el nuevo iframe emita su primer `mapReady`.
  const mapStylePrevRef = useRef(mapStyle);
  if (Platform.OS === 'web' && mapStylePrevRef.current !== mapStyle) {
    mapStylePrevRef.current = mapStyle;
    try {
      const win = webIframeRef.current?.contentWindow as any;
      const m = win?.map;
      if (m && typeof m.getCenter === 'function') {
        const c = m.getCenter();
        camaraPreviaRef.current = { lat: c.lat, lng: c.lng, zoom: m.getZoom() };
      }
    } catch { /* iframe no accesible */ }
  }

  // La cámara guardada se descarta cuando el usuario interactúa con el mapa
  // (arrastra, hace zoom o toca un marcador) o cuando el componente cambia
  // de centro/zoom por una acción explícita (botón "Puerto Rico", GPS).
  // Así la restauración no se aplica indefinidamente.
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (event: MessageEvent) => {
      try {
        const msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (msg && (msg.type === 'mapPress' || msg.type === 'markerPress' || msg.type === 'markerDragEnd')) {
          camaraPreviaRef.current = null;
        }
      } catch { /* ignorar */ }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, []);

  // Web: listener de mensajes desde el iframe
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const handler = (event: MessageEvent) => {
      try {
        const msg = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
        if (msg.type === 'mapReady') {
          // El iframe se recrea cada vez que cambia el mapa base (srcDoc
          // distinto). Se incrementa la generación para que los efectos de
          // sincronización reenvíen marcadores, capas y cámara al nuevo
          // documento — si no, el mapa nuevo quedaba vacío.
          setIframeGen(g => g + 1);
          // Además se reenvía el estado completo de inmediato (no depende de
          // que React vuelva a ejecutar los efectos). El iframe emite
          // `mapReady` varias veces (load, readyState, retry 400 ms), así que
          // se reintenta un par de veces para cubrir el momento en que
          // Leaflet termina de montar el contenedor.
          syncAllRef.current();
          setTimeout(() => syncAllRef.current(), 300);
          setTimeout(() => syncAllRef.current(), 900);
        } else if (msg.type === 'mapPress' && onMapPress) {
          onMapPress(msg.latitud, msg.longitud);
        } else if (msg.type === 'markerPress' && onMarkerPress) {
          onMarkerPress(msg.id);
        } else if (msg.type === 'markerDragEnd' && onMarkerDragEnd) {
          onMarkerDragEnd(msg.id, { latitud: msg.lat, longitud: msg.lng });
        } else if (msg.type === 'featurePress' && onFeaturePress) {
          onFeaturePress(msg.layerId, msg.properties || {});
        }
      } catch { /* ignorar mensajes no JSON */ }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
  }, [onMapPress, onMarkerPress, onMarkerDragEnd, onFeaturePress]);

  // Web: sincronizar marcadores
  useEffect(() => {
    if (Platform.OS !== 'web' || !webIframeReady) return;
    postMsg({ type: 'setMarkers', markers: markers.map(m => ({ id: m.id, lat: m.latitud, lng: m.longitud, title: m.title, color: m.color, icon: m.icon, iconColoreado: m.iconColoreado, tipoIcono: m.tipoIcono, draggable: m.draggable, onClickMsg: !!onMarkerPress })) });
  }, [iframeGen, markers, postMsg, onMarkerPress]);

  // Web: sincronizar polyline
  useEffect(() => {
    if (Platform.OS !== 'web' || !webIframeReady) return;
    postMsg({ type: 'setPolyline', polyline: polyline?.map(p => ({ lat: p.latitud, lng: p.longitud })) || [], color: polylineColor });
  }, [iframeGen, polyline, polylineColor, postMsg]);

  // Web: sincronizar marcador inicio
  useEffect(() => {
    if (Platform.OS !== 'web' || !webIframeReady) return;
    postMsg({ type: 'setStartMarker', data: startMarker ? { lat: startMarker.latitud, lng: startMarker.longitud } : null });
  }, [iframeGen, startMarker, postMsg]);

  // Web: sincronizar marcador final
  useEffect(() => {
    if (Platform.OS !== 'web' || !webIframeReady) return;
    postMsg({ type: 'setEndMarker', data: endMarker ? { lat: endMarker.latitud, lng: endMarker.longitud } : null });
  }, [iframeGen, endMarker, postMsg]);

  // Web: sincronizar centro/zoom.
  // OJO: NO se reenvía `zoom` aquí. Este efecto se dispara cada vez que el
  // iframe se recrea (cambio de mapa base) y, si reimponía el zoom, pisaba
  // el nivel que el técnico tenía. El zoom inicial ya viene inyectado en el
  // HTML (ver `webMapHtml`) y el botón "Puerto Rico" lo fija vía resetView.
  useEffect(() => {
    if (Platform.OS !== 'web' || !webIframeReady || !center) return;
    postMsg({ type: 'setView', lat: center.latitud, lng: center.longitud });
  }, [iframeGen, center, postMsg]);

  // Web: al cambiar el mapa base (terreno ↔ satélite) el iframe se recrea
  // (el srcDoc cambia). El centro/zoom reales ya se inyectan en el HTML
  // generado, así que Leaflet arranca directamente en la ubicación correcta
  // (antes arrancaba en Bogotá hardcodeado y el mapa "saltaba" a otra
  // ciudad). Además se reenvía un `resetView` por si el centro cambió entre
  // el render del HTML y el `mapReady`.
  //
  // IMPORTANTE: si venimos de un cambio de mapa base, NO se reenvía
  // `resetView` — `syncAllRef` ya restauró la cámara exacta del usuario.
  // Reenviarlo aquí pisaba esa restauración y provocaba el salto de zoom.
  const centerRef = useRef(center);
  const zoomRef = useRef(zoom);
  centerRef.current = center;
  zoomRef.current = zoom;
  useEffect(() => {
    if (Platform.OS !== 'web' || !webIframeReady) return;
    if (camaraPreviaRef.current) return; // hay restauración pendiente
    const c = centerRef.current;
    if (!c) return;
    postMsg({ type: 'resetView', lat: c.latitud, lng: c.longitud, zoom: zoomRef.current });
  }, [iframeGen, postMsg]);

  // Web: reset explícito de cámara (botón "Puerto Rico")
  useEffect(() => {
    if (Platform.OS !== 'web' || !webIframeReady || !center || !resetNonce) return;
    postMsg({ type: 'resetView', lat: center.latitud, lng: center.longitud, zoom });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeGen, resetNonce, postMsg]);

  // Web: centrado puntual sin zoom (botón "Centrar")
  useEffect(() => {
    if (Platform.OS !== 'web' || !webIframeReady || !foco) return;
    postMsg({ type: 'centrarSinZoom', lat: foco.coords.latitud, lng: foco.coords.longitud });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeGen, foco?.nonce, postMsg]);

  // Web: sincronizar ubicación usuario
  useEffect(() => {
    if (Platform.OS !== 'web' || !webIframeReady) return;
    const loc = userLocation || center;
    if (loc) postMsg({ type: 'setUserLocation', data: { lat: loc.latitud, lng: loc.longitud } });
  }, [iframeGen, userLocation, center, postMsg]);

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
  }, [iframeGen, geojsonLayers, postMsg]);

  // Web: encuadre automático (mediciones de los técnicos seleccionados)
  // Se omite cuando hay una cámara pendiente de restaurar (cambio de mapa
  // base): re-encuadrar ahí deshacía la vista que el usuario tenía.
  useEffect(() => {
    if (Platform.OS !== 'web' || !webIframeReady || !fitBounds) return;
    if (camaraPreviaRef.current) return;
    const pts = filtrarPuntosValidos(fitBounds.points || []);
    if (pts.length === 0) return;
    postMsg({ type: 'fitBounds', points: pts.map(p => ({ lat: p.latitud, lng: p.longitud })) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeGen, fitBounds?.nonce, postMsg]);

  // Web: recentrado sin zoom (botón "Centrar" del mapa general)
  useEffect(() => {
    if (Platform.OS !== 'web' || !webIframeReady || !recentrar) return;
    postMsg({ type: 'centrarSinZoom', lat: recentrar.coords.latitud, lng: recentrar.coords.longitud });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iframeGen, recentrar?.nonce, postMsg]);

  // HTML base del mapa. El centro/zoom iniciales se inyectan con los valores
  // reales del prop para que, al recrearse el iframe (cambio de mapa base),
  // Leaflet arranque ya en la ubicación correcta en vez de en un punto fijo
  // (antes Bogotá hardcodeado → el mapa "saltaba" a otra ciudad).
  const webMapHtml = useMemo(() => {
    const lat = center?.latitud ?? 1.914;
    const lon = center?.longitud ?? -75.145;
    const initialZoom = zoom ?? 14;

    const tileCfg = WEB_TILE_CONFIG[mapStyle] || WEB_TILE_CONFIG.terreno;
    const tileUrl = `'${tileCfg.url}'`;
    const tileAttribution = `'${tileCfg.attribution}'`;

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
    // maxNativeZoom = último zoom que el servidor realmente tiene. Por encima
    // de eso Leaflet estira la última tesela (mapa borroso al acercar). Antes
    // estaba fijo en 16 para todos los mapas base, lo que desperdiciaba el
    // detalle de Esri World Imagery hasta zoom 18.
    L.tileLayer(${tileUrl}, {
      maxZoom: ${tileCfg.maxZoom},
      maxNativeZoom: ${tileCfg.maxNativeZoom},
      attribution: ${tileAttribution}
    }).addTo(map);
    map.setView([${lat}, ${lon}], ${initialZoom});

    // El usuario tomó el control de la cámara (zoom/pan manual). Mientras
    // esté en true, _setView NO reimpone el zoom — solo recentra si el
    // centro pedido difiere del actual. Sin esto, cada tick de polling o
    // cada lectura GPS reseteaba el zoom al valor por defecto.
    window._userMovedMap = false;
    map.on('zoomstart', function() { window._userMovedMap = true; });
    map.on('dragstart', function() { window._userMovedMap = true; });

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
          var iconHtml = m.iconColoreado
            ? '<span style="font-size:22px;line-height:1;color:' + (m.color || '#1B5E20') + ';text-shadow:0 0 2px #fff,0 0 2px #fff,0 0 3px #fff">' + m.icon + '</span>'
            : '<span style="font-size:24px;line-height:1">' + m.icon + '</span>';
          layer = L.marker([m.lat, m.lng], {
            draggable: !!m.draggable,
            icon: L.divIcon({
              html: iconHtml,
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

    window._setPolyline = function(data, color) {
      if (window._polylineLayer) { map.removeLayer(window._polylineLayer); window._polylineLayer = null; }
      if (data && data.length > 1) {
        window._polylineLayer = L.polyline(data.map(function(p) { return [p.lat, p.lng]; }), {
          color: color || '#1B5E20', weight: 4, opacity: 0.9
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
              featureLayer.on('click', function() {
                window.ReactNativeWebView.postMessage(JSON.stringify({
                  type: 'featurePress',
                  layerId: layerDef.id,
                  properties: feature.properties,
                }));
              });
            }
          }
        }).addTo(map);
        window._geoJSONLayers[layerDef.id] = geoLayer;
      });
    };

    // Encuadre automático. Se descartan los puntos fuera de Colombia (datos
    // corruptos: había mediciones con vértices en Madrid que estiraban el
    // encuadre hasta medio Atlántico y dejaban el mapa "vacío" en zoom 3).
    // Además se acota el zoom mínimo a 5 para no alejarse más de lo útil.
    window._fitBounds = function(data) {
      var bounds = [];
      (data || []).forEach(function(p) {
        if (typeof p.lat !== 'number' || typeof p.lng !== 'number') return;
        if (p.lat < ${COORD_BOUNDS.minLat} || p.lat > ${COORD_BOUNDS.maxLat}) return;
        if (p.lng < ${COORD_BOUNDS.minLng} || p.lng > ${COORD_BOUNDS.maxLng}) return;
        bounds.push([p.lat, p.lng]);
      });
      if (bounds.length > 1) {
        map.fitBounds(bounds, { padding: [40, 40], maxZoom: 17 });
        if (map.getZoom() < 5) map.setZoom(5);
      } else if (bounds.length === 1) {
        map.setView(bounds[0], Math.max(map.getZoom(), 15), { animate: true });
      }
    };

    // Recentrar sin destruir la exploración del usuario:
    //  - Si el usuario ya movió el mapa, se conserva SU zoom y solo se
    //    recentra si el centro pedido está lejos (> ~50 m) del actual.
    //  - Si no lo ha movido, se aplica centro + zoom como antes.
    window._setView = function(lat, lng, z) {
      var cur = map.getCenter();
      var moved = Math.abs(cur.lat - lat) > 0.0005 || Math.abs(cur.lng - lng) > 0.0005;
      if (window._userMovedMap) {
        if (moved) map.panTo([lat, lng], { animate: true });
        return;
      }
      map.setView([lat, lng], z, { animate: true });
    };

    // Fuerza centro + zoom ignorando el flag (botón "Puerto Rico").
    window._resetView = function(lat, lng, z) {
      window._userMovedMap = false;
      map.setView([lat, lng], z, { animate: true });
    };

    // Restaura la cámara EXACTA que el usuario tenía antes de cambiar de
    // mapa base. El iframe se recrea (nuevo srcDoc) y Leaflet arranca con
    // los valores por defecto; sin esto el mapa "saltaba" de zoom al pasar
    // de Terreno/Calles a Satélite HD o Satélite Relieve y viceversa.
    // Se marca _userMovedMap = true para que los setView posteriores
    // (polling, GPS) no vuelvan a pisar el zoom elegido.
    window._restaurarCamara = function(lat, lng, z) {
      window._userMovedMap = true;
      map.setView([lat, lng], z, { animate: false });
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mapStyle, interactive, center?.latitud, center?.longitud, zoom]);

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
      title: m.title, color: m.color, icon: m.icon, iconColoreado: m.iconColoreado,
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

  // Reset explícito de cámara (botón "Puerto Rico")
  useEffect(() => {
    if (!webViewReady || hasNativeModule || !center || !resetNonce) return;
    injectJS(`window._resetView(${center.latitud}, ${center.longitud}, ${zoom});true;`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webViewReady, resetNonce, injectJS, hasNativeModule]);

  // Centrado puntual sin zoom (botón "Centrar")
  useEffect(() => {
    if (!webViewReady || hasNativeModule || !foco) return;
    injectJS(`window._centrarSinZoom(${foco.coords.latitud}, ${foco.coords.longitud});true;`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webViewReady, foco?.nonce, injectJS, hasNativeModule]);

  // Encuadre automático (WebView/Leaflet): reutiliza window._fitBounds
  useEffect(() => {
    if (!webViewReady || hasNativeModule || !fitBounds) return;
    const pts = filtrarPuntosValidos(fitBounds.points || []).map(p => ({ lat: p.latitud, lng: p.longitud }));
    if (pts.length === 0) return;
    injectJS(`window._fitBounds(${JSON.stringify(pts)});true;`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webViewReady, fitBounds?.nonce, injectJS, hasNativeModule]);

  // Recentrado sin zoom (WebView/Leaflet)
  useEffect(() => {
    if (!webViewReady || hasNativeModule || !recentrar) return;
    injectJS(`window._centrarSinZoom(${recentrar.coords.latitud}, ${recentrar.coords.longitud});true;`);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [webViewReady, recentrar?.nonce, injectJS, hasNativeModule]);

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
    const validos = points.filter(p => esCoordenadaValida(p.lat, p.lng));
    if (validos.length > 1) {
      injectJS(`window._fitBounds(${JSON.stringify(validos)});true;`);
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
        } else if (msg.type === 'featurePress' && onFeaturePress) {
          onFeaturePress(msg.layerId, msg.properties || {});
        }
      } catch (e) {
        console.warn('[MapViewOffline] Error parsing WebView message:', e);
      }
    },
    [onMapPress, onMarkerPress, onMarkerDragEnd, onFeaturePress]
  );

  // Si no hay módulo nativo, usar WebView (nativo) o iframe (web) con Leaflet + OpenStreetMap
  if (!hasNativeModule) {
    if (Platform.OS === 'web') {
      // Web: usar iframe con postMessage (WebView no soportado en web)
      // Hooks ya declarados arriba: webIframeRef, webIframeReady, postMsg, webSyncEffects

      // Nota: los efectos de sincronización están declarados arriba (postMsg, webSyncEffects)
      // junto con el listener de mensajes

      // Agregar listener en el HTML para recibir postMessage
      // IMPORTANTE: inyectamos el shim AL INICIO del script inline principal
      // (justo después de su <script> de apertura, antes de `var map = ...`).
      // Motivos:
      //  1) Si apuntáramos al primer </script>, inyectaríamos el shim dentro de
      //     <script src="...leaflet.js"></script>, y el navegador IGNORA el
      //     contenido inline de un script con src → el shim nunca se ejecutaba.
      //  2) Si lo inyectáramos al final del script inline, el propio script
      //     llama a window.ReactNativeWebView.postMessage(...) ANTES de que el
      //     shim defina window.ReactNativeWebView → TypeError.
      // Inyectándolo al inicio, el shim queda definido antes de cualquier uso.
      const webHtmlWithListener = webMapHtml.replace(
        `  <script>
    var map = L.map(`,
        `  <script>
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
        case 'setPolyline': window._setPolyline(data.polyline, data.color); break;
        case 'setStartMarker': window._setStartMarker(data.data); break;
        case 'setEndMarker': window._setEndMarker(data.data); break;
        case 'setUserLocation': window._setUserLocation(data.data); break;
        case 'setView': window._setView(data.lat, data.lng, data.zoom); break;
        case 'resetView': window._resetView(data.lat, data.lng, data.zoom); break;
        case 'restaurarCamara': window._restaurarCamara(data.lat, data.lng, data.zoom); break;
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
    // Reintento: el primer aviso de "mapa listo" puede llegar antes de que
    // Leaflet termine de inicializar el contenedor (el iframe se recrea al
    // cambiar de mapa base). Se reenvía una vez más para que el padre
    // sincronice cámara, marcadores y capas sobre el mapa ya montado.
    setTimeout(function() {
      window.parent.postMessage(JSON.stringify({ type: 'mapReady' }), '*');
    }, 400);
    var map = L.map(`
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
        {/* Cámara inicial. El fallback es Puerto Rico (Caquetá), igual que
            el del iframe web: antes caía en Bogotá y el mapa abría a ~300 km
            de la zona de trabajo. */}
        <MLCamera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: center
              ? [center.longitud, center.latitud]
              : [-75.145, 1.914],
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
                lineColor: polylineColor || '#1B5E20',
                lineWidth: 4,
                lineOpacity: 0.9,
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
            onPress={
              onFeaturePress
                ? (e: Record<string, any>) => {
                    const feature = e?.features?.[0];
                    if (feature) onFeaturePress(layer.id, feature.properties || {});
                  }
                : undefined
            }
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
