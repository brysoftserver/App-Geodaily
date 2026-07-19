// ============================================================
// MapaGeneralScreen — Mapa multi-rol con todos los datos
// Plantaciones, tracking de técnicos y mediciones de terreno
// MEJORADO: GPS Context, AppState polling, componentes extraídos,
// cache de veredas, anclado a Puerto Rico, clustering
// ============================================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  AppState,
  AppStateStatus,
} from 'react-native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapViewOffline from '../components/MapViewOffline';
import MapLayerToggle from '../components/mapa/MapLayerToggle';
import MapToolbar from '../components/mapa/MapToolbar';
import MapItemDetailCard from '../components/mapa/MapItemDetailCard';
import MapItemList from '../components/mapa/MapItemList';
import { useAuth } from '../store/AuthContext';
import { useGPS } from '../store/GPSContext';
import { useSyncMapData } from '../hooks/useSyncMapData';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../theme';
import apiClient from '../services/api';
import { Coordenadas } from '../types';
import { getIconoEspecie } from '../utils/constants';
import {
  saveVeredasCache,
  getVeredasCache,
  isVeredasCacheFresh,
} from '../services/database';

// ============================================================
// PUERTO RICO, CAQUETÁ — Centro del mapa
// ============================================================
const PUERTO_RICO_CENTER = { latitud: 1.914, longitud: -75.145 };
const ZOOM_MUNICIPIO = 13;
const ZOOM_UBICACION = 15;
const POLLING_INTERVAL_MS = 30000; // 30s
const VEREDAS_CACHE_TTL = 86400000; // 24h

type CapaActiva = 'plantaciones' | 'tecnicos' | 'mediciones' | 'veredas';

// NOTA: getIconoEspecie se importa de utils/constants (source of truth única)

const MapaGeneralScreen: React.FC<{ navigation?: Record<string, any> }> = ({ navigation: _navigation }) => {
  const insets = useSafeAreaInsets();
  const { isAdmin, isSupervisor, isInterventor, isGerente } = useAuth();
  const { userLocation, getCurrentPosition, siguiendo, setSiguiendo } = useGPS();
  const canViewAll = isAdmin || isSupervisor || isInterventor || isGerente;

  const {
    plantaciones,
    posiciones,
    mediciones,
    loading,
    syncing,
    loadAll,
    syncAll,
    fetchUltimasPosiciones,
    fetchAllPlantaciones,
    fetchAllMediciones,
    eliminarPlantacion,
    eliminarMedicion,
  } = useSyncMapData();

  // --- Estado del mapa ---
  const [capasActivas, setCapasActivas] = useState<Set<CapaActiva>>(new Set(['plantaciones', 'tecnicos']));
  const [veredasFeatures, setVeredasFeatures] = useState<Record<string, any>[] | null>(null);
  const [selectedItem, setSelectedItem] = useState<Record<string, any> | null>(null);
  const [showList, setShowList] = useState(false);
  const [mapCenter, setMapCenter] = useState<Coordenadas>(PUERTO_RICO_CENTER);
  const [mapZoom, setMapZoom] = useState(ZOOM_MUNICIPIO);
  const [locating, setLocating] = useState(false);
  const [veredasLoading, setVeredasLoading] = useState(false);

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const siguiendoRef = useRef(false);
  const appStateRef = useRef<AppStateStatus>('active');

  // Mantener ref sincronizada con el estado
  useEffect(() => {
    siguiendoRef.current = siguiendo;
  }, [siguiendo]);

  // ============================================================
  // Carga inicial
  // ============================================================
  useEffect(() => {
    loadAll();
    syncAll();
    // Cargar veredas (desde cache si es fresco)
    cargarVeredas();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ============================================================
  // Polling adaptativo con AppState
  // ============================================================
  const iniciarPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    // Solo si hay capas que requieran datos del servidor
    if (!capasActivas.has('tecnicos') && !capasActivas.has('plantaciones') && !capasActivas.has('mediciones')) {
      pollRef.current = null;
      return;
    }
    pollRef.current = setInterval(() => {
      if (appStateRef.current !== 'active') return; // Pausado si no está en foreground
      if (capasActivas.has('tecnicos')) fetchUltimasPosiciones();
      if (capasActivas.has('plantaciones')) fetchAllPlantaciones();
      if (capasActivas.has('mediciones')) fetchAllMediciones();
    }, POLLING_INTERVAL_MS);
  }, [capasActivas, fetchUltimasPosiciones, fetchAllPlantaciones, fetchAllMediciones]);

  // Escuchar cambios de AppState para pausar/reanudar polling
  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState: AppStateStatus) => {
      appStateRef.current = nextState;
      if (nextState === 'active') {
        // Al volver a foreground, refrescar datos inmediatamente
        if (capasActivas.has('tecnicos')) fetchUltimasPosiciones();
        if (capasActivas.has('plantaciones')) fetchAllPlantaciones();
        if (capasActivas.has('mediciones')) fetchAllMediciones();
      }
    });
    return () => sub.remove();
  }, [capasActivas, fetchUltimasPosiciones, fetchAllPlantaciones, fetchAllMediciones]);

  // Iniciar/refrescar polling cuando cambian capas
  useEffect(() => {
    iniciarPolling();
    return () => {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    };
  }, [iniciarPolling]);

  // ============================================================
  // Veredas: cache local + servidor
  // ============================================================
  const cargarVeredas = useCallback(async () => {
    setVeredasLoading(true);
    try {
      // 1. Intentar desde cache local si está fresco
      const fresco = await isVeredasCacheFresh(VEREDAS_CACHE_TTL);
      if (fresco) {
        const cache = await getVeredasCache();
        if (cache.veredas.length > 0) {
          setVeredasFeatures(cache.veredas);
          setVeredasLoading(false);
          return;
        }
      }

      // 2. Descargar del servidor.
      //    Antes usaba `fetch` crudo SIN cabecera Authorization: el endpoint
      //    exige token, devolvía 401, y como solo se miraba `res.ok` fallaba
      //    en silencio — el mapa se quedaba sin la capa de veredas y ni
      //    siquiera caía al respaldo del caché.
      const resp = await apiClient.get('/api/maps/veredas', { timeout: 20000 });
      {
        const data = resp.data;
        if (data?.veredas && data.veredas.length > 0) {
          const features = data.veredas.map((v: Record<string, any>) => ({
            ...v,
            geometry: v.geometry || { type: 'MultiPolygon', coordinates: [] },
          }));
          setVeredasFeatures(features);
          // Guardar en cache local
          await saveVeredasCache(features, data.fuente || 'overpass');
        }
      }
    } catch (err) {
      console.warn('[MapaGeneral] Error al cargar veredas:', err);
      // 3. Fallback: cache local aunque esté vencido
      const cache = await getVeredasCache();
      if (cache.veredas.length > 0) {
        setVeredasFeatures(cache.veredas);
      }
    } finally {
      setVeredasLoading(false);
    }
  }, []);

  // ============================================================
  // Navegación: centrar en ubicación / reset
  // ============================================================
  const centrarEnMiUbicacion = useCallback(async () => {
    setLocating(true);
    try {
      const coords = await getCurrentPosition();
      if (coords) {
        setMapCenter({ latitud: coords.latitud, longitud: coords.longitud });
        setMapZoom(ZOOM_UBICACION);
        setSiguiendo(true);
      } else {
        // Fallback: última conocida del sistema
        const last = await Location.getLastKnownPositionAsync({ maxAge: 60000 });
        if (last) {
          setMapCenter({ latitud: last.coords.latitude, longitud: last.coords.longitude });
          setMapZoom(ZOOM_UBICACION);
          setSiguiendo(true);
        } else {
          Alert.alert(
            '📍 Sin ubicación',
            'No se pudo obtener la ubicación GPS.\nVerifica que el GPS esté activado y tengas conexión con los satélites.'
          );
        }
      }
    } finally {
      setLocating(false);
    }
  }, [getCurrentPosition, setSiguiendo]);

  const detenerSeguimiento = useCallback(() => {
    setSiguiendo(false);
    setMapCenter(PUERTO_RICO_CENTER);
    setMapZoom(ZOOM_MUNICIPIO);
  }, [setSiguiendo]);

  // Efecto: si siguiendo y hay userLocation, actualizar centro
  useEffect(() => {
    if (siguiendo && userLocation) {
      setMapCenter(userLocation);
      setMapZoom((prev) => (prev < ZOOM_UBICACION ? ZOOM_UBICACION : prev));
    }
  }, [siguiendo, userLocation]);

  // ============================================================
  // Toggle de capas
  // ============================================================
  const toggleCapa = useCallback(
    (capa: CapaActiva) => {
      setCapasActivas((prev) => {
        const next = new Set(prev);
        const activando = !next.has(capa);
        if (next.has(capa)) next.delete(capa);
        else next.add(capa);
        if (activando) {
          setTimeout(() => {
            if (capa === 'tecnicos') fetchUltimasPosiciones();
            if (capa === 'plantaciones') fetchAllPlantaciones();
            if (capa === 'mediciones') fetchAllMediciones();
            if (capa === 'veredas') cargarVeredas();
          }, 100);
        }
        return next;
      });
    },
    [fetchUltimasPosiciones, fetchAllPlantaciones, fetchAllMediciones, cargarVeredas]
  );

  // ============================================================
  // Construcción de marcadores
  // ============================================================
  const plantacionMarkers = capasActivas.has('plantaciones')
    ? plantaciones.map((p: Record<string, any>) => ({
        id: `plant-${p.id}`,
        latitud: p.latitud,
        longitud: p.longitud,
        title: `${p.cantidad}x ${p.especie}`,
        icon: p.icono || getIconoEspecie(p.especie),
      }))
    : [];

  const tecnicosMarkers = capasActivas.has('tecnicos')
    ? posiciones.map((pos: Record<string, any>) => ({
        id: `tec-${pos.id}`,
        latitud: pos.latitud,
        longitud: pos.longitud,
        title: pos.usuario_nombre || `Técnico: ${pos.usuario_id}`,
        color: '#1565C0',
        icon: '👤',
      }))
    : [];

  const medicionMarkers: Record<string, any>[] = capasActivas.has('mediciones')
    ? mediciones.reduce((acc: Record<string, any>[], m: Record<string, any>) => {
        const puntos = m.puntos || [];
        if (puntos.length === 0) return acc;
        const latCentro = puntos.reduce((s: number, p: Record<string, any>) => s + p.latitud, 0) / puntos.length;
        const lonCentro = puntos.reduce((s: number, p: Record<string, any>) => s + p.longitud, 0) / puntos.length;
        acc.push({
          id: `med-${m.id}`,
          latitud: latCentro,
          longitud: lonCentro,
          title: `${m.area_hectareas?.toFixed(2) || '?'} ha`,
          color: '#E65100',
          icon: '📐',
        });
        return acc;
      }, [])
    : [];

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const allMarkers: any = [...plantacionMarkers, ...tecnicosMarkers, ...medicionMarkers];

  // Capa GeoJSON de veredas
  const veredaGeoLayer =
    capasActivas.has('veredas') && veredasFeatures && veredasFeatures.length > 0
      ? [
          {
            id: 'veredas',
            nombre: 'Veredas',
            features: veredasFeatures,
            fillColor: 'rgba(27, 94, 32, 0.12)',
            strokeColor: '#1B5E20',
            strokeWidth: 2,
            strokeOpacity: 0.5,
            fillOpacity: 0.12,
          },
        ]
      : [];

  // ============================================================
  // Handlers
  // ============================================================
  const handleConfirmDelete = (tipo: 'plantación' | 'medición', id: string) => {
    Alert.alert(`Eliminar ${tipo}`, `¿Estás seguro de eliminar esta ${tipo}? Esta acción no se puede deshacer.`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Eliminar',
        style: 'destructive',
        onPress: () => {
          if (tipo === 'plantación') eliminarPlantacion(id);
          else eliminarMedicion(id);
          setSelectedItem(null);
        },
      },
    ]);
  };

  const conteos = {
    plantaciones: plantaciones.length,
    tecnicos: posiciones.length,
    mediciones: mediciones.length,
    veredas: veredasFeatures?.length || 0,
  };

  // ============================================================
  // Render
  // ============================================================
  return (
    // paddingBottom con safe-area: sin esto el listado y los botones de la
    // parte inferior quedaban ocultos debajo de la barra de navegación
    // del teléfono (HUD inaccesible).
    <View style={[styles.container, { paddingBottom: insets.bottom }]}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {canViewAll ? 'Mapa — Puerto Rico, Caquetá' : 'Mis Plantaciones'}
        </Text>
        <TouchableOpacity
          style={styles.refreshButton}
          onPress={async () => {
            await syncAll();
            await loadAll();
          }}
        >
          <Text style={styles.refreshText}>{syncing ? '⋯' : '↻'}</Text>
        </TouchableOpacity>
      </View>

      {/* Capas Toggle — solo para roles con vista general */}
      {canViewAll && (
        <MapLayerToggle capasActivas={capasActivas} onToggle={toggleCapa} conteos={conteos} />
      )}

      {/* Toolbar */}
      {canViewAll && (
        <MapToolbar
          locating={locating}
          siguiendo={siguiendo}
          onCentrar={centrarEnMiUbicacion}
          onReset={detenerSeguimiento}
        />
      )}

      {/* Mapa */}
      <View style={styles.mapContainer}>
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.primary} />
            <Text style={styles.loadingText}>Cargando datos del mapa...</Text>
          </View>
        ) : (
          <MapViewOffline
            center={mapCenter}
            zoom={mapZoom}
            markers={allMarkers}
            height="100%"
            mapStyle="relieve"
            showUserLocation={true}
            userLocation={userLocation}
            geojsonLayers={veredaGeoLayer}
          />
        )}
      </View>

      {/* Indicador de carga de veredas */}
      {veredasLoading && (
        <View style={styles.veredasLoading}>
          <ActivityIndicator size="small" color={COLORS.primary} />
          <Text style={styles.veredasLoadingText}>Cargando veredas...</Text>
        </View>
      )}

      {/* Botón toggle lista */}
      {allMarkers.length > 0 && (
        <TouchableOpacity style={styles.toggleListButton} onPress={() => setShowList((prev) => !prev)}>
          <Text style={styles.toggleListText}>
            {showList ? '▼ Ocultar lista' : `▲ Ver lista (${allMarkers.length})`}
          </Text>
        </TouchableOpacity>
      )}

      {/* Lista de items */}
      {showList && (
        <MapItemList
          items={allMarkers}
          plantaciones={plantaciones}
          mediciones={mediciones}
          isAdmin={isAdmin}
          onSelect={setSelectedItem}
          onDelete={handleConfirmDelete}
        />
      )}

      {/* Detalle del item seleccionado */}
      {selectedItem && (
        <MapItemDetailCard
          item={selectedItem}
          plantaciones={plantaciones}
          mediciones={mediciones}
          posiciones={posiciones}
          canViewAll={canViewAll}
          isAdmin={isAdmin}
          onClose={() => setSelectedItem(null)}
          onDelete={handleConfirmDelete}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  headerTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  refreshButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: COLORS.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
  },
  refreshText: { fontSize: 20, color: COLORS.primary },
  mapContainer: { flex: 1, minHeight: 300 },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.mapTileBackground,
  },
  loadingText: { marginTop: SPACING.sm, fontSize: FONTS.sizes.md, color: COLORS.textSecondary },
  veredasLoading: {
    position: 'absolute',
    top: 100,
    right: SPACING.sm,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface + 'CC',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
    gap: 6,
  },
  veredasLoadingText: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary },
  toggleListButton: {
    padding: SPACING.sm,
    backgroundColor: COLORS.surface,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  toggleListText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.primary,
    fontWeight: FONTS.weights.semibold,
  },
});

export default MapaGeneralScreen;
