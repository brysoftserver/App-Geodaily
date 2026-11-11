// ============================================================
// GEODAILY — Piezas visuales del "Revisado por interventoría"
// ============================================================
//   · BotonOkInterventoria → botón "OK" (admin / interventor). Revisado se ve
//     verde relleno ("✓ OK"); tocarlo de nuevo quita la revisión.
//   · EtiquetaRevisado     → texto "✓ Revisado por interventoría".
//   · ESTILO_CARD_REVISADA → tarjeta en verde.
// ============================================================

import React from 'react';
import { ActivityIndicator, StyleSheet, Text, TouchableOpacity, ViewStyle } from 'react-native';
import { BORDER_RADIUS, COLORS, FONTS, SPACING } from '../../theme';

export const VERDE_REVISADO = COLORS.success;
export const FONDO_REVISADO = '#E8F5E9';

export const ESTILO_CARD_REVISADA: ViewStyle = {
  backgroundColor: FONDO_REVISADO,
  borderLeftColor: VERDE_REVISADO,
  borderColor: VERDE_REVISADO,
};

export const BotonOkInterventoria: React.FC<{
  revisado: boolean;
  ocupado?: boolean;
  onPress: () => void;
  style?: ViewStyle;
}> = ({ revisado, ocupado, onPress, style }) => (
  <TouchableOpacity
    style={[styles.btn, revisado ? styles.btnRevisado : styles.btnPendiente, style]}
    onPress={onPress}
    disabled={ocupado}
    activeOpacity={0.8}
    hitSlop={4}
  >
    {ocupado ? (
      <ActivityIndicator size="small" color={revisado ? '#fff' : VERDE_REVISADO} />
    ) : (
      <Text style={[styles.txt, { color: revisado ? '#fff' : VERDE_REVISADO }]}>{revisado ? '✓ OK' : 'OK'}</Text>
    )}
  </TouchableOpacity>
);

export const EtiquetaRevisado: React.FC<{ revisado: boolean; pendiente?: boolean }> = ({ revisado, pendiente }) =>
  revisado ? (
    <Text style={[styles.etiqueta, { color: VERDE_REVISADO }]}>✓ Revisado por interventoría</Text>
  ) : pendiente ? (
    <Text style={[styles.etiqueta, { color: COLORS.warning }]}>Pendiente de revisión de interventoría</Text>
  ) : null;

const styles = StyleSheet.create({
  btn: {
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: 6,
    paddingHorizontal: SPACING.sm,
    minWidth: 56,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: VERDE_REVISADO,
  },
  btnPendiente: { backgroundColor: COLORS.surface },
  btnRevisado: { backgroundColor: VERDE_REVISADO },
  txt: { fontWeight: FONTS.weights.bold, fontSize: FONTS.sizes.sm },
  etiqueta: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold, marginTop: 3 },
});
