// ============================================================
// GEODAILY — Últimas actividades (clickeable)
// ============================================================

import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { Formulario } from '../../types';
import { resolverCorregimiento, NOMBRE_VISIBLE_CORREGIMIENTO } from '../../utils/corregimientos';

interface ActividadesRecientesProps {
  formularios: Formulario[];
  onSeleccionar: (formulario: Formulario) => void;
  limite?: number;
}

const etiquetaTipo = (tipo: Formulario['tipo']) =>
  tipo === 'visita_tecnica' ? 'Visita Técnica' : 'Encuesta Socioambiental';

const ActividadesRecientes: React.FC<ActividadesRecientesProps> = ({ formularios, onSeleccionar, limite = 8 }) => {
  const recientes = [...formularios]
    .sort((a, b) => (b.created_at || '').localeCompare(a.created_at || ''))
    .slice(0, limite);

  return (
    <View style={styles.card}>
      <Text style={styles.titulo}>Últimas actividades</Text>
      <Text style={styles.subtitulo}>Toca una actividad para ver el formulario completo</Text>

      {recientes.length === 0 && (
        <Text style={styles.vacio}>No hay actividades registradas todavía.</Text>
      )}

      {recientes.map((form) => {
        const corregimiento = resolverCorregimiento(form);
        return (
          <TouchableOpacity
            key={form.id}
            style={styles.item}
            onPress={() => onSeleccionar(form)}
            activeOpacity={0.6}
          >
            <View style={styles.itemCabecera}>
              <Text style={styles.itemNombre} numberOfLines={1}>
                {form.beneficiario?.nombre || '—'}
              </Text>
              <View
                style={[
                  styles.badge,
                  { backgroundColor: form.tipo === 'visita_tecnica' ? COLORS.roleTecnico : COLORS.secondary },
                ]}
              >
                <Text style={styles.badgeTexto}>{etiquetaTipo(form.tipo)}</Text>
              </View>
            </View>
            <Text style={styles.itemMeta}>
              👤 {form.tecnico?.nombre || '—'}   ·   🥾 {form.beneficiario?.vereda || '—'}
            </Text>
            <Text style={styles.itemMeta}>
              📍 {corregimiento ? NOMBRE_VISIBLE_CORREGIMIENTO[corregimiento] : 'Sin corregimiento'}   ·   🗓️{' '}
              {form.created_at ? new Date(form.created_at).toLocaleDateString('es-CO') : '—'}
            </Text>
            <Text style={styles.itemChevron}>›</Text>
          </TouchableOpacity>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.md,
    ...SHADOWS.sm,
  },
  titulo: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  subtitulo: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
    marginBottom: SPACING.sm,
  },
  vacio: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textLight,
    marginTop: SPACING.sm,
  },
  item: {
    paddingVertical: SPACING.sm,
    paddingRight: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  itemCabecera: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  itemNombre: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
    flexShrink: 1,
    marginRight: SPACING.sm,
  },
  badge: {
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: SPACING.xs,
    paddingVertical: 2,
  },
  badgeTexto: {
    color: COLORS.textOnPrimary,
    fontSize: 10,
    fontWeight: FONTS.weights.semibold,
  },
  itemMeta: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  itemChevron: {
    position: 'absolute',
    right: 0,
    top: '50%',
    marginTop: -14,
    fontSize: 24,
    color: COLORS.textLight,
  },
});

export default ActividadesRecientes;
