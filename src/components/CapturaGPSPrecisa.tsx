// ============================================================
// GEODAILY — Captura GPS de alta precisión
// ============================================================
// Botón de captura de coordenadas que, en vez de tomar una sola lectura,
// muestrea la posición durante unos segundos (cuenta regresiva visible)
// y se queda con la lectura de menor error (mayor precisión) obtenida en
// ese lapso. Al terminar, muestra el resultado y un mapa pequeño incrustado
// con el punto capturado, más un botón para volver a capturar si el punto
// quedó mal.
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import * as Location from 'expo-location';
import MapViewOffline from './MapViewOffline';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../theme';

/** Duración de la cuenta regresiva de captura, en segundos. */
const DURACION_CAPTURA_SEG = 8;

interface MejorLectura {
  latitud: number;
  longitud: number;
  altitud?: number;
  precision: number;
}

interface CapturaGPSPrecisaProps {
  label: string;
  latitud?: string;
  longitud?: string;
  altitud?: string;
  /** Precisión (radio de error en metros) de la última captura, si existe. */
  precision?: string;
  /**
   * Municipio/vereda del formulario, para mostrarlo como referencia sobre
   * el mapa. El mapa satelital no tiene etiquetas de lugar (y el estilo
   * "relieve" con etiquetas no tiene cobertura en veredas rurales — ver
   * nota en pdfLocal.service.ts), así que en vez de depender de que el
   * mapa muestre el nombre, se usa el dato que el formulario ya conoce.
   */
  ubicacionTexto?: string;
  onCapture: (latitud: string, longitud: string, altitud: string, precision: string) => void;
}

const CapturaGPSPrecisa: React.FC<CapturaGPSPrecisaProps> = ({
  label,
  latitud,
  longitud,
  altitud,
  precision,
  ubicacionTexto,
  onCapture,
}) => {
  const [capturando, setCapturando] = useState(false);
  const [segundosRestantes, setSegundosRestantes] = useState(DURACION_CAPTURA_SEG);

  const mejorLecturaRef = useRef<MejorLectura | null>(null);
  const subscripcionRef = useRef<Location.LocationSubscription | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const detenerMuestreo = useCallback(() => {
    subscripcionRef.current?.remove();
    subscripcionRef.current = null;
    if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  // Si el componente se desmonta a mitad de la cuenta regresiva (el técnico
  // navega a otra sección), no debe quedar un watcher de GPS corriendo.
  useEffect(() => () => detenerMuestreo(), [detenerMuestreo]);

  const iniciarCaptura = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso de ubicación', 'Se necesita el permiso de ubicación para capturar las coordenadas.');
      return;
    }

    mejorLecturaRef.current = null;
    setSegundosRestantes(DURACION_CAPTURA_SEG);
    setCapturando(true);

    try {
      subscripcionRef.current = await Location.watchPositionAsync(
        { accuracy: Location.Accuracy.BestForNavigation, timeInterval: 500, distanceInterval: 0 },
        (pos) => {
          const precisionActual = pos.coords.accuracy ?? Infinity;
          const mejorActual = mejorLecturaRef.current;
          if (!mejorActual || precisionActual < mejorActual.precision) {
            mejorLecturaRef.current = {
              latitud: pos.coords.latitude,
              longitud: pos.coords.longitude,
              altitud: pos.coords.altitude ?? undefined,
              precision: precisionActual,
            };
          }
        }
      );
    } catch {
      detenerMuestreo();
      setCapturando(false);
      Alert.alert('Sin señal GPS', 'No se pudo obtener la ubicación. Verifica el permiso de ubicación y vuelve a intentar.');
      return;
    }

    timerRef.current = setInterval(() => {
      setSegundosRestantes((prev) => {
        if (prev <= 1) {
          detenerMuestreo();
          setCapturando(false);
          const mejor = mejorLecturaRef.current;
          if (mejor) {
            onCapture(
              String(mejor.latitud),
              String(mejor.longitud),
              mejor.altitud != null ? String(Math.round(mejor.altitud)) : '',
              Number.isFinite(mejor.precision) ? String(Math.round(mejor.precision)) : ''
            );
          } else {
            Alert.alert('Sin señal GPS', 'No se pudo obtener la ubicación. Verifica el permiso de ubicación y vuelve a intentar.');
          }
          return DURACION_CAPTURA_SEG;
        }
        return prev - 1;
      });
    }, 1000);
  }, [detenerMuestreo, onCapture]);

  const hayCaptura = !!(latitud && longitud);

  return (
    <View style={styles.fieldContainer}>
      <Text style={styles.fieldLabel}>{label}</Text>

      {!capturando && (
        <TouchableOpacity style={styles.gpsButton} onPress={iniciarCaptura} activeOpacity={0.7}>
          <Text style={styles.gpsButtonText}>{hayCaptura ? '🔄 Volver a capturar' : '📍 Capturar ubicación'}</Text>
        </TouchableOpacity>
      )}

      {capturando && (
        <View style={[styles.gpsButton, styles.gpsButtonContando]}>
          <Text style={styles.gpsButtonText}>📡 Obteniendo ubicación de alta precisión… {segundosRestantes}s</Text>
        </View>
      )}

      {!capturando && hayCaptura && (
        <>
          <Text style={styles.gpsResultado}>
            Lat: {latitud}   Lon: {longitud}
            {altitud ? `   Alt: ${altitud} m` : ''}
            {precision ? `   Precisión: ±${precision} m` : ''}
          </Text>
          <View style={styles.gpsMiniMapContainer}>
            {ubicacionTexto && (
              <View style={styles.gpsUbicacionBadge}>
                <Text style={styles.gpsUbicacionBadgeText}>📍 {ubicacionTexto}</Text>
              </View>
            )}
            <MapViewOffline
              center={{ latitud: Number(latitud), longitud: Number(longitud) }}
              zoom={14}
              height={160}
              mapStyle="satelite"
              markers={[{ id: 'captura', latitud: Number(latitud), longitud: Number(longitud), tipoIcono: 'pin', color: COLORS.primary }]}
              interactive={false}
            />
          </View>
        </>
      )}

      {!capturando && !hayCaptura && <Text style={styles.gpsPendiente}>Aún sin capturar</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  fieldContainer: {
    marginBottom: SPACING.md,
  },
  fieldLabel: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  gpsButton: {
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm + 2,
    alignItems: 'center',
  },
  gpsButtonContando: {
    backgroundColor: COLORS.textLight,
  },
  gpsButtonText: {
    color: '#fff',
    fontWeight: FONTS.weights.semibold,
    fontSize: FONTS.sizes.md,
  },
  gpsResultado: {
    marginTop: SPACING.xs,
    fontSize: FONTS.sizes.sm,
    color: COLORS.success,
    fontWeight: FONTS.weights.medium,
  },
  gpsPendiente: {
    marginTop: SPACING.xs,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textLight,
    fontStyle: 'italic',
  },
  gpsMiniMapContainer: {
    marginTop: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  gpsUbicacionBadge: {
    backgroundColor: COLORS.surfaceAlt,
    paddingVertical: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  gpsUbicacionBadgeText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.medium,
  },
});

export default CapturaGPSPrecisa;
