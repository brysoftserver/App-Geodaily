// ============================================================
// GEODAILY — Componente de Carga (Loading Spinner)
// ============================================================

import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet, Image, ImageBackground } from 'react-native';
import { COLORS, FONTS, SPACING } from '../theme';

const FONDO = require('../../assets/images/fondo_login_geo_daily.png');
const LOGO = require('../../assets/images/logo_geo_daily.png');

interface LoadingSpinnerProps {
  message?: string;
  size?: 'small' | 'large';
  fullScreen?: boolean;
  /** Muestra el splash con logo+fondo de la app */
  branded?: boolean;
}

const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  message = 'Cargando...',
  size = 'large',
  fullScreen = false,
  branded = false,
}) => {
  // Pantalla completa con marca de agua (splash con logo + fondo)
  if (branded) {
    return (
      <ImageBackground
        source={FONDO}
        style={styles.brandedContainer}
        resizeMode="cover"
      >
        <View style={styles.brandedOverlay}>
          <Image source={LOGO} style={styles.brandedLogo} resizeMode="contain" />
          <ActivityIndicator size={size} color={COLORS.secondary} style={{ marginTop: 24 }} />
          {message ? <Text style={styles.brandedMessage}>{message}</Text> : null}
        </View>
      </ImageBackground>
    );
  }

  if (fullScreen) {
    return (
      <View style={styles.fullScreen}>
        <ActivityIndicator size={size} color={COLORS.primary} />
        {message && <Text style={styles.message}>{message}</Text>}
      </View>
    );
  }

  return (
    <View style={styles.inline}>
      <ActivityIndicator size={size} color={COLORS.primary} />
      {message && <Text style={styles.message}>{message}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  brandedContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  brandedOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  brandedLogo: {
    width: '80%',
    height: 200,
    marginBottom: SPACING.md,
  },
  brandedMessage: {
    marginTop: SPACING.sm,
    fontSize: FONTS.sizes.lg,
    color: COLORS.textOnPrimary,
    textAlign: 'center',
    fontWeight: FONTS.weights.medium,
  },
  fullScreen: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: COLORS.background,
  },
  inline: {
    padding: SPACING.lg,
    justifyContent: 'center',
    alignItems: 'center',
  },
  message: {
    marginTop: SPACING.sm,
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
});

export default LoadingSpinner;
