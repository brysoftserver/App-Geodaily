// ============================================================
// GEODAILY — Toggle de capas del mapa
// ============================================================

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../../theme';

type CapaActiva = 'plantaciones' | 'tecnicos' | 'mediciones' | 'veredas';

interface CapaInfo {
  key: CapaActiva;
  label: string;
  icono: string;
  conteo: number;
}

interface MapLayerToggleProps {
  capasActivas: Set<CapaActiva>;
  onToggle: (capa: CapaActiva) => void;
  conteos: Record<string, number>;
}

const CAPAS: CapaInfo[] = [
  { key: 'plantaciones', label: 'Plantaciones', icono: '🌱', conteo: 0 },
  { key: 'tecnicos', label: 'Técnicos', icono: '👤', conteo: 0 },
  { key: 'mediciones', label: 'Mediciones', icono: '📐', conteo: 0 },
  { key: 'veredas', label: 'Veredas', icono: '🗺️', conteo: 0 },
];

const MapLayerToggle: React.FC<MapLayerToggleProps> = ({ capasActivas, onToggle, conteos }) => {
  return (
    <View style={styles.container}>
      {CAPAS.map((capa) => {
        const activa = capasActivas.has(capa.key);
        const conteo = conteos[capa.key] ?? 0;
        return (
          <TouchableOpacity
            key={capa.key}
            style={[styles.badge, activa && styles.badgeActive]}
            onPress={() => onToggle(capa.key)}
            accessibilityLabel={`${capa.label}: ${activa ? 'activa' : 'inactiva'}`}
          >
            <Text style={[styles.text, activa && styles.textActive]}>
              {capa.icono} {capa.label} ({conteo})
            </Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    gap: 6,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  badge: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.surfaceAlt,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  badgeActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  text: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.medium,
  },
  textActive: {
    color: COLORS.textOnPrimary,
  },
});

export default MapLayerToggle;
