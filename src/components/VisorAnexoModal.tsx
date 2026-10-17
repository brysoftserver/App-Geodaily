// ============================================================
// GEODAILY — Visor de imágenes de Anexos (dentro de la app)
// ============================================================
// Antes, al tocar una imagen en Anexos, `expo-sharing` delegaba la apertura
// al selector de apps del sistema y la foto se abría en un programa externo
// (galería, Google Fotos…). Con este visor la imagen se muestra a pantalla
// completa dentro de la app, con zoom por pellizco, doble toque y arrastre.
//
// Importante: NO se agregó ninguna dependencia nueva. Todo está hecho con
// componentes del núcleo de React Native (Modal, Image, Animated y
// PanResponder), así que funciona en la APK ya instalada — solo requiere un
// update OTA, sin recompilar.
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Image,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  ActivityIndicator,
  useWindowDimensions,
} from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../theme';
import { fuenteConAuth } from '../services/archivos.service';

interface VisorAnexoModalProps {
  visible: boolean;
  /** Nombre del archivo (se muestra en la cabecera) */
  nombre: string | null;
  /** URL absoluta del archivo (sin token) */
  url: string | null;
  /** Cabeceras de autenticación para descargar el binario */
  headers: Record<string, string>;
  onClose: () => void;
  /** Compartir / descargar con apps externas (botón secundario) */
  onCompartir?: () => void;
}

const ESCALA_MAX = 5;
const ESCALA_DOBLE_TOQUE = 2.5;

const limitar = (valor: number, min: number, max: number) =>
  Math.min(Math.max(valor, min), max);

/** Distancia entre los dos primeros dedos de un evento táctil. */
const distanciaEntreDedos = (dedos: Array<{ pageX: number; pageY: number }>): number => {
  if (dedos.length < 2) return 0;
  const dx = dedos[0].pageX - dedos[1].pageX;
  const dy = dedos[0].pageY - dedos[1].pageY;
  return Math.sqrt(dx * dx + dy * dy);
};

const VisorAnexoModal: React.FC<VisorAnexoModalProps> = ({
  visible,
  nombre,
  url,
  headers,
  onClose,
  onCompartir,
}) => {
  const { width, height } = useWindowDimensions();

  const [cargando, setCargando] = useState(true);
  const [error, setError] = useState(false);

  // Animaciones (driver JS: se combinan setValue durante el gesto con
  // animaciones de resorte al soltar, y eso no admite el driver nativo).
  const escala = useRef(new Animated.Value(1)).current;
  const escalaRef = useRef(1);
  const traslado = useRef(new Animated.ValueXY({ x: 0, y: 0 })).current;
  const trasladoRef = useRef({ x: 0, y: 0 });

  const reiniciarZoom = useCallback(() => {
    escalaRef.current = 1;
    trasladoRef.current = { x: 0, y: 0 };
    Animated.parallel([
      Animated.spring(escala, { toValue: 1, useNativeDriver: false, friction: 7 }),
      Animated.spring(traslado, {
        toValue: { x: 0, y: 0 },
        useNativeDriver: false,
        friction: 7,
      }),
    ]).start();
  }, [escala, traslado]);

  const alternarZoom = useCallback(() => {
    if (escalaRef.current > 1.05) {
      reiniciarZoom();
      return;
    }
    escalaRef.current = ESCALA_DOBLE_TOQUE;
    Animated.spring(escala, {
      toValue: ESCALA_DOBLE_TOQUE,
      useNativeDriver: false,
      friction: 7,
    }).start();
  }, [escala, reiniciarZoom]);

  // Cada vez que se abre un anexo distinto se parte de zoom 1 y sin arrastre.
  useEffect(() => {
    if (!visible) return;
    setCargando(true);
    setError(false);
    escalaRef.current = 1;
    trasladoRef.current = { x: 0, y: 0 };
    escala.setValue(1);
    traslado.setValue({ x: 0, y: 0 });
  }, [visible, url, escala, traslado]);

  const responder = useMemo(() => {
    let distanciaInicial = 0;
    let escalaAlIniciarPellizco = 1;
    let baseTraslado = { x: 0, y: 0 };
    let ultimoToque = 0;

    return PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (_evt, gesto) =>
        gesto.numberActiveTouches > 1 || escalaRef.current > 1.01,
      onPanResponderGrant: (evt) => {
        const dedos = evt.nativeEvent.touches;
        if (dedos.length >= 2) {
          distanciaInicial = distanciaEntreDedos(dedos);
          escalaAlIniciarPellizco = escalaRef.current;
        }
        baseTraslado = { ...trasladoRef.current };

        // Doble toque para acercar/alejar (los anexos se ven en un Modal,
        // así que el doble toque del sistema no interfiere).
        const ahora = Date.now();
        if (dedos.length === 1 && ahora - ultimoToque < 280) {
          ultimoToque = 0;
          alternarZoom();
        } else {
          ultimoToque = ahora;
        }
      },
      onPanResponderMove: (evt, gesto) => {
        const dedos = evt.nativeEvent.touches;
        if (dedos.length >= 2 && distanciaInicial > 0) {
          const factor = distanciaEntreDedos(dedos) / distanciaInicial;
          const nueva = limitar(escalaAlIniciarPellizco * factor, 1, ESCALA_MAX);
          escalaRef.current = nueva;
          escala.setValue(nueva);
          return;
        }
        if (escalaRef.current > 1.01) {
          const x = baseTraslado.x + gesto.dx;
          const y = baseTraslado.y + gesto.dy;
          trasladoRef.current = { x, y };
          traslado.setValue({ x, y });
        }
      },
      onPanResponderRelease: () => {
        distanciaInicial = 0;
        if (escalaRef.current <= 1.05) reiniciarZoom();
      },
      onPanResponderTerminate: () => {
        distanciaInicial = 0;
      },
    });
  }, [alternarZoom, reiniciarZoom, escala, traslado]);

  const fuente = useMemo(() => {
    if (!url) return null;
    return fuenteConAuth(url, headers);
  }, [url, headers]);

  return (
    <Modal
      visible={visible && !!url}
      transparent
      animationType="fade"
      onRequestClose={onClose}
      supportedOrientations={['portrait', 'landscape']}
    >
      <View style={styles.overlay}>
        <View style={styles.header}>
          <Text style={styles.headerTitulo} numberOfLines={1}>
            {nombre || 'Anexo'}
          </Text>
          {onCompartir && (
            <TouchableOpacity style={styles.headerBtn} onPress={onCompartir} hitSlop={12}>
              <Text style={styles.headerBtnTexto}>📤</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity style={styles.headerBtn} onPress={onClose} hitSlop={12}>
            <Text style={styles.headerBtnTexto}>✕</Text>
          </TouchableOpacity>
        </View>

        <Pressable style={styles.area} onPress={onClose}>
          {error ? (
            <View style={styles.centro}>
              <Text style={styles.errorIcono}>🖼️</Text>
              <Text style={styles.errorTexto}>No se pudo mostrar esta imagen.</Text>
              <Text style={styles.errorPista}>
                Puede tener un formato no soportado o haberse movido del servidor.
              </Text>
              {onCompartir && (
                <TouchableOpacity style={styles.boton} onPress={onCompartir}>
                  <Text style={styles.botonTexto}>📤 Compartir / abrir aparte</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <>
              {cargando && (
                <ActivityIndicator
                  size="large"
                  color={COLORS.surface}
                  style={styles.cargador}
                />
              )}
              {fuente && (
                <Animated.View
                  {...responder.panHandlers}
                  style={[
                    styles.marco,
                    {
                      width,
                      height: height * 0.78,
                      transform: [
                        { scale: escala },
                        { translateX: traslado.x },
                        { translateY: traslado.y },
                      ],
                    },
                  ]}
                >
                  <Image
                    source={fuente}
                    style={styles.imagen}
                    resizeMode="contain"
                    onLoadStart={() => setCargando(true)}
                    onLoadEnd={() => setCargando(false)}
                    onError={() => {
                      setCargando(false);
                      setError(true);
                    }}
                  />
                </Animated.View>
              )}
            </>
          )}
        </Pressable>

        {!error && (
          <Text style={styles.pista}>
            Pellizca o doble toque para acercar · arrastra para mover
          </Text>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.97)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.md,
  },
  headerTitulo: {
    flex: 1,
    color: '#FFFFFF',
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
  },
  headerBtn: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
  },
  headerBtnTexto: {
    color: '#FFFFFF',
    fontSize: 20,
  },
  area: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  marco: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  imagen: {
    width: '100%',
    height: '100%',
  },
  cargador: {
    position: 'absolute',
    zIndex: 2,
  },
  centro: {
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.xl,
    maxWidth: 340,
  },
  errorIcono: { fontSize: 48, marginBottom: SPACING.sm },
  errorTexto: {
    color: '#FFFFFF',
    fontSize: FONTS.sizes.md,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  errorPista: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: FONTS.sizes.sm,
    textAlign: 'center',
  },
  boton: {
    marginTop: SPACING.lg,
    backgroundColor: COLORS.primary,
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  botonTexto: {
    color: '#FFFFFF',
    fontWeight: FONTS.weights.semibold,
  },
  pista: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: FONTS.sizes.xs,
    textAlign: 'center',
    paddingVertical: SPACING.md,
  },
});

export default VisorAnexoModal;
