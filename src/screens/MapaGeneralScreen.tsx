// ============================================================
// MapaGeneralScreen — Mapa multi-rol con todos los datos
// Plantaciones, tracking de técnicos y mediciones de terreno
// ============================================================

import React, { useEffect, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import * as Location from 'expo-location';
import MapViewOffline from '../components/MapViewOffline';
import { useAuth } from '../store/AuthContext';
import { useSyncMapData } from '../hooks/useSyncMapData';
import { useLocation } from '../hooks/useLocation';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS, API_CONFIG } from '../theme';
import { Coordenadas } from '../types';

// Coordenadas del departamento de Caquetá, Colombia
const CAQUETA_CENTER = { latitud: 1.5, longitud: -75.0 };
const ZOOM_GENERAL = 7;
const ZOOM_UBICACION = 14;

type CapaActiva = 'plantaciones' | 'tecnicos' | 'mediciones' | 'veredas';

const ICONOS_ESPECIE: Record<string, string> = {
  cacao: '🍫',
  platano: '🍌',
  banano: '🍌',
  café: '☕',
  cafe: '☕',
  citricos: '🍊',
  cítricos: '🍊',
  naranja: '🍊',
  limón: '🍋',
  limon: '🍋',
  aguacate: '🥑',
  mango: '🥭',
  guanabana: '🍈',
  guanábana: '🍈',
  maracuya: '💜',
  maracuyá: '💜',
  forestal: '🌳',
  pasto: '🌿',
  maíz: '🌽',
  maiz: '🌽',
  yuca: '🥔',
  hortalizas: '🥬',
};

const getIconoEspecie = (especie: string): string => {
  const key = especie?.toLowerCase().trim() || '';
  return ICONOS_ESPECIE[key] || '🌱';
};

const MapaGeneralScreen: React.FC<{ navigation?: any }> = ({ navigation }) => {
  const { user, isAdmin, isSupervisor, isGerente } = useAuth();
  const canViewAll = isAdmin || isSupervisor || isGerente;

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

  const { getCurrentPosition } = useLocation();

  const [capasActivas, setCapasActivas] = useState<Set<CapaActiva>>(new Set(['plantaciones', 'tecnicos']));
  const [veredasFeatures, setVeredasFeatures] = useState<any[] | null>(null);
  const [selectedItem, setSelectedItem] = useState<any>(null);
  const [showList, setShowList] = useState(false);
  const [mapCenter, setMapCenter] = useState(CAQUETA_CENTER);
  const [mapZoom, setMapZoom] = useState(ZOOM_GENERAL);
  const [locating, setLocating] = useState(false);
  const [siguiendo, setSiguiendo] = useState(false);
  /** Posición GPS real del usuario, siempre actualizada por el watch */
  const [userLocation, setUserLocation] = useState<Coordenadas | undefined>(undefined);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const siguiendoRef = useRef(false);

  useEffect(() => {
    loadAll();
    syncAll();
    // Iniciar watch GPS inmediatamente al montar (siempre activo)
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') return;
      const sub = await Location.watchPositionAsync(
        {
          accuracy: Location.Accuracy.High,
          timeInterval: 5000,
          distanceInterval: 5,
        },
        (newPos) => {
          const { latitude, longitude } = newPos.coords;
          const pos: Coordenadas = { latitud: latitude, longitud: longitude };
          setUserLocation(pos);
          // Si estamos en modo siguiendo, actualizar el centro del mapa
          if (siguiendoRef.current) {
            setMapCenter(pos);
            setMapZoom(prev => prev < ZOOM_UBICACION ? ZOOM_UBICACION : prev);
          }
        }
      );
      watchRef.current = sub;
    })();

    return () => {
      if (watchRef.current) {
        watchRef.current.remove();
        watchRef.current = null;
      }
    };
  }, []);

  // Polling: refrescar datos del servidor cada 30s según capas activas
  useEffect(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    // Solo iniciar polling si hay al menos una capa que requiera datos del servidor
    if (capasActivas.has('tecnicos') || capasActivas.has('plantaciones') || capasActivas.has('mediciones')) {
      pollRef.current = setInterval(() => {
        if (capasActivas.has('tecnicos')) fetchUltimasPosiciones();
        if (capasActivas.has('plantaciones')) fetchAllPlantaciones();
        if (capasActivas.has('mediciones')) fetchAllMediciones();
      }, 30000); // 30 segundos
    }
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [capasActivas, fetchUltimasPosiciones, fetchAllPlantaciones, fetchAllMediciones]);

  const centrarEnMiUbicacion = useCallback(async () => {
    setLocating(true);
    try {
      // Obtener posición actual inmediata para centrar
      const coords = await getCurrentPosition();
      if (coords) {
        setMapCenter({ latitud: coords.latitud, longitud: coords.longitud });
        setMapZoom(ZOOM_UBICACION);
      } else if (userLocation) {
        // Fallback: usar la última posición conocida del watch
        setMapCenter(userLocation);
        setMapZoom(ZOOM_UBICACION);
      }
      setSiguiendo(true);
      siguiendoRef.current = true;
    } finally {
      setLocating(false);
    }
  }, [getCurrentPosition, userLocation]);

  const detenerSeguimiento = useCallback(() => {
    setSiguiendo(false);
    siguiendoRef.current = false;
    setMapCenter(CAQUETA_CENTER);
    setMapZoom(ZOOM_GENERAL);
  }, []);

  // Fetch datos de veredas
  const fetchVeredas = useCallback(async () => {
    try {
      const res = await fetch(`${API_CONFIG.BASE_URL}/api/maps/veredas`);
      if (res.ok) {
        const data = await res.json();
        if (data.veredas && data.veredas.length > 0) {
          // Extraer solo los features en un FeatureCollection plano
          const features = data.veredas.map((v: any) => ({
            ...v,
            // Asegurar geometría válida
            geometry: v.geometry || { type: 'MultiPolygon', coordinates: [] },
          }));
          setVeredasFeatures(features);
        }
      }
    } catch (err) {
      console.warn('[MapaGeneralScreen] Error fetching veredas:', err);
    }
  }, []);

  const toggleCapa = useCallback((capa: CapaActiva) => {
    setCapasActivas(prev => {
      const next = new Set(prev);
      const activando = !next.has(capa);
      if (next.has(capa)) {
        next.delete(capa);
      } else {
        next.add(capa);
      }
      // Refrescar datos inmediatamente al activar una capa
      if (activando) {
        setTimeout(() => {
          if (capa === 'tecnicos') fetchUltimasPosiciones();
          if (capa === 'plantaciones') fetchAllPlantaciones();
          if (capa === 'mediciones') fetchAllMediciones();
          if (capa === 'veredas') fetchVeredas();
        }, 100);
      }
      return next;
    });
  }, [fetchUltimasPosiciones, fetchAllPlantaciones, fetchAllMediciones, fetchVeredas]);

  // Construir markers para plantaciones
  const plantacionMarkers = capasActivas.has('plantaciones')
    ? plantaciones.map(p => ({
        id: `plant-${p.id}`,
        latitud: p.latitud,
        longitud: p.longitud,
        title: `${p.cantidad}x ${p.especie}`,
        icon: p.icono || getIconoEspecie(p.especie),
      }))
    : [];

  // Construir markers para técnicos
  const tecnicosMarkers = capasActivas.has('tecnicos')
    ? posiciones.map((pos: any) => ({
        id: `tec-${pos.id}`,
        latitud: pos.latitud,
        longitud: pos.longitud,
        title: pos.usuario_nombre || `Técnico: ${pos.usuario_id}`,
        color: '#1565C0',
        icon: '👤',
      }))
    : [];

  // Construir markers para mediciones (polígonos aproximados como un solo punto central)
  const medicionMarkers: any[] = capasActivas.has('mediciones')
    ? mediciones.reduce((acc: any[], m: any) => {
        const puntos = m.puntos || [];
        if (puntos.length === 0) return acc;
        const latCentro = puntos.reduce((s: number, p: any) => s + p.latitud, 0) / puntos.length;
        const lonCentro = puntos.reduce((s: number, p: any) => s + p.longitud, 0) / puntos.length;
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

  const allMarkers = [...plantacionMarkers, ...tecnicosMarkers, ...medicionMarkers];

  // Construir capa GeoJSON de veredas (si la capa está activa y tenemos datos)
  const veredaGeoLayer = capasActivas.has('veredas') && veredasFeatures && veredasFeatures.length > 0
    ? [{
        id: 'veredas',
        nombre: 'Veredas',
        features: veredasFeatures,
        fillColor: 'rgba(27, 94, 32, 0.12)',
        strokeColor: '#1B5E20',
        strokeWidth: 2,
        strokeOpacity: 0.5,
        fillOpacity: 0.12,
      }]
    : [];

  const handleConfirmDelete = (tipo: 'plantación' | 'medición', id: string) => {
    Alert.alert(
      `Eliminar ${tipo}`,
      `¿Estás seguro de eliminar esta ${tipo}? Esta acción no se puede deshacer.`,
      [
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
      ]
    );
  };

  const renderItemDetail = (item: any) => {
    if (!item) return null;

    const isPlantacion = item.id.startsWith('plant-');
    const isMedicion = item.id.startsWith('med-');
    const isTecnico = item.id.startsWith('tec-');

    const realId = item.id.replace(/^(plant-|med-|tec-)/, '');

    return (
      <View style={styles.detailCard}>
        <TouchableOpacity
          style={styles.detailClose}
          onPress={() => setSelectedItem(null)}
        >
          <Text style={styles.detailCloseText}>✕</Text>
        </TouchableOpacity>

        {isPlantacion && (
          <>
            <Text style={styles.detailTitle}>🌱 Plantación</Text>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Especie:</Text>
              <Text style={styles.detailValue}>
                {item.icon} {plantaciones.find((p: any) => p.id === realId)?.especie || '—'}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Cantidad:</Text>
              <Text style={styles.detailValue}>
                {plantaciones.find((p: any) => p.id === realId)?.cantidad || '—'}
              </Text>
            </View>
            {canViewAll && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Técnico:</Text>
                <Text style={styles.detailValue}>
                  {plantaciones.find((p: any) => p.id === realId)?.usuario_nombre || '—'}
                </Text>
              </View>
            )}
            {isAdmin && (
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => handleConfirmDelete('plantación', realId)}
              >
                <Text style={styles.deleteButtonText}>🗑 Eliminar plantación</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {isMedicion && (
          <>
            <Text style={styles.detailTitle}>📐 Medición de Terreno</Text>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Área:</Text>
              <Text style={styles.detailValue}>
                {mediciones.find((m: any) => m.id === realId)?.area_hectareas?.toFixed(2) || '?'} ha
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Perímetro:</Text>
              <Text style={styles.detailValue}>
                {mediciones.find((m: any) => m.id === realId)?.perimetro_metros?.toFixed(1) || '?'} m
              </Text>
            </View>
            {canViewAll && (
              <View style={styles.detailRow}>
                <Text style={styles.detailLabel}>Técnico:</Text>
                <Text style={styles.detailValue}>
                  {mediciones.find((m: any) => m.id === realId)?.usuario_nombre || '—'}
                </Text>
              </View>
            )}
            {isAdmin && (
              <TouchableOpacity
                style={styles.deleteButton}
                onPress={() => handleConfirmDelete('medición', realId)}
              >
                <Text style={styles.deleteButtonText}>🗑 Eliminar medición</Text>
              </TouchableOpacity>
            )}
          </>
        )}

        {isTecnico && (
          <>
            <Text style={styles.detailTitle}>👤 Técnico</Text>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Nombre:</Text>
              <Text style={styles.detailValue}>
                {posiciones.find((p: any) => p.id === realId)?.usuario_nombre || realId}
              </Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>ID:</Text>
              <Text style={styles.detailValue}>{realId}</Text>
            </View>
            <View style={styles.detailRow}>
              <Text style={styles.detailLabel}>Última actualización:</Text>
              <Text style={styles.detailValue}>
                {posiciones.find((p: any) => p.id === realId)?.timestamp
                  ? new Date(posiciones.find((p: any) => p.id === realId)?.timestamp).toLocaleString()
                  : '—'}
              </Text>
            </View>
          </>
        )}
      </View>
    );
  };

  const renderListItem = (item: any) => {
    const isPlantacion = item.id.startsWith('plant-');
    const isMedicion = item.id.startsWith('med-');
    const realId = item.id.replace(/^(plant-|med-|tec-)/, '');

    if (isPlantacion) {
      const p = plantaciones.find((x: any) => x.id === realId);
      if (!p) return null;
      return (
        <TouchableOpacity
          key={item.id}
          style={styles.listItem}
          onPress={() => setSelectedItem(item)}
        >
          <Text style={styles.listItemIcon}>{p.icono || getIconoEspecie(p.especie)}</Text>
          <View style={styles.listItemContent}>
            <Text style={styles.listItemTitle}>{p.especie}</Text>
            <Text style={styles.listItemSubtitle}>{p.cantidad} plantas</Text>
          </View>
          {isAdmin && (
            <TouchableOpacity onPress={() => handleConfirmDelete('plantación', realId)}>
              <Text style={styles.listDeleteIcon}>🗑</Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      );
    }

    if (isMedicion) {
      const m = mediciones.find((x: any) => x.id === realId);
      if (!m) return null;
      return (
        <TouchableOpacity
          key={item.id}
          style={styles.listItem}
          onPress={() => setSelectedItem(item)}
        >
          <Text style={styles.listItemIcon}>📐</Text>
          <View style={styles.listItemContent}>
            <Text style={styles.listItemTitle}>{m.area_hectareas?.toFixed(2)} ha</Text>
            <Text style={styles.listItemSubtitle}>Perímetro: {m.perimetro_metros?.toFixed(1)} m</Text>
          </View>
          {isAdmin && (
            <TouchableOpacity onPress={() => handleConfirmDelete('medición', realId)}>
              <Text style={styles.listDeleteIcon}>🗑</Text>
            </TouchableOpacity>
          )}
        </TouchableOpacity>
      );
    }

    return null;
  };

  return (
    <View style={styles.container}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>
          {canViewAll ? 'Mapa General del Proyecto' : 'Mis Plantaciones'}
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

      {/* Capas Toggle */}
      {canViewAll && (
        <View style={styles.capasContainer}>
          <TouchableOpacity
            style={[styles.capaBadge, capasActivas.has('plantaciones') && styles.capaBadgeActive]}
            onPress={() => toggleCapa('plantaciones')}
          >
            <Text style={[styles.capaText, capasActivas.has('plantaciones') && styles.capaTextActive]}>
              🌱 Plantaciones ({plantaciones.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.capaBadge, capasActivas.has('tecnicos') && styles.capaBadgeActive]}
            onPress={() => toggleCapa('tecnicos')}
          >
            <Text style={[styles.capaText, capasActivas.has('tecnicos') && styles.capaTextActive]}>
              👤 Técnicos ({posiciones.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.capaBadge, capasActivas.has('mediciones') && styles.capaBadgeActive]}
            onPress={() => toggleCapa('mediciones')}
          >
            <Text style={[styles.capaText, capasActivas.has('mediciones') && styles.capaTextActive]}>
              📐 Mediciones ({mediciones.length})
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.capaBadge, capasActivas.has('veredas') && styles.capaBadgeActive]}
            onPress={() => toggleCapa('veredas')}
          >
            <Text style={[styles.capaText, capasActivas.has('veredas') && styles.capaTextActive]}>
              🗺️ Veredas ({veredasFeatures?.length || 0})
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Barra de herramientas del mapa */}
      <View style={styles.mapToolbar}>
        <TouchableOpacity
          style={[styles.locationButton, siguiendo && styles.locationButtonActive]}
          onPress={centrarEnMiUbicacion}
          disabled={locating}
        >
          <Text style={styles.locationButtonText}>
            {locating ? '⋯' : siguiendo ? '🟢 Siguiendo' : '📍 Mi ubicación'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.resetButton}
          onPress={detenerSeguimiento}
        >
          <Text style={styles.resetButtonText}>🗺️ Caquetá</Text>
        </TouchableOpacity>
      </View>

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

      {/* Botón toggle lista */}
      {allMarkers.length > 0 && (
        <TouchableOpacity
          style={styles.toggleListButton}
          onPress={() => setShowList(prev => !prev)}
        >
          <Text style={styles.toggleListText}>
            {showList ? '▼ Ocultar lista' : `▲ Ver lista (${allMarkers.length})`}
          </Text>
        </TouchableOpacity>
      )}

      {/* Lista de items */}
      {showList && (
        <ScrollView style={styles.listContainer} contentContainerStyle={styles.listContent}>
          {allMarkers.map(item => renderListItem(item))}
        </ScrollView>
      )}

      {/* Detalle del item seleccionado */}
      {selectedItem && renderItemDetail(selectedItem)}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
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
  refreshText: {
    fontSize: 20,
    color: COLORS.primary,
  },
  mapToolbar: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  locationButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.primary,
  },
  locationButtonActive: {
    backgroundColor: COLORS.success || '#2E7D32',
  },
  locationButtonText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.semibold,
  },
  resetButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  resetButtonText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.medium,
  },
  capasContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    gap: 6,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  capaBadge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  capaBadgeActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  capaText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.medium,
  },
  capaTextActive: {
    color: COLORS.textOnPrimary,
  },
  mapContainer: {
    flex: 1,
    minHeight: 300,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.mapTileBackground,
  },
  loadingText: {
    marginTop: SPACING.sm,
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
  },
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
  listContainer: {
    maxHeight: 200,
    backgroundColor: COLORS.surface,
  },
  listContent: {
    padding: SPACING.sm,
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  listItemIcon: {
    fontSize: 24,
    marginRight: SPACING.md,
  },
  listItemContent: {
    flex: 1,
  },
  listItemTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  listItemSubtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  listDeleteIcon: {
    fontSize: 18,
  },
  detailCard: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    padding: SPACING.lg,
    ...SHADOWS.lg,
  },
  detailClose: {
    position: 'absolute',
    top: SPACING.sm,
    right: SPACING.sm,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  detailCloseText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: FONTS.weights.bold,
  },
  detailTitle: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  detailRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  detailLabel: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
  },
  detailValue: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  deleteButton: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.error + '15',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.error + '30',
  },
  deleteButtonText: {
    color: COLORS.error,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
  },
});

export default MapaGeneralScreen;
