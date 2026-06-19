// ============================================================
// GEODAILY — Componente de Barra de Filtros
// ============================================================

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
} from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../theme';

export interface FilterOption {
  label: string;
  value: string;
}

interface FilterBarProps {
  options: FilterOption[];
  selected: string | null;
  onSelect: (value: string | null) => void;
  label?: string;
}

const FilterBar: React.FC<FilterBarProps> = ({
  options,
  selected,
  onSelect,
  label,
}) => {
  return (
    <View style={styles.container}>
      {label && <Text style={styles.label}>{label}</Text>}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
      >
        <TouchableOpacity
          style={[styles.chip, selected === null && styles.chipSelected]}
          onPress={() => onSelect(null)}
        >
          <Text
            style={[
              styles.chipText,
              selected === null && styles.chipTextSelected,
            ]}
          >
            Todos
          </Text>
        </TouchableOpacity>

        {options.map((option) => (
          <TouchableOpacity
            key={option.value}
            style={[
              styles.chip,
              selected === option.value && styles.chipSelected,
            ]}
            onPress={() =>
              onSelect(selected === option.value ? null : option.value)
            }
          >
            <Text
              style={[
                styles.chipText,
                selected === option.value && styles.chipTextSelected,
              ]}
            >
              {option.label}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginVertical: SPACING.sm,
  },
  label: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
    marginHorizontal: SPACING.md,
  },
  scrollContent: {
    paddingHorizontal: SPACING.md,
    gap: SPACING.sm,
  },
  chip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipSelected: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  chipText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  chipTextSelected: {
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.medium,
  },
});

export default FilterBar;
