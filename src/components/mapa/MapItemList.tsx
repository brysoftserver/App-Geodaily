// ============================================================
// GEODAILY — Lista de elementos del mapa
// ============================================================

import React from 'react';
import { View, Text, TouchableOpacity, ScrollView, StyleSheet } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../../theme';

interface MapItemListProps {
  items: any[];
  plantaciones: any[];
  mediciones: any[];
  isAdmin: boolean;
  onSelect: (item: any) => void;
  onDelete: (tipo: 'plantación' | 'medición', id: string) => void;
}

const ICONOS_ESPECIE: Record<string, string> = {
  cacao: '🍫', platano: '🍌', banano: '🍌',
  café: '☕', cafe: '☕', citricos: '🍊', cítricos: '🍊',
  naranja: '🍊', limón: '🍋', limon: '🍋',
  aguacate: '🥑', mango: '🥭', guanabana: '🍈', guanábana: '🍈',
  maracuya: '💜', maracuyá: '💜', forestal: '🌳',
  pasto: '🌿', maíz: '🌽', maiz: '🌽', yuca: '🥔', hortalizas: '🥬',
};

const getIconoEspecie = (especie: string): string => {
  const key = especie?.toLowerCase().trim() || '';
  return ICONOS_ESPECIE[key] || '🌱';
};

const MapItemList: React.FC<MapItemListProps> = ({
  items,
  plantaciones,
  mediciones,
  isAdmin,
  onSelect,
  onDelete,
}) => {
  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {items.map((item) => {
        const isPlantacion = item.id.startsWith('plant-');
        const isMedicion = item.id.startsWith('med-');
        const realId = item.id.replace(/^(plant-|med-|tec-)/, '');

        if (isPlantacion) {
          const p = plantaciones.find((x: any) => x.id === realId);
          if (!p) return null;
          return (
            <TouchableOpacity
              key={item.id}
              style={styles.item}
              onPress={() => onSelect(item)}
            >
              <Text style={styles.icon}>{p.icono || getIconoEspecie(p.especie)}</Text>
              <View style={styles.contentCol}>
                <Text style={styles.title}>{p.especie}</Text>
                <Text style={styles.subtitle}>{p.cantidad} plantas</Text>
              </View>
              {isAdmin && (
                <TouchableOpacity onPress={() => onDelete('plantación', realId)}>
                  <Text style={styles.deleteIcon}>🗑</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          );
        }

        if (isMedicion) {
          const m = mediciones.find((x: any) => x.id === realId);
          if (!m) return null;
          return (
            <TouchableOpacity
              key={item.id}
              style={styles.item}
              onPress={() => onSelect(item)}
            >
              <Text style={styles.icon}>📐</Text>
              <View style={styles.contentCol}>
                <Text style={styles.title}>{m.area_hectareas?.toFixed(2)} ha</Text>
                <Text style={styles.subtitle}>Perímetro: {m.perimetro_metros?.toFixed(1)} m</Text>
              </View>
              {isAdmin && (
                <TouchableOpacity onPress={() => onDelete('medición', realId)}>
                  <Text style={styles.deleteIcon}>🗑</Text>
                </TouchableOpacity>
              )}
            </TouchableOpacity>
          );
        }

        return null;
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { maxHeight: 200, backgroundColor: COLORS.surface },
  content: { padding: SPACING.sm },
  item: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
    paddingHorizontal: SPACING.md,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  icon: { fontSize: 24, marginRight: SPACING.md },
  contentCol: { flex: 1 },
  title: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  subtitle: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },
  deleteIcon: { fontSize: 18 },
});

export default MapItemList;
