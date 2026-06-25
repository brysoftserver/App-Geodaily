// ============================================================
// GEODAILY — Mapa de Técnicos en Tiempo Real (Gerencia)
// ============================================================
// Muestra la última ubicación conocida de cada técnico en un
// mapa MapLibre con marcadores, consumiendo datos de la tabla
// tracking_posiciones en SQLite.
// ============================================================

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { getUltimasPosicionesTecnicos } from '../../services/database';
import MapViewOffline from '../../components/MapViewOffline';

type MapaTecnicosProps = {
  navigation: any;
};

interface TecnicoUbicacion {
  usuario_id: string;
  latitud: number;
  longitud: number;
  altitud?: number;
  precision_gps?: number;
  velocidad?: number;
  heading?: number;
  timestamp: string;
  nombre?: string;
}

const MapaTecnicosScreen: React.FC<MapaTecnicosProps> = ({ navigation }) => {
  const [tecnicos, setTecnicos] = useState<TecnicoUbicacion[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<string>('');

  const cargarPosiciones = useCallback(async () => {
    try {
      setLoading(true);
      const posiciones = await getUltimasPosicionesTecnicos();
      const tecnicosMap = posiciones.map((p: any) => ({
        usuario_id: p.usuario_id,
        latitud: p.latitud,
        longitud: p.longitud,
        altitud: p.altitud,
        precision_gps: p.precision_gps,
        velocidad: p.velocidad,
        heading: p.heading,
        timestamp: p.timestamp,
        nombre: p.tecnico_nombre || p.usuario_id,
      }));
      setTecnicos(tecnicosMap);
      setLastUpdate(new Date().toLocaleTimeString('es-CO'));
    } catch (error) {
      console.warn('[MapaTecnicos] Error cargando posiciones:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  // Recargar al enfocar la pantalla
  useFocusEffect(
    useCallback(() => {
      cargarPosiciones();
    }, [cargarPosiciones])
  );

  // Preparar marcadores para el mapa
  const markers = tecnicos.map((t, i) => ({
    id: t.usuario_id || `tec-${i}`,
    latitud: t.latitud,
    longitud: t.longitud,
    title: t.nombre || t.usuario_id,
    color: COLORS.roleTecnico,
  }));

  // Centro del mapa: promedio de todas las coordenadas
  const centroMapa = tecnicos.length > 0
    ? {
        latitud: tecnicos.reduce((s, t) => s + t.latitud, 0) / tecnicos.length,
        longitud: tecnicos.reduce((s, t) => s + t.longitud, 0) / tecnicos.length,
        altitud: 0,
        precision_gps: 0,
        timestamp: '',
      }
    : undefined;

  const formatUltimaActividad = (ts: string) => {
    const diff = Date.now() - new Date(ts).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return 'Ahora';
    if (mins < 60) return `Hace ${mins} min`;
    const hours = Math.floor(mins / 60);
    return `Hace ${hours}h ${mins % 60}min`;
  };

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.surface} />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Header */}
        <View style={styles.header}>
          <Text style={styles.title}>📍 Ubicación de Técnicos</Text>
          <Text style={styles.subtitle}>
            {tecnicos.length} técnico(s) en campo · Actualizado: {lastUpdate}
          </Text>
        </View>

        {/* Mapa con marcadores */}
        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color={COLORS.roleGerente} />
            <Text style={styles.loadingText}>Cargando posiciones...</Text>
          </View>
        ) : tecnicos.length > 0 ? (
          <View style={styles.mapContainer}>
            <MapViewOffline
              center={centroMapa}
              zoom={10}
              height={350}
              markers={markers}
              showUserLocation={false}
              interactive={true}
            />
            <TouchableOpacity style={styles.refreshBtn} onPress={cargarPosiciones}>
              <Text style={styles.refreshBtnText}>🔄 Actualizar</Text>
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.mapPlaceholder}>
            <Text style={styles.mapPlaceholderIcon}>🗺️</Text>
            <Text style={styles.mapPlaceholderTitle}>Sin datos de ubicación</Text>
            <Text style={styles.mapPlaceholderText}>
              No hay posiciones GPS registradas aún. Las ubicaciones aparecerán
              cuando los técnicos en campo activen el módulo de rastreo.
            </Text>
          </View>
        )}

        {/* Lista de técnicos con última ubicación */}
        <Text style={styles.sectionTitle}>Última actividad conocida</Text>
        {tecnicos.map((t, i) => (
          <View key={t.usuario_id || i} style={styles.tecnicoRow}>
            <View style={[styles.dot, { backgroundColor: COLORS.roleTecnico }]} />
            <View style={styles.tecnicoInfo}>
              <Text style={styles.tecnicoNombre}>{t.nombre || t.usuario_id}</Text>
              <Text style={styles.tecnicoMeta}>
                {t.latitud.toFixed(5)}, {t.longitud.toFixed(5)}
                {t.precision_gps ? ` ±${Math.round(t.precision_gps)}m` : ''}
              </Text>
              <Text style={styles.tecnicoMeta}>
                {formatUltimaActividad(t.timestamp)}
                {t.velocidad !== undefined && t.velocidad !== null
                  ? ` · ${(t.velocidad * 3.6).toFixed(1)} km/h`
                  : ''}
              </Text>
            </View>
            <View style={styles.statusBadge}>
              <Text style={styles.statusText}>En vivo</Text>
            </View>
          </View>
        ))}

        {tecnicos.length === 0 && !loading && (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>👥</Text>
            <Text style={styles.emptyText}>No hay técnicos con actividad registrada.</Text>
          </View>
        )}

        {/* Info de funcionalidad */}
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>ℹ️ Rastreo en tiempo real</Text>
          <Text style={styles.infoText}>
            Las ubicaciones se actualizan automáticamente desde los dispositivos
            de campo. Los datos provienen del módulo de tracking GPS que se activa
            cuando los técnicos inician sesión en la app.
          </Text>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xl },
  header: { marginBottom: SPACING.md },
  title: { fontSize: FONTS.sizes.xxl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  subtitle: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 2 },
  loadingContainer: {
    height: 350,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.lg,
  },
  loadingText: { fontSize: FONTS.sizes.md, color: COLORS.textSecondary, marginTop: SPACING.md },
  mapContainer: {
    borderRadius: BORDER_RADIUS.lg,
    overflow: 'hidden',
    marginBottom: SPACING.lg,
    ...SHADOWS.lg,
  },
  refreshBtn: {
    position: 'absolute',
    top: 10,
    right: 10,
    backgroundColor: COLORS.surface,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.full,
    ...SHADOWS.sm,
  },
  refreshBtnText: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  mapPlaceholder: {
    backgroundColor: COLORS.surfaceAlt,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.xl,
    alignItems: 'center',
    marginBottom: SPACING.lg,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderStyle: 'dashed',
  },
  mapPlaceholderIcon: { fontSize: 48, marginBottom: SPACING.md },
  mapPlaceholderTitle: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, marginBottom: SPACING.xs },
  mapPlaceholderText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, textAlign: 'center', lineHeight: 20 },
  sectionTitle: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  tecnicoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.sm,
    ...SHADOWS.sm,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: SPACING.md },
  tecnicoInfo: { flex: 1 },
  tecnicoNombre: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  tecnicoMeta: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 2, fontFamily: 'monospace' },
  statusBadge: {
    backgroundColor: COLORS.success + '20',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.full,
  },
  statusText: { fontSize: FONTS.sizes.xs, color: COLORS.success, fontWeight: FONTS.weights.semibold },
  emptyState: { alignItems: 'center', paddingVertical: SPACING.xxl },
  emptyIcon: { fontSize: 48, marginBottom: SPACING.md },
  emptyText: { fontSize: FONTS.sizes.md, color: COLORS.textSecondary },
  infoCard: {
    backgroundColor: COLORS.info + '10',
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.md,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.info,
  },
  infoTitle: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.info, marginBottom: SPACING.xs },
  infoText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, lineHeight: 20 },
});

export default MapaTecnicosScreen;
