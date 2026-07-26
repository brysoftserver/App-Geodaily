// ============================================================
// GEODAILY — Áreas de Plantación por Técnico (roles superiores)
// ============================================================
// Lista maestro/detalle: técnicos → sus áreas de plantación marcadas
// en el mapa, con especie, cantidad, vereda y beneficiario asociado
// (cuando el técnico los registró al guardar el área).
// ============================================================

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  RefreshControl,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useSyncMapData } from '../../hooks/useSyncMapData';

type PlantacionesPorTecnicoScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
};

interface PlantacionRow {
  id: string;
  especie: string;
  cantidad: number;
  icono?: string;
  usuario_nombre?: string;
  created_at?: string;
  poligono?: unknown[] | null;
  beneficiario_nombre?: string | null;
  vereda?: string | null;
  corregimiento?: string | null;
}

interface TecnicoAgrupado {
  nombre: string;
  areas: PlantacionRow[];
  totalPlantas: number;
  totalAreasTrazadas: number;
}

const PlantacionesPorTecnicoScreen: React.FC<PlantacionesPorTecnicoScreenProps> = () => {
  const { plantaciones, fetchAllPlantaciones } = useSyncMapData();
  const [refreshing, setRefreshing] = useState(false);
  const [tecnicoSeleccionado, setTecnicoSeleccionado] = useState<string | null>(null);

  useEffect(() => { fetchAllPlantaciones(); }, [fetchAllPlantaciones]);
  useFocusEffect(useCallback(() => { fetchAllPlantaciones(); }, [fetchAllPlantaciones]));

  const tecnicos = useMemo<TecnicoAgrupado[]>(() => {
    const mapa = new Map<string, PlantacionRow[]>();
    for (const p of plantaciones as PlantacionRow[]) {
      const nombre = p.usuario_nombre || 'Desconocido';
      if (!mapa.has(nombre)) mapa.set(nombre, []);
      mapa.get(nombre)!.push(p);
    }
    return Array.from(mapa.entries())
      .map(([nombre, areas]) => ({
        nombre,
        areas: areas.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
        totalPlantas: areas.reduce((sum, a) => sum + (a.cantidad || 0), 0),
        totalAreasTrazadas: areas.filter((a) => (a.poligono?.length ?? 0) >= 3).length,
      }))
      .sort((a, b) => b.areas.length - a.areas.length);
  }, [plantaciones]);

  const seleccionado = tecnicos.find((t) => t.nombre === tecnicoSeleccionado);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAllPlantaciones();
    setRefreshing(false);
  }, [fetchAllPlantaciones]);

  if (seleccionado) {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => setTecnicoSeleccionado(null)} style={styles.backRow}>
          <Text style={styles.backArrow}>‹ Volver a técnicos</Text>
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={styles.tecnicoNombre}>{seleccionado.nombre}</Text>
          <Text style={styles.tecnicoStats}>
            {seleccionado.areas.length} área(s) · {seleccionado.totalPlantas} plantas · {seleccionado.totalAreasTrazadas} con polígono
          </Text>
        </View>

        <FlatList
          data={seleccionado.areas}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} tintColor={COLORS.primary} />}
          renderItem={({ item }) => (
            <View style={styles.areaCard}>
              <Text style={styles.areaIcono}>{item.icono || '🌱'}</Text>
              <View style={styles.areaInfo}>
                <Text style={styles.areaEspecie}>{item.cantidad}x {item.especie}</Text>
                <Text style={styles.areaMeta}>
                  {(item.poligono?.length ?? 0) >= 3 ? '📐 Área trazada' : '📍 Punto'}
                  {item.created_at ? ` · ${new Date(item.created_at).toLocaleDateString('es-CO')}` : ''}
                </Text>
                {!!item.beneficiario_nombre && (
                  <Text style={styles.areaBeneficiario}>👤 {item.beneficiario_nombre}</Text>
                )}
                {(!!item.vereda || !!item.corregimiento) && (
                  <Text style={styles.areaVereda}>
                    📍 {[item.vereda, item.corregimiento].filter(Boolean).join(' — ')}
                  </Text>
                )}
              </View>
            </View>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Este técnico no tiene áreas de plantación registradas.</Text>
            </View>
          }
        />
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={tecnicos}
        keyExtractor={(item) => item.nombre}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} tintColor={COLORS.primary} />}
        ListHeaderComponent={
          <>
            <Text style={styles.title}>Áreas de Plantación</Text>
            <Text style={styles.subtitle}>{tecnicos.length} técnico(s) con áreas registradas</Text>
          </>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.tecnicoCard}
            onPress={() => setTecnicoSeleccionado(item.nombre)}
            activeOpacity={0.7}
          >
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{item.nombre.charAt(0).toUpperCase()}</Text>
            </View>
            <View style={styles.tecnicoInfo}>
              <Text style={styles.tecnicoNombre}>{item.nombre}</Text>
              <Text style={styles.tecnicoStats}>
                {item.areas.length} área(s) · {item.totalPlantas} plantas
              </Text>
            </View>
            <Text style={styles.chevron}>›</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          <View style={styles.emptyState}>
            <Text style={styles.emptyIcon}>🌱</Text>
            <Text style={styles.emptyText}>Aún no hay áreas de plantación registradas.</Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  listContent: { flexGrow: 1, padding: SPACING.lg, paddingBottom: SPACING.xl },
  title: { fontSize: FONTS.sizes.xxl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  subtitle: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginBottom: SPACING.md },
  backRow: { marginTop: SPACING.md, marginHorizontal: SPACING.lg, marginBottom: SPACING.sm },
  backArrow: { fontSize: FONTS.sizes.md, color: COLORS.info, fontWeight: FONTS.weights.semibold },
  header: { paddingHorizontal: SPACING.lg, marginBottom: SPACING.sm },
  tecnicoCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm, ...SHADOWS.md,
  },
  avatar: {
    width: 48, height: 48, borderRadius: 24, justifyContent: 'center', alignItems: 'center',
    marginRight: SPACING.md, backgroundColor: COLORS.primary,
  },
  avatarText: { color: '#fff', fontSize: FONTS.sizes.xl, fontWeight: FONTS.weights.bold },
  tecnicoInfo: { flex: 1 },
  tecnicoNombre: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  tecnicoStats: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 2 },
  chevron: { fontSize: 24, color: COLORS.textLight },
  areaCard: {
    flexDirection: 'row', backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md, marginBottom: SPACING.sm, ...SHADOWS.sm,
  },
  areaIcono: { fontSize: 28, marginRight: SPACING.md },
  areaInfo: { flex: 1 },
  areaEspecie: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  areaMeta: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 2 },
  areaBeneficiario: { fontSize: FONTS.sizes.xs, color: COLORS.textPrimary, marginTop: 2 },
  areaVereda: { fontSize: FONTS.sizes.xs, color: COLORS.textLight, marginTop: 1 },
  emptyState: { alignItems: 'center', paddingVertical: SPACING.xxl },
  emptyIcon: { fontSize: 48, marginBottom: SPACING.md },
  emptyText: { fontSize: FONTS.sizes.md, color: COLORS.textSecondary, textAlign: 'center' },
});

export default PlantacionesPorTecnicoScreen;
