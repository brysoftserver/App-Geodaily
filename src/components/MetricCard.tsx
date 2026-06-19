// ============================================================
// GEODAILY — Componente de Tarjeta de Métrica
// ============================================================

import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../theme';

interface MetricCardProps {
  titulo: string;
  valor: string | number;
  icono?: string;
  color?: string;
  subtitulo?: string;
}

const MetricCard: React.FC<MetricCardProps> = ({
  titulo,
  valor,
  color = COLORS.primary,
  subtitulo,
}) => {
  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <Text style={styles.titulo}>{titulo}</Text>
      <Text style={[styles.valor, { color }]}>{valor}</Text>
      {subtitulo && <Text style={styles.subtitulo}>{subtitulo}</Text>}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginHorizontal: SPACING.xs,
    borderLeftWidth: 4,
    minWidth: 100,
    ...SHADOWS.sm,
  },
  titulo: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  valor: {
    fontSize: FONTS.sizes.xxl,
    fontWeight: FONTS.weights.bold,
  },
  subtitulo: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
    marginTop: SPACING.xs,
  },
});

export default MetricCard;
