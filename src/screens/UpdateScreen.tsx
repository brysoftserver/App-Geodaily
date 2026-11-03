// ============================================================
// GEODAILY — Pantalla de Actualización (OTA)
// ============================================================
//
// Se muestra al arrancar la app cuando hay una actualización OTA
// disponible. Usa el mismo fondo institucional del login para que la
// transición se sienta parte de la app y no un "pantallazo" técnico.
//
// Muestra progreso REAL de descarga (viene de expo-updates), no una
// animación simulada.

import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Image,
  ImageBackground,
  Animated,
  Easing,
  Platform,
} from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../theme';
import type { ProgresoActualizacion } from '../services/updateChecker.service';

import FONDO from '../../assets/images/fondo_login_geo_daily.jpg';
import LOGO from '../../assets/images/logo_geo_daily_ui.png';

interface UpdateScreenProps {
  /** Estado actual del proceso de actualización. */
  progreso: ProgresoActualizacion;
}

const UpdateScreen: React.FC<UpdateScreenProps> = ({ progreso }) => {
  const { estado, progreso: valor, mensaje } = progreso;

  // Animación de pulso del logo mientras se trabaja.
  const pulso = useRef(new Animated.Value(1)).current;
  // Animación de la barra cuando el progreso no es determinable.
  const indeterminada = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const animacion = Animated.loop(
      Animated.sequence([
        Animated.timing(pulso, {
          toValue: 1.06,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulso, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    animacion.start();
    return () => animacion.stop();
  }, [pulso]);

  useEffect(() => {
    // Barra indeterminada solo cuando estamos comprobando (sin % real).
    if (estado !== 'comprobando' && estado !== 'inactivo') return;
    const animacion = Animated.loop(
      Animated.timing(indeterminada, {
        toValue: 1,
        duration: 1400,
        easing: Easing.inOut(Easing.ease),
        useNativeDriver: true,
      })
    );
    indeterminada.setValue(0);
    animacion.start();
    return () => animacion.stop();
  }, [estado, indeterminada]);

  const porcentaje = Math.round(Math.max(0, Math.min(1, valor)) * 100);
  const mostrarBarraDeterminada =
    estado === 'descargando' || estado === 'instalando' || estado === 'actualizado';

  const textoEstado =
    mensaje ||
    (estado === 'comprobando'
      ? 'Buscando actualización…'
      : estado === 'inactivo'
        ? 'Inicializando GEODAILY…'
        : estado === 'actualizado'
        ? '¡Actualización instalada!'
        : estado === 'instalando'
        ? 'Instalando actualización…'
        : 'Preparando GEODAILY…');

  const textoDetalle =
    estado === 'comprobando'
      ? 'Verificando si hay una versión más reciente.'
      : estado === 'descargando'
        ? 'No cierres la app. Esto solo toma unos segundos.'
        : estado === 'actualizado'
          ? 'GEODAILY ya está en su versión más reciente.'
          : estado === 'instalando'
          ? 'Aplicando los cambios. La app se reiniciará sola.'
          : '';

  return (
    <ImageBackground source={FONDO} style={styles.container} resizeMode="cover">
      <View style={styles.overlay}>
        <Animated.View style={[styles.logoWrap, { transform: [{ scale: pulso }] }]}>
          <Image source={LOGO} style={styles.logo} resizeMode="contain" />
        </Animated.View>

        <Text style={styles.titulo}>GEODAILY</Text>

        <View style={styles.panel}>
          <Text style={styles.estado}>{textoEstado}</Text>

          <View style={styles.barraFondo}>
            {mostrarBarraDeterminada ? (
              <View style={[styles.barraRelleno, { width: `${porcentaje}%` }]} />
            ) : (
              <Animated.View
                style={[
                  styles.barraIndeterminada,
                  {
                    transform: [
                      {
                        translateX: indeterminada.interpolate({
                          inputRange: [0, 1],
                          outputRange: [-120, 260],
                        }),
                      },
                    ],
                  },
                ]}
              />
            )}
          </View>

          {mostrarBarraDeterminada && (
            <Text style={styles.porcentaje}>{porcentaje}%</Text>
          )}

          {textoDetalle ? <Text style={styles.detalle}>{textoDetalle}</Text> : null}
        </View>

        <Text style={styles.pie}>Actualización automática · No requiere internet después</Text>
      </View>
    </ImageBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0D3B0F',
    width: '100%',
    height: '100%',
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: SPACING.xl,
  },
  logoWrap: {
    width: '70%',
    maxWidth: 320,
    height: 160,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logo: {
    width: '100%',
    height: '100%',
  },
  titulo: {
    marginTop: SPACING.sm,
    fontSize: FONTS.sizes.hero,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textOnPrimary,
    letterSpacing: 2,
    textShadowColor: 'rgba(0,0,0,0.5)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 6,
  },
  panel: {
    marginTop: SPACING.xl,
    width: '100%',
    maxWidth: 420,
    backgroundColor: 'rgba(255,255,255,0.12)',
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.25)',
    paddingVertical: SPACING.lg,
    paddingHorizontal: SPACING.lg,
    alignItems: 'center',
  },
  estado: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textOnPrimary,
    textAlign: 'center',
  },
  barraFondo: {
    marginTop: SPACING.md,
    width: '100%',
    height: 8,
    borderRadius: 4,
    backgroundColor: 'rgba(255,255,255,0.25)',
    overflow: 'hidden',
  },
  barraRelleno: {
    height: '100%',
    borderRadius: 4,
    backgroundColor: COLORS.secondary,
  },
  barraIndeterminada: {
    width: 120,
    height: '100%',
    borderRadius: 4,
    backgroundColor: COLORS.secondary,
  },
  porcentaje: {
    marginTop: SPACING.sm,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.secondaryLight,
  },
  detalle: {
    marginTop: SPACING.sm,
    fontSize: FONTS.sizes.sm,
    color: 'rgba(255,255,255,0.85)',
    textAlign: 'center',
    lineHeight: 18,
  },
  pie: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 40 : 28,
    fontSize: FONTS.sizes.xs,
    color: 'rgba(255,255,255,0.7)',
    textAlign: 'center',
  },
});

export default UpdateScreen;
