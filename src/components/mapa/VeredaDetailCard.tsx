// ============================================================
// GEODAILY — Tarjeta de detalle de una vereda (capa GeoJSON del mapa)
// ============================================================
// Las veredas NO vienen de una tabla propia: se traen de OpenStreetMap
// (Overpass) o, si esa consulta falla, de un listado aproximado incrustado
// en el backend (ver backend/src/routes/maps.js). Por eso "eliminar" en
// realidad es "ocultar de la app" (tabla `veredas_excluidas`) — el dato de
// origen no se toca y reaparecería igual en el próximo fetch a Overpass.
// ============================================================

import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';

interface VeredaDetailCardProps {
  properties: Record<string, any>;
  /** Conteo aproximado de plantaciones registradas con ese nombre de vereda (coincidencia de texto, no geoespacial). */
  totalPlantaciones: number;
  isAdmin: boolean;
  onClose: () => void;
  onDelete: (id: string, nombre: string) => void;
}

const VeredaDetailCard: React.FC<VeredaDetailCardProps> = ({
  properties,
  totalPlantaciones,
  isAdmin,
  onClose,
  onDelete,
}) => {
  const insets = useSafeAreaInsets();
  const nombre = properties?.nombre || 'Vereda sin nombre';
  const id = properties?.id;

  return (
    <View style={[styles.card, { paddingBottom: SPACING.md + insets.bottom }]}>
      <TouchableOpacity style={styles.closeBtn} onPress={onClose}>
        <Text style={styles.closeText}>✕</Text>
      </TouchableOpacity>

      <Text style={styles.title}>🗺️ {nombre}</Text>

      <View style={styles.row}>
        <Text style={styles.label}>Plantaciones registradas</Text>
        <Text style={styles.value}>{totalPlantaciones}</Text>
      </View>
      <Text style={styles.aviso}>
        Conteo aproximado por nombre de vereda — puede no incluir registros con el nombre escrito distinto.
      </Text>

      {isAdmin && id && (
        <TouchableOpacity style={styles.deleteBtn} onPress={() => onDelete(id, nombre)}>
          <Text style={styles.deleteText}>🗑 Ocultar vereda del mapa</Text>
        </TouchableOpacity>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    padding: SPACING.lg,
    ...SHADOWS.lg,
  },
  closeBtn: {
    position: 'absolute',
    top: SPACING.sm,
    right: SPACING.sm,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.overlay,
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  closeText: { color: '#fff', fontSize: 14, fontWeight: FONTS.weights.bold },
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  label: { fontSize: FONTS.sizes.md, color: COLORS.textSecondary },
  value: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  aviso: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
    marginTop: SPACING.xs,
    fontStyle: 'italic',
  },
  deleteBtn: {
    marginTop: SPACING.md,
    backgroundColor: COLORS.error + '15',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.error + '30',
  },
  deleteText: { color: COLORS.error, fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold },
});

export default VeredaDetailCard;
