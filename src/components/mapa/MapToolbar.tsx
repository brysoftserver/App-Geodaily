// ============================================================
// GEODAILY — Toolbar del mapa (ubicación, reset)
// ============================================================

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../../theme';

interface MapToolbarProps {
  locating: boolean;
  siguiendo: boolean;
  onCentrar: () => void;
  onReset: () => void;
}

const MapToolbar: React.FC<MapToolbarProps> = ({ locating, siguiendo, onCentrar, onReset }) => (
  <View style={styles.container}>
    <TouchableOpacity
      style={[styles.btn, styles.btnLocate, siguiendo && styles.btnLocateActive]}
      onPress={onCentrar}
      disabled={locating}
    >
      <Text style={styles.btnText}>
        {locating ? '⋯' : siguiendo ? '🟢 Siguiendo' : '📍 Mi ubicación'}
      </Text>
    </TouchableOpacity>
    <TouchableOpacity style={[styles.btn, styles.btnReset]} onPress={onReset}>
      <Text style={styles.btnResetText}>🗺️ Puerto Rico</Text>
    </TouchableOpacity>
  </View>
);

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  btn: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingVertical: 6,
    borderRadius: BORDER_RADIUS.full,
  },
  btnLocate: { backgroundColor: COLORS.primary },
  btnLocateActive: { backgroundColor: COLORS.success || '#2E7D32' },
  btnText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.semibold,
  },
  btnReset: {
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  btnResetText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.medium,
  },
});

export default MapToolbar;
