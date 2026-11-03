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
import { View, Text, TouchableOpacity, StyleSheet, Alert, TextInput } from 'react-native';
import * as Location from 'expo-location';
import MapViewOffline from './MapViewOffline';
import { useGPS } from '../store/GPSContext';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../theme';

/**
 * Tiempo MÍNIMO de captura, en segundos. Siempre se espera completo: no se
 * corta por muy buena que sea la precisión, para que el técnico vea cómo el
 * error va bajando (como en las apps de coordenadas) y se guarde la mejor
 * lectura de la ventana.
 */
const DURACION_MINIMA_SEG = 20;

/**
 * Tope de espera automática, en segundos. Pasado el mínimo, si la mejor
 * lectura aún no llega a PRECISION_MAXIMA_M la captura sigue sola: sin datos
 * (sin A-GPS) el arranque en frío tarda hasta ~2 min en bajar de ±80 m a
 * ±15 m. Agotado el tope se avisa y se ofrece seguir esperando.
 */
const DURACION_TOPE_SEG = 120;

/**
 * Error máximo aceptado (radio en metros) para guardar la coordenada. Si al
 * terminar la ventana la mejor lectura es peor, NO se guarda: se ofrece
 * seguir esperando otra ventana (sin perder la mejor lectura fresca).
 */
const PRECISION_MAXIMA_M = 30;

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
   * "terreno" con etiquetas no tiene cobertura en veredas rurales — ver
   * nota en pdfLocal.service.ts), así que en vez de depender de que el
   * mapa muestre el nombre, se usa el dato que el formulario ya conoce.
   */
  ubicacionTexto?: string;
  onCapture: (latitud: string, longitud: string, altitud: string, precision: string) => void;
  /**
   * Permite ESCRIBIR las coordenadas a mano, además de capturarlas con GPS.
   *
   * Se usa en la corrección desde el detalle del formulario (admin): quien
   * revisa no está en la finca, así que no puede volver a caminar hasta el
   * punto a tomar la coordenada. Sin esto, la única forma de corregir una
   * coordenada mal tomada era volver al sitio.
   *
   * Por defecto está desactivado: el técnico en campo sigue capturando con
   * GPS de alta precisión, sin poder teclear un punto que no visitó.
   */
  permitirEdicionManual?: boolean;
  /**
   * Cambio hecho a mano en los campos de latitud/longitud/altitud. Se emite
   * con cada tecla para que el padre mantenga su estado sincronizado (y así
   * el botón Guardar se habilite/deshabilite con los valores reales).
   */
  onChangeManual?: (latitud: string, longitud: string, altitud: string) => void;
  /**
   * La captura es obligatoria en este formulario: cambia el texto de "aún sin
   * capturar" (por defecto se indica que se puede continuar sin coordenadas).
   */
  obligatoria?: boolean;
}

const CapturaGPSPrecisa: React.FC<CapturaGPSPrecisaProps> = ({
  label,
  latitud,
  longitud,
  altitud,
  precision,
  ubicacionTexto,
  onCapture,
  permitirEdicionManual = false,
  onChangeManual,
  obligatoria = false,
}) => {
  const [capturando, setCapturando] = useState(false);
  const [segundosTranscurridos, setSegundosTranscurridos] = useState(0);
  // Precisión de la mejor lectura obtenida hasta ahora durante la captura,
  // para mostrarla en vivo ("±8 m") y dar confianza al técnico.
  const [precisionEnVivo, setPrecisionEnVivo] = useState<number | null>(null);
  // Estado del GPS de fondo (siempre encendido): indica si el chip ya está
  // "caliente" antes de pulsar el botón.
  const { precisionActual: precisionFondo, gpsHabilitado } = useGPS();
  const [puntoEnVivo, setPuntoEnVivo] = useState<{ lat: number; lon: number } | null>(null);

  /**
   * Aplica al formulario la mejor lectura fresca de la ventana de captura.
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

  const mejorLecturaRef = useRef<MejorLectura | null>(null);
  const subscripcionRef = useRef<Location.LocationSubscription | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // Momento en que se pulsó Start: toda lectura anterior es una posición en
  // caché del sistema (p. ej. la captura previa) y se descarta.
  const inicioMsRef = useRef(0);
  const segundosRef = useRef(0);
  const cerradaRef = useRef(true);

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
   * Arranca (o reinicia) el contador de captura desde `desde` segundos.
   * `alTick` decide si cerrar: recibe los segundos transcurridos.
   */
  const arrancarVentana = useCallback((desde: number, alTick: (seg: number) => void) => {
    if (timerRef.current) clearInterval(timerRef.current);
    segundosRef.current = desde;
    setSegundosTranscurridos(desde);
    timerRef.current = setInterval(() => {
      segundosRef.current += 1;
      setSegundosTranscurridos(segundosRef.current);
      alTick(segundosRef.current);
    }, 1000);
  }, []);

  /** Cancelar una captura en curso: no guarda nada y conserva lo anterior. */
  const cancelarCaptura = useCallback(() => {
    cerradaRef.current = true;
    detenerMuestreo();
    setCapturando(false);
  }, [detenerMuestreo]);

  const iniciarCaptura = useCallback(async () => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== 'granted') {
      Alert.alert('Permiso de ubicación', 'Se necesita el permiso de ubicación para capturar las coordenadas.');
      return;
    }

    const gpsEncendido = await Location.hasServicesEnabledAsync().catch(() => true);
    if (!gpsEncendido) {
      Alert.alert('GPS apagado', 'Enciende la ubicación (GPS) del teléfono para capturar las coordenadas.');
      return;
    }

    mejorLecturaRef.current = null;
    inicioMsRef.current = Date.now();
    cerradaRef.current = false;
    setPrecisionEnVivo(null);
    setPuntoEnVivo(null);
    setCapturando(true);

    /**
     * Cierra la ventana. Idempotente (guarda con cerradaRef). Solo se guarda
     * una lectura FRESCA con error <= PRECISION_MAXIMA_M; en otro caso se
     * avisa y se deja la coordenada anterior (si había) intacta.
     */
    const finalizar = () => {
      if (cerradaRef.current) return;
      cerradaRef.current = true;
      detenerMuestreo();
      setCapturando(false);
      const mejor = mejorLecturaRef.current;

      if (mejor && mejor.precision <= PRECISION_MAXIMA_M) {
        aplicarLectura(mejor);
        return;
      }

      const detalle = mejor
        ? `La mejor lectura fue de ±${Math.round(mejor.precision)} m y se requiere ±${PRECISION_MAXIMA_M} m o menos.`
        : 'No se recibió ninguna lectura del GPS.';
      Alert.alert(
        'Precisión insuficiente',
        `${detalle} Sal a cielo abierto, aléjate de árboles o construcciones y sigue esperando: sin internet el GPS puede tardar un par de minutos en afinar.`,
        [
          { text: 'Cancelar', style: 'cancel' },
          { text: 'Seguir esperando', onPress: () => reanudar() },
        ]
      );
    };

    const suscribir = async () => {
      subscripcionRef.current?.remove();
      subscripcionRef.current = await Location.watchPositionAsync(
        // `High` (no `BestForNavigation`): esta última está pensada para
        // navegación vehicular, usa sensores extra y tarda mucho más en
        // enganchar. Para georreferenciar una finca, `High` es suficiente.
        { accuracy: Location.Accuracy.High, timeInterval: 1000, distanceInterval: 0 },
        (pos) => {
          // Lectura en caché de antes de pulsar Start: no es fresca.
          if (pos.timestamp < inicioMsRef.current) return;
          const precisionActual = pos.coords.accuracy ?? Infinity;
          setPuntoEnVivo({ lat: pos.coords.latitude, lon: pos.coords.longitude });
          const mejorActual = mejorLecturaRef.current;
          if (!mejorActual || precisionActual < mejorActual.precision) {
            mejorLecturaRef.current = {
              latitud: pos.coords.latitude,
              longitud: pos.coords.longitude,
              altitud: pos.coords.altitude ?? undefined,
              precision: precisionActual,
            };
            setPrecisionEnVivo(Number.isFinite(precisionActual) ? precisionActual : null);
          }
        }
      );
    };

    /** Cierra al cumplir el mínimo con buena precisión, o al agotar el tope. */
    const alTick = (seg: number) => {
      const mejor = mejorLecturaRef.current;
      const buena = !!mejor && mejor.precision <= PRECISION_MAXIMA_M;
      if ((seg >= DURACION_MINIMA_SEG && buena) || seg >= DURACION_TOPE_SEG) finalizar();
    };

    /** "Seguir esperando": nueva ventana conservando la mejor lectura fresca. */
    const reanudar = async () => {
      cerradaRef.current = false;
      setCapturando(true);
      try {
        await suscribir();
      } catch {
        cerradaRef.current = true;
        setCapturando(false);
        Alert.alert('Sin señal GPS', 'No se pudo iniciar la lectura del GPS. Intenta de nuevo.');
        return;
      }
      arrancarVentana(DURACION_MINIMA_SEG, alTick);
    };

    try {
      await suscribir();
    } catch {
      detenerMuestreo();
      cerradaRef.current = true;
      setCapturando(false);
      Alert.alert('Sin señal GPS', 'No se pudo iniciar la lectura del GPS. Verifica que la ubicación esté encendida e intenta de nuevo.');
      return;
    }

    arrancarVentana(0, alTick);
  }, [detenerMuestreo, aplicarLectura, arrancarVentana]);

  const hayCaptura = !!(latitud && longitud);

  /**
   * Edición manual (solo cuando `permitirEdicionManual`): se escribe la
   * coordenada tal cual, sin pasar por el GPS. Se valida el rango para no
   * dejar guardar un punto imposible (lat fuera de ±90, lon fuera de ±180).
   */
  const latNum = Number(String(latitud ?? '').replace(',', '.'));
  const lonNum = Number(String(longitud ?? '').replace(',', '.'));
  const latValida = String(latitud ?? '').trim() !== '' && Number.isFinite(latNum) && Math.abs(latNum) <= 90;
  const lonValida = String(longitud ?? '').trim() !== '' && Number.isFinite(lonNum) && Math.abs(lonNum) <= 180;
  const rangoInvalido =
    (String(latitud ?? '').trim() !== '' && !latValida) ||
    (String(longitud ?? '').trim() !== '' && !lonValida);

  const emitirManual = (nuevaLat: string, nuevaLon: string, nuevaAlt: string) => {
    onChangeManual?.(nuevaLat, nuevaLon, nuevaAlt);
  };

  return (
    <View style={styles.fieldContainer}>
      <Text style={styles.fieldLabel}>{label}</Text>

      {!capturando && (
        <Text style={styles.gpsEstado}>
          {gpsHabilitado === false
            ? '⚠️ GPS del teléfono apagado'
            : precisionFondo == null
            ? '🛰️ GPS buscando señal…'
            : precisionFondo <= PRECISION_MAXIMA_M
            ? `🟢 GPS listo (±${Math.round(precisionFondo)} m)`
            : `🟠 GPS calentando (±${Math.round(precisionFondo)} m) — espera al aire libre`}
        </Text>
      )}

      {!capturando && (
        <TouchableOpacity style={styles.gpsButton} onPress={iniciarCaptura} activeOpacity={0.7}>
          <Text style={styles.gpsButtonText}>{hayCaptura ? '🔄 Volver a capturar' : '📍 Capturar ubicación'}</Text>
        </TouchableOpacity>
      )}

      {permitirEdicionManual && !capturando && (
        <View style={styles.manualContainer}>
          <Text style={styles.manualHint}>
            ✍️ También puedes escribir la coordenada a mano (corrección desde oficina).
          </Text>
          <View style={styles.manualRow}>
            <View style={styles.manualField}>
              <Text style={styles.manualLabel}>Latitud</Text>
              <TextInput
                style={styles.manualInput}
                value={String(latitud ?? '')}
                onChangeText={(t) => emitirManual(t, String(longitud ?? ''), String(altitud ?? ''))}
                placeholder="Ej. 8.123456"
                placeholderTextColor={COLORS.textLight}
                keyboardType="numbers-and-punctuation"
                autoCorrect={false}
                accessibilityLabel="Latitud"
              />
            </View>
            <View style={styles.manualField}>
              <Text style={styles.manualLabel}>Longitud</Text>
              <TextInput
                style={styles.manualInput}
                value={String(longitud ?? '')}
                onChangeText={(t) => emitirManual(String(latitud ?? ''), t, String(altitud ?? ''))}
                placeholder="Ej. -76.123456"
                placeholderTextColor={COLORS.textLight}
                keyboardType="numbers-and-punctuation"
                autoCorrect={false}
                accessibilityLabel="Longitud"
              />
            </View>
          </View>
          <View style={styles.manualField}>
            <Text style={styles.manualLabel}>Altitud (m, opcional)</Text>
            <TextInput
              style={styles.manualInput}
              value={String(altitud ?? '')}
              onChangeText={(t) => emitirManual(String(latitud ?? ''), String(longitud ?? ''), t)}
              placeholder="Ej. 120"
              placeholderTextColor={COLORS.textLight}
              keyboardType="numbers-and-punctuation"
              autoCorrect={false}
              accessibilityLabel="Altitud"
            />
          </View>
          {rangoInvalido && (
            <Text style={styles.manualError}>
              Revisa el valor: la latitud va de -90 a 90 y la longitud de -180 a 180.
            </Text>
          )}
        </View>
      )}

      {capturando && (
        <View style={[styles.gpsButton, styles.gpsButtonContando]}>
          <Text style={styles.gpsButtonText}>
            📡 Obteniendo ubicación… {segundosTranscurridos}s
            {precisionEnVivo != null ? `   mejor ±${Math.round(precisionEnVivo)} m` : '   buscando satélites…'}
          </Text>
          {puntoEnVivo && (
            <Text style={styles.gpsEnVivoText}>
              {puntoEnVivo.lat.toFixed(6)}, {puntoEnVivo.lon.toFixed(6)}
            </Text>
          )}
          <Text style={styles.gpsEnVivoText}>
            Se guarda con ±{PRECISION_MAXIMA_M} m o menos (mínimo {DURACION_MINIMA_SEG}s)
          </Text>
        </View>
      )}

      {capturando && (
        <TouchableOpacity style={styles.gpsCancelar} onPress={cancelarCaptura} activeOpacity={0.7}>
          <Text style={styles.gpsCancelarText}>Cancelar</Text>
        </TouchableOpacity>
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
        <Text style={styles.gpsPendiente}>{obligatoria ? 'Aún sin capturar (obligatorio para completar la visita)' : 'Aún sin capturar (opcional: puedes continuar sin coordenadas)'}</Text>
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
  gpsEstado: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  gpsCancelar: {
    marginTop: SPACING.xs,
    paddingVertical: SPACING.xs,
    alignItems: 'center',
  },
  gpsCancelarText: {
    color: COLORS.error,
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
  },
  gpsEnVivoText: {
    color: '#fff',
    fontSize: FONTS.sizes.xs,
    marginTop: 2,
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
  manualContainer: {
    marginTop: SPACING.sm,
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt,
  },
  manualHint: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  manualRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  manualField: {
    flex: 1,
    marginBottom: SPACING.xs,
  },
  manualLabel: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
  manualInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.surface,
  },
  manualError: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.error,
    marginTop: SPACING.xs,
  },
});

export default CapturaGPSPrecisa;
