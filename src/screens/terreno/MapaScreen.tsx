// ============================================================
// GEODAILY — Pantalla de Mapa Offline
// ============================================================
// Mapa interactivo completo con teselas offline desde el
// servidor QGIS. Incluye GPS, marcadores y coordenadas.
// ============================================================

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  Platform,
} from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useLocation } from '../../hooks/useLocation';
import MapViewOffline from '../../components/MapViewOffline';

interface MarkerTemporal {
  id: string;
  latitud: number;
  longitud: number;
  title: string;
  color: string;
}

const MapaScreen: React.FC = () => {
  const { coordenadas, getCurrentPosition, isLoading: gpsLoading } = useLocation();
  const [marcadores, setMarcadores] = useState<MarkerTemporal[]>([]);
  const [ultimaCoordenada, setUltimaCoordenada] = useState<{
    latitud: number;
    longitud: number;
  } | null>(null);
  const [mostrarInfo, setMostrarInfo] = useState(false);
  const [modoSeleccion, setModoSeleccion] = useState(false);

  // Centrar en ubicación actual al cargar
  const centrarEnGPS = useCallback(async () => {
    const coords = await getCurrentPosition();
    if (coords) {
      setUltimaCoordenada(null); // Limpia selección manual
    }
  }, [getCurrentPosition]);

  // Manejar tap en el mapa
  const handleMapPress = useCallback((latitud: number, longitud: number) => {
    setUltimaCoordenada({ latitud, longitud });
    setMostrarInfo(true);

    if (modoSeleccion) {
      const nuevoMarker: MarkerTemporal = {
        id: `marcador_${Date.now()}`,
        latitud,
        longitud,
        title: `Punto seleccionado`,
        color: COLORS.secondary,
      };
      setMarcadores((prev) => [...prev, nuevoMarker]);
      setModoSeleccion(false);
    }
  }, [modoSeleccion]);

  // Limpiar marcadores temporales
  const limpiarMarcadores = useCallback(() => {
    setMarcadores([]);
    setUltimaCoordenada(null);
    setMostrarInfo(false);
  }, []);

  // Alternar modo selección de puntos
  const toggleModoSeleccion = useCallback(() => {
    setModoSeleccion((prev) => !prev);
    setMostrarInfo(false);
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.surface} />

      {/* Mapa */}
      <View style={styles.mapContainer}>
        <MapViewOffline
          center={coordenadas ?? undefined}
          zoom={15}
          height={'100%'}
          markers={marcadores}
          showUserLocation={true}
          interactive={true}
          onMapPress={handleMapPress}
        />

        {/* Overlay de coordenadas al tocar el mapa */}
        {ultimaCoordenada && mostrarInfo && (
          <View style={styles.coordsOverlay}>
            <Text style={styles.coordsLabel}>Coordenadas del punto</Text>
            <Text style={styles.coordsValue}>
              Lat: {ultimaCoordenada.latitud.toFixed(6)}
            </Text>
            <Text style={styles.coordsValue}>
              Lon: {ultimaCoordenada.longitud.toFixed(6)}
            </Text>
            <TouchableOpacity
              style={styles.coordsCloseBtn}
              onPress={() => setMostrarInfo(false)}
            >
              <Text style={styles.coordsCloseText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>

      {/* Barra de herramientas inferior */}
      <View style={styles.toolbar}>
        {/* Botón GPS */}
        <TouchableOpacity
          style={[styles.toolBtn, gpsLoading && styles.toolBtnDisabled]}
          onPress={centrarEnGPS}
          disabled={gpsLoading}
        >
          <Text style={styles.toolBtnIcon}>📍</Text>
          <Text style={styles.toolBtnLabel}>
            {gpsLoading ? 'GPS...' : 'Mi Ubicación'}
          </Text>
        </TouchableOpacity>

        {/* Botón modo selección */}
        <TouchableOpacity
          style={[
            styles.toolBtn,
            modoSeleccion && styles.toolBtnActive,
          ]}
          onPress={toggleModoSeleccion}
        >
          <Text style={styles.toolBtnIcon}>📌</Text>
          <Text style={[styles.toolBtnLabel, modoSeleccion && styles.toolBtnLabelActive]}>
            {modoSeleccion ? 'Cancelar' : 'Marcar Punto'}
          </Text>
        </TouchableOpacity>

        {/* Contador de marcadores */}
        <View style={styles.toolInfo}>
          <Text style={styles.toolInfoText}>
            {marcadores.length} punto(s)
          </Text>
          {marcadores.length > 0 && (
            <TouchableOpacity onPress={limpiarMarcadores}>
              <Text style={styles.toolInfoClear}>Limpiar</Text>
            </TouchableOpacity>
          )}
        </View>
      </View>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  mapContainer: {
    flex: 1,
    position: 'relative',
  },
  // --- Overlay coordenadas ---
  coordsOverlay: {
    position: 'absolute',
    bottom: SPACING.md,
    left: SPACING.md,
    right: SPACING.md,
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    ...SHADOWS.md,
  },
  coordsLabel: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.primary,
    marginBottom: SPACING.xs,
  },
  coordsValue: {
    fontSize: FONTS.sizes.sm,
    fontFamily: 'monospace',
    color: COLORS.textPrimary,
    marginBottom: 2,
  },
  coordsCloseBtn: {
    alignSelf: 'flex-end',
    marginTop: SPACING.xs,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.sm,
  },
  coordsCloseText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.medium,
  },
  // --- Toolbar ---
  toolbar: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
    ...SHADOWS.sm,
  },
  toolBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    marginRight: SPACING.sm,
  },
  toolBtnDisabled: {
    opacity: 0.5,
  },
  toolBtnActive: {
    backgroundColor: COLORS.error + '20',
    borderWidth: 1,
    borderColor: COLORS.error,
  },
  toolBtnIcon: {
    fontSize: 16,
    marginRight: SPACING.xs,
  },
  toolBtnLabel: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  toolBtnLabelActive: {
    color: COLORS.error,
  },
  toolInfo: {
    flex: 1,
    alignItems: 'flex-end',
  },
  toolInfoText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  toolInfoClear: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.info,
    fontWeight: FONTS.weights.medium,
    marginTop: 2,
  },
});

export default MapaScreen;
