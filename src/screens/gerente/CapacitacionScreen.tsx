// ============================================================
// GEODAILY — Capacitación (Gerencia)
// ============================================================

import React, { useState, useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';

type CapacitacionProps = {
  navigation: NativeStackNavigationProp<any>;
};

interface Material {
  id: string;
  title: string;
  description: string;
  type: 'guia' | 'video' | 'documento' | 'enlace';
  url?: string;
  tema: string;
}

const MATERIALES: Material[] = [
  { id: '1', title: 'Guía de Buenas Prácticas Agrícolas', description: 'Manual completo para el manejo del cultivo de cacao', type: 'guia', tema: 'Cultivo' },
  { id: '2', title: 'Protocolo de Visita Técnica', description: 'Procedimiento estandarizado para visitas a terreno', type: 'guia', tema: 'Campo' },
  { id: '3', title: 'Manejo Fitosanitario del Cacao', description: 'Control de plagas y enfermedades comunes', type: 'documento', tema: 'Cultivo' },
  { id: '4', title: 'Uso de la App GEODAILY', description: 'Video tutorial sobre el diligenciamiento de formularios', type: 'video', tema: 'Campo' },
  { id: '5', title: 'Fertilización Orgánica', description: 'Recomendaciones para abonos orgánicos en cacao', type: 'guia', tema: 'Cultivo' },
  { id: '6', title: 'Normatividad Cacaotera', description: 'Marco legal y normativo para productores', type: 'documento', tema: 'Legal' },
  { id: '7', title: 'SIG y Georreferenciación', description: 'Introducción al uso de mapas y coordenadas en campo', type: 'guia', tema: 'Tecnología' },
  { id: '8', title: 'Primeros Auxilios en Campo', description: 'Protocolo de emergencias para técnicos', type: 'guia', tema: 'Seguridad' },
];

const TEMAS = ['Todos', 'Cultivo', 'Campo', 'Legal', 'Tecnología', 'Seguridad'];

const CapacitacionScreen: React.FC<CapacitacionProps> = ({ navigation }) => {
  const [selectedTema, setSelectedTema] = useState('Todos');
  const [completados, setCompletados] = useState<Set<string>>(new Set());

  const filteredMateriales = useMemo(() => {
    if (selectedTema === 'Todos') return MATERIALES;
    return MATERIALES.filter(m => m.tema === selectedTema);
  }, [selectedTema]);

  const toggleCompletado = (id: string) => {
    const newSet = new Set(completados);
    if (newSet.has(id)) newSet.delete(id);
    else newSet.add(id);
    setCompletados(newSet);
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'guia': return '📖';
      case 'video': return '🎬';
      case 'documento': return '📄';
      case 'enlace': return '🔗';
      default: return '📁';
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Capacitación</Text>
      <Text style={styles.subtitle}>
        {completados.size}/{MATERIALES.length} materiales completados
      </Text>

      {/* Filtro por tema */}
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.temaRow}>
        {TEMAS.map(tema => (
          <TouchableOpacity
            key={tema}
            style={[styles.temaChip, selectedTema === tema && styles.temaChipActive]}
            onPress={() => setSelectedTema(tema)}
          >
            <Text style={[styles.temaChipText, selectedTema === tema && styles.temaChipTextActive]}>
              {tema}
            </Text>
          </TouchableOpacity>
        ))}
      </ScrollView>

      {/* Lista de materiales */}
      {filteredMateriales.map(material => {
        const isCompleted = completados.has(material.id);
        return (
          <TouchableOpacity
            key={material.id}
            style={[styles.materialCard, isCompleted && styles.materialCardCompleted]}
            onPress={() => toggleCompletado(material.id)}
            activeOpacity={0.7}
          >
            <View style={styles.materialHeader}>
              <Text style={styles.materialIcon}>{getTypeIcon(material.type)}</Text>
              <View style={styles.materialInfo}>
                <Text style={[styles.materialTitle, isCompleted && styles.materialTitleCompleted]}>
                  {material.title}
                </Text>
                <Text style={styles.materialDescription}>{material.description}</Text>
              </View>
              <View style={[styles.checkbox, isCompleted && styles.checkboxDone]}>
                {isCompleted && <Text style={styles.checkMark}>✓</Text>}
              </View>
            </View>
            <View style={styles.materialFooter}>
              <View style={styles.temaBadge}>
                <Text style={styles.temaBadgeText}>{material.tema}</Text>
              </View>
              <Text style={styles.typeLabel}>{material.type.toUpperCase()}</Text>
            </View>
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xl },
  title: { fontSize: FONTS.sizes.xxl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  subtitle: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginBottom: SPACING.md },
  temaRow: { marginBottom: SPACING.md },
  temaChip: {
    paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.surface, marginRight: SPACING.sm, borderWidth: 1, borderColor: COLORS.border,
  },
  temaChipActive: { backgroundColor: COLORS.roleGerente, borderColor: COLORS.roleGerente },
  temaChipText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },
  temaChipTextActive: { color: '#fff', fontWeight: FONTS.weights.semibold },
  materialCard: {
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md, marginBottom: SPACING.sm, ...SHADOWS.sm,
  },
  materialCardCompleted: { opacity: 0.85, borderLeftWidth: 3, borderLeftColor: COLORS.success },
  materialHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  materialIcon: { fontSize: 28, marginRight: SPACING.md, marginTop: 2 },
  materialInfo: { flex: 1 },
  materialTitle: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  materialTitleCompleted: { color: COLORS.success, textDecorationLine: 'line-through' },
  materialDescription: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 2 },
  checkbox: {
    width: 24, height: 24, borderRadius: 12, borderWidth: 2, borderColor: COLORS.border,
    justifyContent: 'center', alignItems: 'center', marginLeft: SPACING.sm,
  },
  checkboxDone: { backgroundColor: COLORS.success, borderColor: COLORS.success },
  checkMark: { color: '#fff', fontWeight: FONTS.weights.bold, fontSize: 14 },
  materialFooter: { flexDirection: 'row', alignItems: 'center', marginTop: SPACING.sm, gap: SPACING.sm },
  temaBadge: {
    backgroundColor: COLORS.surfaceAlt, paddingHorizontal: SPACING.sm, paddingVertical: 2,
    borderRadius: BORDER_RADIUS.sm,
  },
  temaBadgeText: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary },
  typeLabel: { fontSize: FONTS.sizes.xs, color: COLORS.textLight },
});

export default CapacitacionScreen;
