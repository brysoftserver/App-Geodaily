// ============================================================
// GEODAILY — Mapa Offline con MapLibre GL
// ============================================================
// Renderiza mapas offline usando teselas del servidor QGIS
// a través de @maplibre/maplibre-react-native.
//
// URL de teselas: /api/maps/tesela/{z}/{x}/{y}?capa=colombia
// ============================================================

import React, { useEffect, useRef, useState } from 'react';
import { View, Text, StyleSheet, ActivityIndicator, NativeModules, TouchableOpacity, Linking } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../theme';
import { API_CONFIG } from '../theme';
import { Coordenadas } from '../types';

// Carga condicional de MapLibre (fallback si no hay módulo nativo)
// En Expo Go, el módulo JS se carga pero el native module no está registrado,
// lo que produce un console.error interno de la librería.
let MapLibreGL: any = null;
try {
  // Suprimir console.error temporalmente para evitar que la librería
  // emita el warning "Native module not registered properly" en Expo Go.
  // El JS se carga pero el native module no está disponible.
  const origError = console.error;
  console.error = () => {};
  const mod = require('@maplibre/maplibre-react-native');
  console.error = origError;

  // Verificar si el módulo nativo está realmente registrado
  if (NativeModules.MLRNModule) {
    MapLibreGL = mod;
  }
} catch {
  // Módulo nativo no disponible (Expo Go)
}

interface MarkerData {
  id: string;
  latitud: number;
  longitud: number;
  title?: string;
  color?: string;
}

interface MapViewOfflineProps {
  center?: Coordenadas;
  zoom?: number;
  /** Altura del mapa en píxels. Usar '100%' para que ocupe todo el contenedor flex */
  height?: number | '100%';
  markers?: MarkerData[];
  showUserLocation?: boolean;
  interactive?: boolean;
  onMarkerPress?: (id: string) => void;
  onMapPress?: (latitud: number, longitud: number) => void;
}

// URL de teselas vectoriales PBF (OpenMapTiles schema)
const TILE_URL = `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.MAPS}/tesela/{z}/{x}/{y}?capa=colombia`;

// Estilo vectorial compatible con OpenMapTiles desde MBTiles
const MAP_STYLE = {
  version: 8 as const,
  name: 'GEODAILY - Offline',
  sources: {
    'geodaily-vector': {
      type: 'vector' as const,
      tiles: [TILE_URL],
      minzoom: 0,
      maxzoom: 14,
      attribution: '© OpenStreetMap contributors | GEODAILY',
    },
  },
  layers: [
    // === FONDO ===
    {
      id: 'background',
      type: 'background',
      paint: { 'background-color': '#f8f4f0' },
    },

    // === LANDUSE / LANDCOVER ===
    {
      id: 'landuse',
      source: 'geodaily-vector',
      'source-layer': 'landuse',
      type: 'fill',
      minzoom: 4,
      paint: {
        'fill-color': [
          'match', ['get', 'class'],
          'residential', '#e8ddd3',
          'commercial', '#e8ddd3',
          'industrial', '#e8ddd3',
          'cemetery', '#c3d9b7',
          'military', '#e8ddd3',
          'park', '#b6d9a8',
          'hospital', '#f0d0d0',
          'school', '#f0e8d0',
          'wood', '#b6d9a8',
          'grass', '#cde5c1',
          'forest', '#a8cfa0',
          'farmland', '#e5e8c3',
          'orchard', '#dce5b6',
          'quarry', '#d0d0d0',
          'beach', '#f0e8d0',
          'glacier', '#e8f0f8',
          /* default */ '#e8ddd3',
        ],
        'fill-opacity': 0.7,
      },
    },
    {
      id: 'landcover',
      source: 'geodaily-vector',
      'source-layer': 'landcover',
      type: 'fill',
      minzoom: 0,
      paint: {
        'fill-color': [
          'match', ['get', 'class'],
          'wood', '#b6d9a8',
          'forest', '#a8cfa0',
          'grass', '#cde5c1',
          'wetland', '#b6cfe0',
          'snow', '#f0f4f8',
          'sand', '#f0e8d0',
          'bare_rock', '#d8d0c8',
          'scrub', '#d0dcc0',
          /* default */ '#dce5d0',
        ],
        'fill-opacity': 0.5,
      },
    },
    {
      id: 'park',
      source: 'geodaily-vector',
      'source-layer': 'park',
      type: 'fill',
      minzoom: 11,
      paint: {
        'fill-color': '#b6d9a8',
        'fill-opacity': 0.5,
      },
    },

    // === AGUA (WATER) ===
    {
      id: 'water',
      source: 'geodaily-vector',
      'source-layer': 'water',
      type: 'fill',
      minzoom: 0,
      paint: {
        'fill-color': '#a0c8e8',
        'fill-opacity': 0.5,
      },
    },
    {
      id: 'waterway',
      source: 'geodaily-vector',
      'source-layer': 'waterway',
      type: 'line',
      minzoom: 8,
      paint: {
        'line-color': '#a0c8e8',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 2],
      },
    },

    // === BOUNDARIES ===
    {
      id: 'boundary',
      source: 'geodaily-vector',
      'source-layer': 'boundary',
      type: 'line',
      minzoom: 3,
      paint: {
        'line-color': '#888',
        'line-width': ['interpolate', ['linear'], ['zoom'], 3, 0.5, 14, 2],
        'line-dasharray': [4, 2],
      },
    },

    // === TRANSPORTATION ===
    {
      id: 'transportation',
      source: 'geodaily-vector',
      'source-layer': 'transportation',
      type: 'line',
      minzoom: 4,
      paint: {
        'line-color': [
          'match', ['get', 'class'],
          'motorway', '#f08060',
          'trunk', '#f0a060',
          'primary', '#f0c060',
          'secondary', '#f0e060',
          'tertiary', '#e8e0c0',
          'street', '#d0c8b0',
          'path', '#c0b8a0',
          'track', '#c0b8a0',
          'rail', '#b0a090',
          'pier', '#d0c8b0',
          'bridge', '#d0c8b0',
          /* default */ '#d0c8b0',
        ],
        'line-width': [
          'interpolate', ['linear'], ['zoom'],
          4, ['match', ['get', 'class'], 'motorway', 1, 'trunk', 0.8, 0.3],
          14, ['match', ['get', 'class'], 'motorway', 6, 'trunk', 5, 'primary', 4, 'secondary', 3, 'tertiary', 2.5, 'street', 2, 1],
        ],
      },
    },
    {
      id: 'transportation-tunnel',
      source: 'geodaily-vector',
      'source-layer': 'transportation',
      type: 'line',
      minzoom: 8,
      filter: ['==', ['get', 'brunnel'], 'tunnel'],
      paint: {
        'line-color': '#d0c8b0',
        'line-width': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 3],
        'line-dasharray': [2, 2],
        'line-opacity': 0.5,
      },
    },

    // === BUILDINGS ===
    {
      id: 'building',
      source: 'geodaily-vector',
      'source-layer': 'building',
      type: 'fill',
      minzoom: 13,
      paint: {
        'fill-color': '#d0c8b8',
        'fill-opacity': 0.8,
        'fill-outline-color': '#b0a898',
      },
    },

    // === AEROWAY ===
    {
      id: 'aeroway',
      source: 'geodaily-vector',
      'source-layer': 'aeroway',
      type: 'fill',
      minzoom: 11,
      paint: {
        'fill-color': '#e8e0d8',
      },
    },

    // === PLACES (Labels) ===
    {
      id: 'place-city',
      source: 'geodaily-vector',
      'source-layer': 'place',
      type: 'symbol',
      minzoom: 4,
      layout: {
        'text-field': '{name:latin}',
        'text-font': ['Open Sans Regular', 'Noto Sans Regular'],
        'text-size': ['interpolate', ['linear'], ['zoom'], 4, 8, 14, 14],
        'text-anchor': 'center',
        'text-offset': [0, 0],
        'text-max-width': 10,
        'text-padding': 4,
      },
      paint: {
        'text-color': '#333',
        'text-halo-color': '#fff',
        'text-halo-width': 2,
      },
    },
  ],
};

const MapViewOffline: React.FC<MapViewOfflineProps> = ({
  center,
  zoom = 14,
  height = 300,
  markers = [],
  showUserLocation = false,
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

  // Si no hay módulo nativo, mostrar fallback informativo
  if (!hasNativeModule) {
    return (
      <View style={containerStyle}>
        <View style={styles.fallbackContent}>
          <Text style={styles.fallbackIcon}>🗺️</Text>
          <Text style={styles.fallbackTitle}>Mapa Offline</Text>
          {center ? (
            <Text style={styles.fallbackCoords}>
              {center.latitud.toFixed(5)}, {center.longitud.toFixed(5)}
            </Text>
          ) : (
            <Text style={styles.fallbackCoords}>Ubicación no disponible</Text>
          )}
          {markers.length > 0 && (
            <Text style={styles.fallbackMarkers}>
              {markers.length} punto(s) marcados
            </Text>
          )}
          <Text style={styles.fallbackNotice}>
            Mapa completo disponible en dispositivo físico o build APK
          </Text>
          {center && (
            <TouchableOpacity
              style={styles.osmButton}
              onPress={() => {
                const url = `https://www.openstreetmap.org/?mlat=${center.latitud}&mlon=${center.longitud}&zoom=16`;
                Linking.openURL(url).catch(() => {});
              }}
            >
              <Text style={styles.osmButtonText}>🌐 Ver en OpenStreetMap</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    );
  }

  const { MapView: MLMapView, Camera: MLCamera, PointAnnotation: MLAnnotation, UserLocation: MLUserLocation } = MapLibreGL;

  return (
    <View style={containerStyle}>
      <MLMapView
        style={StyleSheet.absoluteFill}
        styleURL={MAP_STYLE}
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

        {/* Marcadores */}
        {markers.map((m) => (
          <MLAnnotation
            key={m.id}
            id={m.id}
            coordinate={[m.longitud, m.latitud]}
            onSelected={() => onMarkerPress?.(m.id)}
          >
            <View style={styles.markerContainer}>
              <View
                style={[
                  styles.markerDot,
                  { backgroundColor: m.color || COLORS.primary },
                ]}
              />
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
  // --- Fallback (sin módulo nativo) ---
  fallbackContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  fallbackIcon: {
    fontSize: 48,
    marginBottom: SPACING.sm,
  },
  fallbackTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  fallbackCoords: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    fontFamily: 'monospace',
    marginBottom: SPACING.sm,
  },
  fallbackMarkers: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.info,
    fontWeight: FONTS.weights.medium,
    marginBottom: SPACING.sm,
  },
  fallbackNotice: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
    textAlign: 'center',
    fontStyle: 'italic',
    marginTop: SPACING.sm,
  },
  osmButton: {
    marginTop: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.lg,
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    ...SHADOWS.sm,
  },
  osmButtonText: {
    color: COLORS.textOnPrimary,
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
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
