// ============================================================
// GEODAILY — Fondo de pantalla global (imagen con overlay)
// ============================================================

import React from 'react';
import { ImageBackground, StyleSheet, View, ViewStyle } from 'react-native';

interface AppBackgroundProps {
  children: React.ReactNode;
  /** Oscurece el fondo para mejorar legibilidad (0-1). 0 = sin oscurecer */
  overlay?: number;
  style?: ViewStyle;
}

const FONDO_IMAGE = require('../../assets/images/fondo_login_geo_daily.png');

const AppBackground: React.FC<AppBackgroundProps> = ({
  children,
  overlay = 0.3,
  style,
}) => {
  return (
    <ImageBackground
      source={FONDO_IMAGE}
      style={[styles.container, style]}
      resizeMode="cover"
    >
      <View style={[styles.overlay, { backgroundColor: `rgba(0,0,0,${overlay})` }]}>
        {children}
      </View>
    </ImageBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  overlay: {
    flex: 1,
    width: '100%',
  },
});

export default AppBackground;
