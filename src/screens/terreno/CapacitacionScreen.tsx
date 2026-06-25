// ============================================================
// GEODAILY — Capacitaciones (Técnico de Campo - Vista)
// ============================================================

import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  SafeAreaView,
  Alert,
} from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';

interface MaterialCapacitacion {
  id: string;
  nombre: string;
  url: string;
  tipo: 'pdf' | 'video' | 'imagen';
}

interface CapacitacionItem {
  id: string;
  tema: string;
  descripcion: string;
  fecha: string;
  duracion_minutos: number;
  material?: MaterialCapacitacion;
  completada: boolean;
}

const MOCK_CAPACITACIONES: CapacitacionItem[] = [
  {
    id: 'cap-001',
    tema: 'Buenas Prácticas Agrícolas (BPA)',
    descripcion:
      'Guía completa sobre BPA en cultivos de cacao: manejo de sombra, podas, control de plagas y cosecha selectiva.',
    fecha: '2026-06-20',
    duracion_minutos: 45,
    material: {
      id: 'mat-001',
      nombre: 'Guía BPA Cacao 2026.pdf',
      url: 'https://geodaily.app/materiales/bpa-cacao-2026.pdf',
      tipo: 'pdf',
    },
    completada: true,
  },
  {
    id: 'cap-002',
    tema: 'Fertilización Orgánica',
    descripcion:
      'Métodos de fertilización orgánica para renovación de cacao: compostaje, bocashi y abonos verdes.',
    fecha: '2026-06-25',
    duracion_minutos: 30,
    material: {
      id: 'mat-002',
      nombre: 'Manual Fertilización Orgánica.pdf',
      url: 'https://geodaily.app/materiales/fertilizacion-organica.pdf',
      tipo: 'pdf',
    },
    completada: false,
  },
  {
    id: 'cap-003',
    tema: 'Manejo Integrado de Plagas',
    descripcion:
      'Identificación y control de monilia, escoba de bruja y otros fitopatógenos del cacao.',
    fecha: '2026-07-02',
    duracion_minutos: 60,
    completada: false,
  },
];

const TEMAS = ['Todos', 'BPA', 'Fertilización', 'Plagas', 'Suelos', 'Postcosecha'];

const CapacitacionScreen: React.FC = () => {
  const [filtroTema, setFiltroTema] = useState('Todos');
  const [seleccionada, setSeleccionada] = useState<string | null>(null);

  const filtered =
    filtroTema === 'Todos'
      ? MOCK_CAPACITACIONES
      : MOCK_CAPACITACIONES.filter((c) =>
          c.tema.toLowerCase().includes(filtroTema.toLowerCase())
        );

  const handleOpenMaterial = useCallback((material: MaterialCapacitacion) => {
    Alert.alert(
      'Abrir material',
      `¿Deseas abrir "${material.nombre}"?`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Abrir',
          onPress: () => {
            // Aquí se integraría la apertura del material (WebView, visor PDF, etc.)
            Alert.alert('Material', `Abriendo: ${material.nombre}`);
          },
        },
      ]
    );
  }, []);

  const toggleDetalle = useCallback((id: string) => {
    setSeleccionada((prev) => (prev === id ? null : id));
  }, []);

  return (
    <SafeAreaView style={styles.container}>
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <Text style={styles.pageTitle}>📚 Capacitaciones</Text>
        <Text style={styles.pageSubtitle}>
          Material de formación y guías técnicas para técnicos de campo
        </Text>

        {/* Filtro por tema */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.filterRow}
        >
          {TEMAS.map((tema) => (
            <TouchableOpacity
              key={tema}
              style={[styles.filterChip, filtroTema === tema && styles.filterChipActive]}
              onPress={() => setFiltroTema(tema)}
            >
              <Text
                style={[
                  styles.filterChipText,
                  filtroTema === tema && styles.filterChipTextActive,
                ]}
              >
                {tema}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Lista de capacitaciones */}
        {filtered.length === 0 ? (
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyText}>
              No hay capacitaciones para este filtro
            </Text>
          </View>
        ) : (
          filtered.map((cap) => (
            <TouchableOpacity
              key={cap.id}
              style={styles.card}
              onPress={() => toggleDetalle(cap.id)}
              activeOpacity={0.7}
            >
              <View style={styles.cardHeader}>
                <View style={styles.cardIcon}>
                  <Text style={styles.cardIconText}>
                    {cap.completada ? '✅' : '📖'}
                  </Text>
                </View>
                <View style={styles.cardInfo}>
                  <Text style={styles.cardTitle}>{cap.tema}</Text>
                  <Text style={styles.cardMeta}>
                    {new Date(cap.fecha).toLocaleDateString('es-CO', {
                      day: 'numeric',
                      month: 'long',
                      year: 'numeric',
                    })}{' '}
                    · {cap.duracion_minutos} min
                  </Text>
                </View>
                <Text style={styles.cardArrow}>
                  {seleccionada === cap.id ? '▲' : '▼'}
                </Text>
              </View>

              {seleccionada === cap.id && (
                <View style={styles.cardDetail}>
                  <Text style={styles.cardDesc}>{cap.descripcion}</Text>

                  {cap.material && (
                    <TouchableOpacity
                      style={styles.materialBtn}
                      onPress={() => handleOpenMaterial(cap.material!)}
                    >
                      <Text style={styles.materialIcon}>
                        {cap.material.tipo === 'pdf'
                          ? '📄'
                          : cap.material.tipo === 'video'
                          ? '🎬'
                          : '🖼️'}
                      </Text>
                      <View style={styles.materialInfo}>
                        <Text style={styles.materialName}>
                          {cap.material.nombre}
                        </Text>
                        <Text style={styles.materialType}>
                          {cap.material.tipo.toUpperCase()}
                        </Text>
                      </View>
                      <Text style={styles.materialOpen}>Abrir →</Text>
                    </TouchableOpacity>
                  )}

                  <View
                    style={[
                      styles.statusBadge,
                      cap.completada
                        ? styles.statusBadgeOk
                        : styles.statusBadgePending,
                    ]}
                  >
                    <Text
                      style={[
                        styles.statusBadgeText,
                        cap.completada
                          ? styles.statusBadgeTextOk
                          : styles.statusBadgeTextPending,
                      ]}
                    >
                      {cap.completada ? 'Completada' : 'Pendiente'}
                    </Text>
                  </View>
                </View>
              )}
            </TouchableOpacity>
          ))
        )}
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    padding: SPACING.md,
    paddingBottom: SPACING.xl,
  },
  pageTitle: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  pageSubtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.md,
  },
  // --- Filters ---
  filterRow: {
    marginBottom: SPACING.md,
  },
  filterChip: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.surface,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginRight: SPACING.sm,
  },
  filterChipActive: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  filterChipText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  filterChipTextActive: {
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.semibold,
  },
  // --- Empty ---
  emptyState: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: SPACING.md,
  },
  emptyText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
  },
  // --- Card ---
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  cardIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.surfaceAlt,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  cardIconText: {
    fontSize: 18,
  },
  cardInfo: {
    flex: 1,
  },
  cardTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  cardMeta: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  cardArrow: {
    fontSize: 12,
    color: COLORS.textLight,
    paddingLeft: SPACING.sm,
  },
  // --- Detail ---
  cardDetail: {
    marginTop: SPACING.md,
    paddingTop: SPACING.md,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
  },
  cardDesc: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    lineHeight: 20,
    marginBottom: SPACING.md,
  },
  materialBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.md,
  },
  materialIcon: {
    fontSize: 24,
    marginRight: SPACING.md,
  },
  materialInfo: {
    flex: 1,
  },
  materialName: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  materialType: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  materialOpen: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.primary,
    fontWeight: FONTS.weights.semibold,
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
  },
  statusBadgeOk: {
    backgroundColor: COLORS.success + '20',
  },
  statusBadgePending: {
    backgroundColor: COLORS.warning + '20',
  },
  statusBadgeText: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.semibold,
  },
  statusBadgeTextOk: {
    color: COLORS.success,
  },
  statusBadgeTextPending: {
    color: COLORS.warning,
  },
});

export default CapacitacionScreen;
