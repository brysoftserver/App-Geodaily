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
  icono,
  color = COLORS.primary,
  subtitulo,
}) => {
  return (
    <View style={[styles.card, { borderLeftColor: color }]}>
      <View style={styles.tituloRow}>
        {icono && <Text style={styles.icono}>{icono}</Text>}
        <Text style={styles.titulo} numberOfLines={2} ellipsizeMode="tail">
          {titulo}
        </Text>
      </View>
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
    marginBottom: SPACING.sm,
    borderLeftWidth: 4,
    minWidth: 100,
    ...SHADOWS.sm,
  },
  tituloRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: SPACING.xs,
    // Reserva siempre el alto de 2 líneas de título (haya 1 o 2), para que
    // el valor y el subtítulo arranquen a la misma altura en toda la fila
    // de tarjetas, sin importar cuánto texto tenga cada título.
    minHeight: 28,
  },
  icono: {
    fontSize: FONTS.sizes.sm,
    marginRight: SPACING.xs,
  },
  titulo: {
    flex: 1,
    fontSize: FONTS.sizes.xs,
    lineHeight: 14,
    color: COLORS.textSecondary,
    textTransform: 'uppercase',
    letterSpacing: 0.3,
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
