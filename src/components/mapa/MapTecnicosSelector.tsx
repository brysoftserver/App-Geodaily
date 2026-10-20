import React from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../../theme';

export interface TecnicoFiltro {
  /** id del usuario (usuario_id de la medición / posición) */
  id: string;
  nombre: string;
  /** Cantidad de mediciones de ese técnico */
  conteo: number;
}

interface MapTecnicosSelectorProps {
  tecnicos: TecnicoFiltro[];
  /** ids seleccionados */
  seleccionados: Set<string>;
  onToggle: (id: string) => void;
  /** Selecciona / deselecciona todos */
  onToggleTodos: () => void;
  /** Total de mediciones (para el chip "Todos") */
  totalMediciones: number;
}

/**
 * Fila horizontal de chips con los técnicos. Se muestra debajo del botón
 * "Mediciones" cuando esa capa está activa: al tocar un técnico se muestran
 * (o se ocultan) sus polígonos en el mapa.
 */
const MapTecnicosSelector: React.FC<MapTecnicosSelectorProps> = ({
  tecnicos,
  seleccionados,
  onToggle,
  onToggleTodos,
  totalMediciones,
}) => {
  if (tecnicos.length === 0) return null;

  const todosSeleccionados = tecnicos.every((t) => seleccionados.has(t.id));

  return (
    <View style={styles.wrapper}>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.row}
      >
        <TouchableOpacity
          style={[styles.chip, todosSeleccionados && styles.chipActive]}
          onPress={onToggleTodos}
          activeOpacity={0.7}
        >
          <Text style={[styles.chipText, todosSeleccionados && styles.chipTextActive]}>
            👥 Todos ({totalMediciones})
          </Text>
        </TouchableOpacity>

        {tecnicos.map((t) => {
          const activo = seleccionados.has(t.id);
          return (
            <TouchableOpacity
              key={t.id}
              style={[styles.chip, activo && styles.chipActive]}
              onPress={() => onToggle(t.id)}
              activeOpacity={0.7}
            >
              <Text
                style={[styles.chipText, activo && styles.chipTextActive]}
                numberOfLines={1}
              >
                {t.nombre} ({t.conteo})
              </Text>
            </TouchableOpacity>
          );
        })}
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
  chip: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.border,
    backgroundColor: COLORS.surfaceAlt,
    maxWidth: 190,
  },
  chipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.medium,
  },
  chipTextActive: {
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.semibold,
  },
});

export default MapTecnicosSelector;
