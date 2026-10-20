// ============================================================
// GEODAILY — Toolbar del mapa (ubicación, reset, mapa base)
// ============================================================

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../../theme';

/**
 * Mapas base disponibles:
 * - `terreno`: Esri World Topo Map — relieve, curvas de nivel, vías y veredas.
 *   Se muestra como «Terreno/Calles».
 * - `satelite`: Esri World Imagery — satélite nítido hasta zoom 18 (~0.5 m),
 *   pero en Caquetá la imagen es de enero 2020.
 * - `satelite-reciente`: Sentinel-2 cloudless 2025 (EOX) — imagen del año en
 *   curso, pero ~10 m/píxel: se ve borroso al acercar a nivel de potrero.
 *   Se muestra como «Satélite Relieve».
 */
export type MapBaseStyle = 'terreno' | 'satelite' | 'satelite-reciente';

interface MapToolbarProps {
  locating: boolean;
  siguiendo: boolean;
  onCentrar: () => void;
  onReset: () => void;
  /** Mapa base activo. Si se omite, no se muestra el selector. */
  mapStyle?: MapBaseStyle;
  onChangeMapStyle?: (style: MapBaseStyle) => void;
  /** Texto del botón de reset. Por defecto «🗺️ Puerto Rico». */
  resetLabel?: string;
}

const BASE_STYLES: { key: MapBaseStyle; label: string; icono: string }[] = [
  { key: 'terreno', label: 'Terreno/Calles', icono: '⛰️' },
  { key: 'satelite', label: 'Satélite HD', icono: '🛰️' },
  { key: 'satelite-reciente', label: 'Satélite Relieve', icono: '📅' },
];

const MapToolbar: React.FC<MapToolbarProps> = ({
  locating,
  siguiendo,
  onCentrar,
  onReset,
  mapStyle,
  onChangeMapStyle,
  resetLabel = '🗺️ Puerto Rico',
}) => (
  <View style={styles.wrapper}>
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
        <Text style={styles.btnResetText}>{resetLabel}</Text>
      </TouchableOpacity>
    </View>

    {/* Selector de mapa base: en zona rural el gris de referencia no muestra
        monte ni quebradas, por eso el satélite es la opción por defecto.
        «Satélite HD» (Esri) es el nítido para medir; «Satélite 2025»
        (Sentinel-2) es el reciente para ver cambios de cobertura. */}
    {mapStyle && onChangeMapStyle && (
      <View style={styles.styleRow}>
        {BASE_STYLES.map((s) => {
          const activo = mapStyle === s.key;
          return (
            <TouchableOpacity
              key={s.key}
              style={[styles.styleBtn, activo && styles.styleBtnActive]}
              onPress={() => onChangeMapStyle(s.key)}
              accessibilityRole="button"
              accessibilityState={{ selected: activo }}
            >
              <Text style={[styles.styleBtnText, activo && styles.styleBtnTextActive]}>
                {s.icono} {s.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    )}
  </View>
);

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  container: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    backgroundColor: COLORS.surface,
  },
  styleRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: SPACING.xs,
    paddingHorizontal: SPACING.sm,
    paddingBottom: SPACING.xs,
  },
  styleBtn: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt,
  },
  styleBtnActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  styleBtnText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.medium,
  },
  styleBtnTextActive: {
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.semibold,
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
