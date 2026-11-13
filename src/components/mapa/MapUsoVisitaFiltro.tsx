// ============================================================
// GEODAILY — Filtro de polígonos por uso en la Visita 2
// ============================================================
// El servidor marca cada medición con `uso_visita`:
//   'visita'   → usada en una Visita 2 completada
//   'borrador' → elegida en una visita guardada sin enviar
//   null       → no usada en ninguna visita
// Sirve para que el admin limpie los polígonos sobrantes y sepa cuándo
// terminó (el contador de "No usados" llega a 0).

import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../../theme';

export type FiltroUsoVisita = 'todos' | 'no_usados' | 'usados';
export type UsoVisita = 'visita' | 'borrador' | 'no_usado';

/** Colores del polígono según su uso (mapa y tarjeta de detalle). */
export const COLOR_USO_VISITA: Record<UsoVisita, string> = {
  visita: '#2E7D32',
  borrador: '#1565C0',
  no_usado: '#E65100',
};

/** Uso de una medición; null si el dato no viene del servidor (modo local). */
export const usoVisitaDe = (m: Record<string, any> | null | undefined): UsoVisita | null => {
  if (!m || !('uso_visita' in m)) return null;
  if (m.uso_visita === 'visita') return 'visita';
  if (m.uso_visita === 'borrador') return 'borrador';
  return 'no_usado';
};

/** Los de borrador cuentan como usados: un técnico los tiene elegidos. */
export const cumpleFiltroUso = (m: Record<string, any>, filtro: FiltroUsoVisita): boolean => {
  if (filtro === 'todos') return true;
  const uso = usoVisitaDe(m);
  if (uso === null) return true;
  return filtro === 'no_usados' ? uso === 'no_usado' : uso !== 'no_usado';
};

interface Props {
  filtro: FiltroUsoVisita;
  onChange: (f: FiltroUsoVisita) => void;
  conteo: { total: number; usados: number; borrador: number; noUsados: number };
}

const MapUsoVisitaFiltro: React.FC<Props> = ({ filtro, onChange, conteo }) => {
  const opciones: { id: FiltroUsoVisita; texto: string; color?: string }[] = [
    { id: 'todos', texto: `Todos (${conteo.total})` },
    { id: 'no_usados', texto: `⚠️ No usados (${conteo.noUsados})`, color: COLOR_USO_VISITA.no_usado },
    {
      id: 'usados',
      texto: `✅ Usados en visita (${conteo.usados + conteo.borrador})`,
      color: COLOR_USO_VISITA.visita,
    },
  ];
  return (
    <View style={styles.wrapper}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.row}>
        <Text style={styles.label}>Visita 2:</Text>
        {opciones.map((o) => {
          const activo = filtro === o.id;
          const color = o.color || COLORS.primary;
          return (
            <TouchableOpacity
              key={o.id}
              style={[styles.chip, activo && { backgroundColor: color, borderColor: color }]}
              onPress={() => onChange(o.id)}
              activeOpacity={0.7}
            >
              <Text style={[styles.chipText, activo && styles.chipTextActive]}>{o.texto}</Text>
            </TouchableOpacity>
          );
        })}
        {filtro === 'no_usados' && conteo.noUsados === 0 && (
          <Text style={styles.listo}>🎉 No quedan polígonos sin usar</Text>
        )}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
    paddingVertical: SPACING.xs,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: SPACING.sm,
  },
  label: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.semibold,
  },
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt,
  },
  chipText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.medium,
  },
  chipTextActive: {
    color: '#FFFFFF',
    fontWeight: FONTS.weights.semibold,
  },
  listo: {
    fontSize: FONTS.sizes.xs,
    color: COLOR_USO_VISITA.visita,
    fontWeight: FONTS.weights.semibold,
  },
});

export default MapUsoVisitaFiltro;
