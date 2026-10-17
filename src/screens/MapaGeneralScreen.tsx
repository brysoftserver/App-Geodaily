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
  Modal,
} from 'react-native';
import * as Location from 'expo-location';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import MapViewOffline from '../components/MapViewOffline';
import MapLayerToggle from '../components/mapa/MapLayerToggle';
import MapToolbar from '../components/mapa/MapToolbar';
import MapItemDetailCard from '../components/mapa/MapItemDetailCard';
import MapItemList from '../components/mapa/MapItemList';
import VeredaDetailCard from '../components/mapa/VeredaDetailCard';
import { useAuth } from '../store/AuthContext';
import { useGPS } from '../store/GPSContext';
import { useSyncMapData } from '../hooks/useSyncMapData';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../theme';
import apiClient from '../services/api';
import { Coordenadas } from '../types';
import { getIconoEspecie } from '../utils/constants';
import { normalizarVereda } from '../utils/corregimientos';
import {
  saveVeredasCache,
  getVeredasCache,
  removeVeredaFromCache,
} from '../services/database';

// ============================================================
// PUERTO RICO, CAQUETÁ — Centro del mapa
// ============================================================
const PUERTO_RICO_CENTER = { latitud: 1.914, longitud: -75.145 };
const ZOOM_MUNICIPIO = 13;
const ZOOM_UBICACION = 15;
const POLLING_INTERVAL_MS = 30000; // 30s

type CapaActiva = 'plantaciones' | 'tecnicos' | 'mediciones' | 'veredas';

// NOTA: getIconoEspecie se importa de utils/constants (source of truth única)

const MapaGeneralScreen: React.FC<{ navigation?: Record<string, any> }> = ({ navigation: _navigation }) => {
  const insets = useSafeAreaInsets();
  const { isAdmin, isCoordinador, isInterventor, isGerente } = useAuth();
  const { userLocation, getCurrentPosition, siguiendo, setSiguiendo } = useGPS();
  const canViewAll = isAdmin || isCoordinador || isInterventor || isGerente;

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
  const [selectedVereda, setSelectedVereda] = useState<Record<string, any> | null>(null);
  // Confirmación de borrado con Modal propio (Alert.alert con botones NO
  // funciona en Expo web, por eso no se usa aquí).
  const [confirmarEliminar, setConfirmarEliminar] = useState<{ tipo: 'plantación' | 'medición' | 'vereda'; id: string; nombre?: string } | null>(null);
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
      // 1. Mostrar el cache local de inmediato (si existe) para que el mapa
      //    no parpadee. NO se retorna aquí: aunque el cache esté fresco,
      //    SIEMPRE se revalida contra el servidor. Antes, un cache fresco
      //    (<24h) evitaba la consulta y las veredas que el admin había
      //    ocultado seguían apareciendo hasta que el cache expiraba.
      const cache = await getVeredasCache();
      if (cache.veredas.length > 0) {
        setVeredasFeatures(cache.veredas);
      }

      // 2. Descargar del servidor (fuente de verdad, ya con las exclusiones
      //    aplicadas). Antes usaba `fetch` crudo SIN cabecera Authorization:
      //    el endpoint exige token, devolvía 401, y como solo se miraba
      //    `res.ok` fallaba en silencio.
      const resp = await apiClient.get('/api/maps/veredas', { timeout: 20000 });
      {
        const data = resp.data;
        if (data?.veredas) {
          const features = data.veredas.map((v: Record<string, any>) => ({
            ...v,
            geometry: v.geometry || { type: 'MultiPolygon', coordinates: [] },
          }));
          setVeredasFeatures(features);
          // Guardar en cache local (ya sin las veredas excluidas)
          await saveVeredasCache(features, data.fuente || 'overpass');
        }
      }
    } catch (err) {
      console.warn('[MapaGeneral] Error al cargar veredas:', err);
      // 3. Fallback: cache local aunque esté vencido (modo offline)
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
      // Reutilizar la posición del watch global si es reciente (<60 s):
      // evita un fix nuevo que puede tardar o colgarse cuando ya hay una
      // lectura viva. Si está vieja o no hay, se pide una fresca.
      const edadMs = userLocation?.timestamp
        ? Date.now() - new Date(userLocation.timestamp).getTime()
        : Infinity;
      const coords =
        userLocation && edadMs < 60000 ? userLocation : await getCurrentPosition();
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
  }, [getCurrentPosition, setSiguiendo, userLocation]);

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

  // Capa GeoJSON del ÁREA de cada plantación — el backend ya oculta el
  // polígono para roles superiores (solo el técnico dueño lo recibe), pero
  // se filtra también aquí: el área trazada y sus números son privados del
  // técnico, los roles superiores solo deben ver especie/cantidad/ícono.
  const plantacionFeatures =
    capasActivas.has('plantaciones') && !canViewAll
      ? plantaciones
          .filter((p: Record<string, any>) => (p.poligono?.length ?? 0) >= 3)
          .map((p: Record<string, any>) => {
            const pts = p.poligono as { latitud: number; longitud: number }[];
            return {
              type: 'Feature',
              geometry: {
                type: 'Polygon',
                coordinates: [[
                  ...pts.map((pt) => [pt.longitud, pt.latitud]),
                  [pts[0].longitud, pts[0].latitud],
                ]],
              },
              properties: { especie: p.especie },
            };
          })
      : [];
  const plantacionGeoLayer =
    plantacionFeatures.length > 0
      ? [
          {
            id: 'plantaciones-area',
            nombre: 'Áreas de plantación',
            features: plantacionFeatures,
            fillColor: 'rgba(46, 125, 50, 0.18)',
            strokeColor: '#2E7D32',
            strokeWidth: 2,
            strokeOpacity: 0.7,
            fillOpacity: 0.18,
          },
        ]
      : [];
  const geoLayers = [...veredaGeoLayer, ...plantacionGeoLayer];

  // ============================================================
  // Handlers
  // ============================================================
  const handleConfirmDelete = (tipo: 'plantación' | 'medición', id: string) => {
    // Abre el Modal de confirmación (Alert.alert no muestra botones en web).
    setConfirmarEliminar({ tipo, id });
  };

  const ejecutarEliminar = useCallback(async () => {
    const pendiente = confirmarEliminar;
    if (!pendiente) return;
    setConfirmarEliminar(null);
    try {
      if (pendiente.tipo === 'plantación') await eliminarPlantacion(pendiente.id);
      else if (pendiente.tipo === 'medición') await eliminarMedicion(pendiente.id);
      else if (pendiente.tipo === 'vereda') {
        // Las veredas no son datos propios (vienen de OpenStreetMap/Overpass o
        // de un fallback del backend) — "eliminar" en realidad es ocultarlas
        // de la vista de la app (tabla `veredas_excluidas`).
        await apiClient.delete(`/api/maps/veredas/${encodeURIComponent(pendiente.id)}`, {
          data: { nombre: pendiente.nombre },
        });
        // Quitar también del caché local: si no, al recargar la pantalla se
        // leía el caché (24h) y la vereda reaparecía aunque el servidor ya
        // la hubiera excluido.
        await removeVeredaFromCache(pendiente.id);
        setVeredasFeatures((prev) => (prev ? prev.filter((v) => v.id !== pendiente.id) : prev));
        setSelectedVereda(null);
      }
    } catch (err: any) {
      Alert.alert('Error', err?.response?.data?.mensaje || `No se pudo eliminar la ${pendiente.tipo}`);
    }
    setSelectedItem(null);
  }, [confirmarEliminar, eliminarPlantacion, eliminarMedicion]);

  // Las veredas no son datos propios (vienen de OpenStreetMap/Overpass o de
  // un fallback del backend) — "eliminar" en realidad es ocultarlas de la
  // vista de la app (tabla `veredas_excluidas`), no borrar el dato de origen.
  // Se usa el Modal de confirmación (Alert.alert no muestra botones en web).
  const handleOcultarVereda = (id: string, nombre: string) => {
    setConfirmarEliminar({ tipo: 'vereda', id, nombre });
  };

  const totalPlantacionesEnVereda = (nombreVereda?: string): number => {
    const objetivo = normalizarVereda(nombreVereda);
    if (!objetivo) return 0;
    return plantaciones.filter(
      (p: Record<string, any>) => normalizarVereda(p.vereda) === objetivo
    ).length;
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
            geojsonLayers={geoLayers}
            onMarkerPress={(id) => {
              const marker = allMarkers.find((m: Record<string, any>) => m.id === id);
              if (marker) setSelectedItem(marker);
            }}
            onFeaturePress={(layerId, properties) => {
              if (layerId === 'veredas') setSelectedVereda(properties);
            }}
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
          posiciones={posiciones}
          veredas={capasActivas.has('veredas') ? veredasFeatures || [] : []}
          isAdmin={isAdmin}
          onSelect={setSelectedItem}
          onDelete={handleConfirmDelete}
          onDeleteVereda={handleOcultarVereda}
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

      {/* Detalle de la vereda seleccionada */}
      {selectedVereda && (
        <VeredaDetailCard
          properties={selectedVereda}
          totalPlantaciones={totalPlantacionesEnVereda(selectedVereda.nombre)}
          isAdmin={isAdmin}
          onClose={() => setSelectedVereda(null)}
          onDelete={handleOcultarVereda}
        />
      )}

      {/* Modal: confirmar eliminación (Alert.alert no muestra botones en web) */}
      <Modal visible={!!confirmarEliminar} transparent animationType="fade" onRequestClose={() => setConfirmarEliminar(null)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <Text style={styles.modalTitle}>
              {confirmarEliminar?.tipo === 'vereda' ? '🗺️ Ocultar vereda' : `🗑️ Eliminar ${confirmarEliminar?.tipo}`}
            </Text>
            <Text style={styles.confirmarTexto}>
              {confirmarEliminar?.tipo === 'vereda'
                ? `¿Ocultar "${confirmarEliminar?.nombre || 'esta vereda'}" del mapa para todos los usuarios? Esto no borra el dato de OpenStreetMap, solo deja de mostrarse en la app.`
                : `¿Seguro que quieres eliminar esta ${confirmarEliminar?.tipo}? Esta acción no se puede deshacer.`}
            </Text>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnEliminar]}
              onPress={ejecutarEliminar}
            >
              <Text style={styles.modalBtnTextEliminar}>
                {confirmarEliminar?.tipo === 'vereda' ? 'Ocultar' : 'Eliminar'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.modalBtn, styles.modalBtnCancel]}
              onPress={() => setConfirmarEliminar(null)}
            >
              <Text style={styles.modalBtnTextCancel}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
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
  // Modal de confirmación de borrado
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.lg,
  },
  modalContent: {
    width: '100%',
    maxWidth: 400,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
  },
  modalTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  confirmarTexto: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    marginBottom: SPACING.lg,
  },
  modalBtn: {
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  modalBtnEliminar: { backgroundColor: COLORS.error },
  modalBtnTextEliminar: { color: '#fff', fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold },
  modalBtnCancel: { backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border },
  modalBtnTextCancel: { color: COLORS.textPrimary, fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold },
});

export default MapaGeneralScreen;
