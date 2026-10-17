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
import { useGPS } from '../store/GPSContext';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../theme';

/**
 * Duración MÁXIMA de la cuenta regresiva de captura, en segundos. La captura
 * puede terminar antes si se alcanza una precisión aceptable (ver
 * PRECISION_ACEPTABLE_M): en campo abierto engancha en 2-3 s y solo se agota
 * la ventana completa cuando la señal es difícil (vereda/bajo árboles).
 */
const DURACION_CAPTURA_SEG = 12;

/**
 * Precisión (radio de error en metros) a partir de la cual se considera que
 * la lectura es suficientemente buena y se puede cortar la captura antes de
 * agotar la ventana. 15 m es más que suficiente para georreferenciar una
 * finca y evita hacer esperar al técnico cuando ya hay buena señal.
 */
const PRECISION_ACEPTABLE_M = 15;

/**
 * Edad máxima aceptada para la "última posición conocida" del sistema cuando
 * la captura de alta precisión no logra un fix. En veredas sin cielo abierto
 * el GPS puede tardar minutos: es mejor guardar una posición de hace un rato
 * (que el técnico puede corregir) que dejar la pregunta sin responder y
 * bloquear el formulario.
 */
const ULTIMA_POSICION_MAX_AGE_MS = 30 * 60 * 1000;

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
  // Precisión de la mejor lectura obtenida hasta ahora durante la captura,
  // para mostrarla en vivo ("±8 m") y dar confianza al técnico.
  const [precisionEnVivo, setPrecisionEnVivo] = useState<number | null>(null);

  // Posición que el GPSContext ya tiene en tiempo real (watch de fondo con
  // precisión Balanced). Sirve de respaldo cuando la captura de alta
  // precisión no logra un fix en la ventana de 8 s: en vez de dejar la
  // pregunta sin responder, se ofrece esta posición.
  const { userLocation } = useGPS();

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

  /**
   * Aplica una lectura al formulario. Se usa tanto para la captura de alta
   * precisión como para los respaldos (última posición conocida / GPSContext).
   */
  const aplicarLectura = useCallback(
    (lectura: MejorLectura) => {
      onCapture(
        String(lectura.latitud),
        String(lectura.longitud),
        lectura.altitud != null ? String(Math.round(lectura.altitud)) : '',
        Number.isFinite(lectura.precision) ? String(Math.round(lectura.precision)) : ''
      );
    },
    [onCapture]
  );

  /**
   * Respaldo cuando la captura de alta precisión no obtuvo ninguna lectura:
   *  1. La última posición conocida del sistema (hasta 30 min de antigüedad).
   *  2. La posición que el GPSContext ya tiene (watch de fondo).
   * Si ninguna existe, se avisa al técnico y se le ofrece continuar sin
   * coordenadas para que NO quede bloqueado.
   */
  const intentarRespaldo = useCallback(async () => {
    let ultima: Location.LocationObject | null = null;
    try {
      ultima = await Location.getLastKnownPositionAsync({ maxAge: ULTIMA_POSICION_MAX_AGE_MS });
    } catch {
      ultima = null;
    }

    if (ultima) {
      aplicarLectura({
        latitud: ultima.coords.latitude,
        longitud: ultima.coords.longitude,
        altitud: ultima.coords.altitude ?? undefined,
        precision: ultima.coords.accuracy ?? Infinity,
      });
      Alert.alert(
        'Ubicación aproximada',
        'No se logró una señal GPS precisa, pero se guardó la última ubicación conocida del dispositivo. Puedes volver a capturar cuando tengas mejor señal.'
      );
      return;
    }

    if (userLocation) {
      aplicarLectura({
        latitud: userLocation.latitud,
        longitud: userLocation.longitud,
        altitud: userLocation.altitud,
        precision: userLocation.precision_gps ?? Infinity,
      });
      Alert.alert(
        'Ubicación aproximada',
        'No se logró una señal GPS precisa, pero se guardó la última ubicación registrada por la app. Puedes volver a capturar cuando tengas mejor señal.'
      );
      return;
    }

    Alert.alert(
      'Sin señal GPS',
      'No se pudo obtener la ubicación. Puedes continuar sin coordenadas y capturarlas más tarde, o volver a intentar.',
      [
        { text: 'Volver a intentar', style: 'cancel' },
        { text: 'Continuar sin coordenadas', onPress: () => onCapture('', '', '', '') },
      ]
    );
  }, [aplicarLectura, onCapture, userLocation]);

  const iniciarCaptura = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso de ubicación', 'Se necesita el permiso de ubicación para capturar las coordenadas.');
      return;
    }

    mejorLecturaRef.current = null;
    setPrecisionEnVivo(null);
    setSegundosRestantes(DURACION_CAPTURA_SEG);
    setCapturando(true);

    /**
     * Cierra la captura con la mejor lectura disponible (o con los respaldos
     * si no hubo ninguna). Es idempotente: si ya se cerró, no hace nada.
     */
    const finalizar = () => {
      detenerMuestreo();
      setCapturando(false);
      const mejor = mejorLecturaRef.current;
      if (mejor) {
        aplicarLectura(mejor);
      } else {
        // Sin lectura de alta precisión: probar última conocida / GPSContext.
        intentarRespaldo();
      }
    };

    try {
      subscripcionRef.current = await Location.watchPositionAsync(
        // `High` (no `BestForNavigation`): esta última está pensada para
        // navegación vehicular, usa sensores extra y tarda mucho más en
        // enganchar. Para georreferenciar una finca, `High` es suficiente y
        // consigue el primer fix bastante más rápido.
        { accuracy: Location.Accuracy.High, timeInterval: 500, distanceInterval: 0 },
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
            setPrecisionEnVivo(Number.isFinite(precisionActual) ? precisionActual : null);

            // Corte anticipado: si ya tenemos una lectura suficientemente
            // buena, no tiene sentido seguir esperando el resto de la ventana.
            if (precisionActual <= PRECISION_ACEPTABLE_M) {
              finalizar();
            }
          }
        }
      );
    } catch {
      detenerMuestreo();
      setCapturando(false);
      // No se pudo ni suscribir el watch: intentar respaldos antes de rendirse.
      await intentarRespaldo();
      return;
    }

    timerRef.current = setInterval(() => {
      setSegundosRestantes((prev) => {
        if (prev <= 1) {
          finalizar();
          return DURACION_CAPTURA_SEG;
        }
        return prev - 1;
      });
    }, 1000);
  }, [detenerMuestreo, aplicarLectura, intentarRespaldo]);

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
          <Text style={styles.gpsButtonText}>
            📡 Obteniendo ubicación… {segundosRestantes}s
            {precisionEnVivo != null ? `   ±${Math.round(precisionEnVivo)} m` : ''}
          </Text>
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

      {!capturando && !hayCaptura && (
        <Text style={styles.gpsPendiente}>Aún sin capturar (opcional: puedes continuar sin coordenadas)</Text>
      )}
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
