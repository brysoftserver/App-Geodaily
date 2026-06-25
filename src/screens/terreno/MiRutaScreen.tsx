// ============================================================
// GEODAILY — Mi Ruta (Tracking GPS en Tiempo Real)
// ============================================================

import React, { useState, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Alert,
  Dimensions,
} from 'react-native';
import { WebView } from 'react-native-webview';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useAuth } from '../../store/AuthContext';
import { useTracking } from '../../hooks/useTracking';

const MiRutaScreen: React.FC = () => {
  const { user } = useAuth();
  const {
    activo,
    posiciones,
    distanceKm,
    inicio,
    iniciarTracking,
    detenerTracking,
    posicionesHoy,
    limpiarHistorial,
  } = useTracking(user?.id || 'unknown');

  const [historial, setHistorial] = useState<{
    count: number;
    desde?: string;
  } | null>(null);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);

  const handleIniciar = useCallback(async () => {
    await iniciarTracking();
  }, [iniciarTracking]);

  const handleDetener = useCallback(async () => {
    Alert.alert(
      'Detener Tracking',
      `Se registrarán ${posiciones.length} puntos recorridos. ¿Deseas finalizar el tracking?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Detener',
          style: 'destructive',
          onPress: async () => {
            await detenerTracking();
          },
        },
      ]
    );
  }, [detenerTracking, posiciones.length]);

  const handleCargarHistorial = useCallback(async () => {
    setCargandoHistorial(true);
    const hoy = await posicionesHoy();
    setHistorial({
      count: hoy.length,
      desde: hoy.length > 0 ? hoy[0].timestamp : undefined,
    });
    setCargandoHistorial(false);
  }, [posicionesHoy]);

  const handleLimpiar = useCallback(() => {
    Alert.alert(
      'Limpiar historial',
      '¿Eliminar todos los registros de tracking? Esta acción no se puede deshacer.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Limpiar',
          style: 'destructive',
          onPress: limpiarHistorial,
        },
      ]
    );
  }, [limpiarHistorial]);

  const formatTiempo = (iso?: string): string => {
    if (!iso) return '—';
    const d = new Date(iso);
    return d.toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' });
  };

  const formatDistancia = (km: number): string => {
    if (km < 1) return `${Math.round(km * 1000)} m`;
    return `${km.toFixed(2)} km`;
  };

  // Generar HTML con mapa Leaflet para mostrar ruta
  const mapaHtml = useMemo(() => {
    if (posiciones.length === 0) return null;

    const puntos = posiciones.map(p => `[${p.latitud},${p.longitud}]`).join(',');
    const ultimo = posiciones[posiciones.length - 1];

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
        const map = L.map('map', { zoomControl: false, attributionControl: false });
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
          maxZoom: 19
        }).addTo(map);

        const puntos = [${puntos}];
        const polyline = L.polyline(puntos, {
          color: '#1B5E20',
          weight: 4,
          opacity: 0.8
        }).addTo(map);

        // Marcador de inicio (verde)
        if (puntos.length > 0) {
          L.circleMarker(puntos[0], {
            radius: 8,
            fillColor: '#4CAF50',
            color: '#fff',
            weight: 2,
            fillOpacity: 1
          }).addTo(map).bindPopup('Inicio');
        }

        // Marcador de posición actual (azul)
        L.circleMarker([${ultimo.latitud}, ${ultimo.longitud}], {
          radius: 10,
          fillColor: '#2196F3',
          color: '#fff',
          weight: 3,
          fillOpacity: 1
        }).addTo(map).bindPopup('📍 Posición actual');

        map.fitBounds(polyline.getBounds().pad(0.1));
      </script>
    </body>
    </html>`;
  }, [posiciones]);

  const { width: SCREEN_WIDTH } = Dimensions.get('window');

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        {/* Tarjeta de estado */}
        <View style={[styles.statusCard, activo ? styles.statusCardActive : styles.statusCardInactive]}>
          <View style={styles.statusHeader}>
            <View style={[styles.statusDot, activo ? styles.statusDotActive : styles.statusDotInactive]} />
            <Text style={styles.statusTitle}>
              {activo ? 'Tracking Activo' : 'Tracking Detenido'}
            </Text>
          </View>
          <Text style={styles.statusDesc}>
            {activo
              ? 'Registrando tu ubicación cada 15 segundos'
              : 'Presiona "Iniciar" para comenzar a registrar tu ruta'}
          </Text>
        </View>

        {/* Estadísticas */}
        <View style={styles.statsGrid}>
          <View style={styles.statCard}>
            <Text style={styles.statIcon}>📍</Text>
            <Text style={styles.statValue}>{posiciones.length}</Text>
            <Text style={styles.statLabel}>Puntos</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statIcon}>🕐</Text>
            <Text style={styles.statValue}>{formatTiempo(inicio)}</Text>
            <Text style={styles.statLabel}>Inicio</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statIcon}>📏</Text>
            <Text style={styles.statValue}>{formatDistancia(distanceKm)}</Text>
            <Text style={styles.statLabel}>Distancia</Text>
          </View>
          <View style={styles.statCard}>
            <Text style={styles.statIcon}>⏱️</Text>
            <Text style={styles.statValue}>
              {activo
                ? `${Math.floor(
                    (Date.now() - (inicio ? new Date(inicio).getTime() : Date.now())) /
                      60000
                  )} min`
                : '—'}
            </Text>
            <Text style={styles.statLabel}>Duración</Text>
          </View>
        </View>

        {/* Botones de acción */}
        <View style={styles.actionRow}>
          {!activo ? (
            <TouchableOpacity style={styles.startBtn} onPress={handleIniciar}>
              <Text style={styles.startBtnText}>▶ Iniciar Tracking</Text>
            </TouchableOpacity>
          ) : (
            <TouchableOpacity style={styles.stopBtn} onPress={handleDetener}>
              <Text style={styles.stopBtnText}>⏹ Detener Tracking</Text>
            </TouchableOpacity>
          )}
        </View>

        {/* Mapa de ruta */}
        {posiciones.length > 1 && mapaHtml && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>🗺️ Mapa de Ruta</Text>
            <View style={styles.mapaContainer}>
              <WebView
                source={{ html: mapaHtml }}
                style={styles.mapaWebView}
                originWhitelist={['*']}
                javaScriptEnabled={true}
                scrollEnabled={false}
                scalesPageToFit={false}
              />
            </View>
            <Text style={styles.mapaLegend}>
              🟢 Inicio · 🔵 Posición actual · 🟢 Ruta recorrida
            </Text>
          </View>
        )}

        {/* Historial del día */}
        <View style={styles.sectionCard}>
          <Text style={styles.sectionTitle}>📊 Historial de Hoy</Text>
          <TouchableOpacity
            style={styles.historyBtn}
            onPress={handleCargarHistorial}
            disabled={cargandoHistorial}
          >
            <Text style={styles.historyBtnText}>
              {cargandoHistorial ? 'Cargando...' : 'Cargar puntos de hoy'}
            </Text>
          </TouchableOpacity>
          {historial && (
            <View style={styles.historyInfo}>
              <Text style={styles.historyInfoText}>
                {historial.count} punto(s) registrados hoy
              </Text>
              {historial.desde && (
                <Text style={styles.historyInfoSub}>
                  Desde las {formatTiempo(historial.desde)}
                </Text>
              )}
            </View>
          )}
        </View>

        {/* Timeline de últimas posiciones */}
        {posiciones.length > 0 && (
          <View style={styles.sectionCard}>
            <Text style={styles.sectionTitle}>🗺️ Últimas posiciones</Text>
            {posiciones
              .slice(-10)
              .reverse()
              .map((pos, idx) => (
                <View key={pos.id} style={styles.timelineRow}>
                  <View style={styles.timelineDot} />
                  <View style={styles.timelineContent}>
                    <Text style={styles.timelineTime}>
                      {new Date(pos.timestamp).toLocaleTimeString('es-CO', {
                        hour: '2-digit',
                        minute: '2-digit',
                        second: '2-digit',
                      })}
                    </Text>
                    <Text style={styles.timelineCoords}>
                      {pos.latitud.toFixed(6)}, {pos.longitud.toFixed(6)}
                    </Text>
                  </View>
                  {pos.precision_gps && (
                    <Text style={styles.timelinePrecision}>
                      ±{pos.precision_gps.toFixed(0)}m
                    </Text>
                  )}
                </View>
              ))}
          </View>
        )}

        {/* Limpiar historial */}
        <TouchableOpacity style={styles.clearBtn} onPress={handleLimpiar}>
          <Text style={styles.clearBtnText}>🗑️ Limpiar todo el historial</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  // --- Status ---
  statusCard: {
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  statusCardActive: {
    backgroundColor: COLORS.success + '15',
    borderWidth: 1,
    borderColor: COLORS.success + '40',
  },
  statusCardInactive: {
    backgroundColor: COLORS.surface,
  },
  statusHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  statusDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: SPACING.sm,
  },
  statusDotActive: {
    backgroundColor: COLORS.success,
  },
  statusDotInactive: {
    backgroundColor: COLORS.textLight,
  },
  statusTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  statusDesc: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  // --- Stats ---
  statsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
    marginBottom: SPACING.md,
  },
  statCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  statIcon: {
    fontSize: 24,
    marginBottom: SPACING.xs,
  },
  statValue: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  statLabel: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  // --- Actions ---
  actionRow: {
    marginBottom: SPACING.md,
  },
  startBtn: {
    backgroundColor: COLORS.success,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  startBtnText: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textOnPrimary,
  },
  stopBtn: {
    backgroundColor: COLORS.error,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  stopBtnText: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textOnPrimary,
  },
  // --- Section Card ---
  sectionCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  historyBtn: {
    backgroundColor: COLORS.background,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
  },
  historyBtnText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.primary,
  },
  historyInfo: {
    marginTop: SPACING.sm,
    backgroundColor: COLORS.surfaceAlt,
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  historyInfoText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  historyInfoSub: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  // --- Timeline ---
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  timelineDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: COLORS.primary,
    marginRight: SPACING.md,
  },
  timelineContent: {
    flex: 1,
  },
  timelineTime: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  timelineCoords: {
    fontSize: FONTS.sizes.xs,
    fontFamily: 'monospace',
    color: COLORS.textSecondary,
  },
  timelinePrecision: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
  },
  // --- Clear ---
  clearBtn: {
    paddingVertical: SPACING.md,
    alignItems: 'center',
  },
  clearBtnText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.error,
    fontWeight: FONTS.weights.medium,
  },
  // --- Mapa ---
  mapaContainer: {
    height: 250,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    marginTop: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  mapaWebView: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  mapaLegend: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },
});

export default MiRutaScreen;
