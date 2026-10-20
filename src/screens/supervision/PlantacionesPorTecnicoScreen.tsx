// ============================================================
// GEODAILY — Áreas de Plantación (roles superiores)
// ============================================================
// Navegación en 3 niveles:
//   1. Especies (Cacao / Plátano / Abarco-Cedro-Caucho) con su total
//      plantado en toda la base.
//   2. Al entrar a una especie: listado de técnicos con la cantidad
//      plantada de ESA especie.
//   3. Al entrar a un técnico: sus áreas de plantación de esa especie
//      (especie, cantidad, vereda y beneficiario asociado).
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
import { PLANTAS_OPCIONES, getIconoEspecie } from '../../utils/constants';

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
  /** El backend nunca envía el polígono en sí a roles superiores — solo este indicador. */
  area_trazada?: boolean;
  beneficiario_nombre?: string | null;
  vereda?: string | null;
  corregimiento?: string | null;
}

interface EspecieAgrupada {
  /** Nombre canónico de la especie (tal cual aparece en PLANTAS_OPCIONES). */
  nombre: string;
  icono: string;
  totalPlantas: number;
  totalRegistros: number;
  tecnicos: number;
}

interface TecnicoAgrupado {
  nombre: string;
  areas: PlantacionRow[];
  totalPlantas: number;
  totalAreasTrazadas: number;
}

/**
 * Normaliza el nombre de especie guardado por el técnico al nombre canónico
 * de PLANTAS_OPCIONES. Ej: "Abarco" o "Cedro" → "Abarco / Cedro / Caucho".
 * Si no coincide con ninguna opción conocida, se devuelve el texto original
 * (trim) o 'Desconocida'.
 */
const normalizarEspecie = (especie: string): string => {
  const raw = (especie || '').trim();
  if (!raw) return 'Desconocida';
  const lower = raw.toLowerCase();
  for (const op of PLANTAS_OPCIONES) {
    const canon = op.nombre.toLowerCase();
    if (lower === canon) return op.nombre;
    // Coincidencia por palabra suelta (ej: "Abarco" dentro de "Abarco / Cedro / Caucho")
    const partes = op.nombre.split('/').map((p) => p.trim().toLowerCase());
    if (partes.includes(lower)) return op.nombre;
  }
  return raw;
};

const PlantacionesPorTecnicoScreen: React.FC<PlantacionesPorTecnicoScreenProps> = () => {
  const { plantaciones, fetchAllPlantaciones } = useSyncMapData();
  const [refreshing, setRefreshing] = useState(false);
  const [especieSeleccionada, setEspecieSeleccionada] = useState<string | null>(null);
  const [tecnicoSeleccionado, setTecnicoSeleccionado] = useState<string | null>(null);

  useEffect(() => { fetchAllPlantaciones(); }, [fetchAllPlantaciones]);
  useFocusEffect(useCallback(() => { fetchAllPlantaciones(); }, [fetchAllPlantaciones]));

  // --- Nivel 1: agrupar por especie (siempre las 3 opciones, aunque estén en 0) ---
  const especies = useMemo<EspecieAgrupada[]>(() => {
    const mapa = new Map<string, { totalPlantas: number; totalRegistros: number; tecnicos: Set<string> }>();
    // Inicializar las 3 especies conocidas para que siempre aparezcan
    for (const op of PLANTAS_OPCIONES) {
      mapa.set(op.nombre, { totalPlantas: 0, totalRegistros: 0, tecnicos: new Set() });
    }
    for (const p of plantaciones as PlantacionRow[]) {
      const nombre = normalizarEspecie(p.especie);
      if (!mapa.has(nombre)) {
        mapa.set(nombre, { totalPlantas: 0, totalRegistros: 0, tecnicos: new Set() });
      }
      const entry = mapa.get(nombre)!;
      entry.totalPlantas += p.cantidad || 0;
      entry.totalRegistros += 1;
      entry.tecnicos.add(p.usuario_nombre || 'Desconocido');
    }
    return Array.from(mapa.entries())
      .map(([nombre, v]) => ({
        nombre,
        icono: getIconoEspecie(nombre),
        totalPlantas: v.totalPlantas,
        totalRegistros: v.totalRegistros,
        tecnicos: v.tecnicos.size,
      }))
      .sort((a, b) => b.totalPlantas - a.totalPlantas);
  }, [plantaciones]);

  // --- Nivel 2: técnicos de la especie seleccionada ---
  const tecnicos = useMemo<TecnicoAgrupado[]>(() => {
    if (!especieSeleccionada) return [];
    const mapa = new Map<string, PlantacionRow[]>();
    for (const p of plantaciones as PlantacionRow[]) {
      if (normalizarEspecie(p.especie) !== especieSeleccionada) continue;
      const nombre = p.usuario_nombre || 'Desconocido';
      if (!mapa.has(nombre)) mapa.set(nombre, []);
      mapa.get(nombre)!.push(p);
    }
    return Array.from(mapa.entries())
      .map(([nombre, areas]) => ({
        nombre,
        areas: areas.sort((a, b) => (b.created_at || '').localeCompare(a.created_at || '')),
        totalPlantas: areas.reduce((sum, a) => sum + (a.cantidad || 0), 0),
        totalAreasTrazadas: areas.filter((a) => a.area_trazada).length,
      }))
      .sort((a, b) => b.totalPlantas - a.totalPlantas);
  }, [plantaciones, especieSeleccionada]);

  const especieActual = especies.find((e) => e.nombre === especieSeleccionada);
  const tecnicoActual = tecnicos.find((t) => t.nombre === tecnicoSeleccionado);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await fetchAllPlantaciones();
    setRefreshing(false);
  }, [fetchAllPlantaciones]);

  // ============================================================
  // Nivel 3: áreas de un técnico dentro de la especie seleccionada
  // ============================================================
  if (especieActual && tecnicoActual) {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => setTecnicoSeleccionado(null)} style={styles.backRow}>
          <Text style={styles.backArrow}>‹ Volver a técnicos</Text>
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={styles.tecnicoNombre}>
            {especieActual.icono} {tecnicoActual.nombre}
          </Text>
          <Text style={styles.tecnicoStats}>
            {tecnicoActual.areas.length} área(s) · {tecnicoActual.totalPlantas} plantas de {especieActual.nombre} · {tecnicoActual.totalAreasTrazadas} con polígono
          </Text>
        </View>

        <FlatList
          data={tecnicoActual.areas}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} tintColor={COLORS.primary} />}
          renderItem={({ item }) => (
            <View style={styles.areaCard}>
              <Text style={styles.areaIcono}>{item.icono || getIconoEspecie(item.especie)}</Text>
              <View style={styles.areaInfo}>
                <Text style={styles.areaEspecie}>{item.cantidad}x {item.especie}</Text>
                <Text style={styles.areaMeta}>
                  {item.area_trazada ? '◈ Área trazada' : '📍 Punto'}
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
              <Text style={styles.emptyText}>Este técnico no tiene áreas de esta especie.</Text>
            </View>
          }
        />
      </View>
    );
  }

  // ============================================================
  // Nivel 2: técnicos de la especie seleccionada
  // ============================================================
  if (especieActual) {
    return (
      <View style={styles.container}>
        <TouchableOpacity onPress={() => setEspecieSeleccionada(null)} style={styles.backRow}>
          <Text style={styles.backArrow}>‹ Volver a especies</Text>
        </TouchableOpacity>

        <View style={styles.header}>
          <Text style={styles.tecnicoNombre}>
            {especieActual.icono} {especieActual.nombre}
          </Text>
          <Text style={styles.tecnicoStats}>
            {especieActual.totalPlantas.toLocaleString()} plantas · {especieActual.tecnicos} técnico(s)
          </Text>
        </View>

        <FlatList
          data={tecnicos}
          keyExtractor={(item) => item.nombre}
          contentContainerStyle={styles.listContent}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} tintColor={COLORS.primary} />}
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
                  {item.totalPlantas.toLocaleString()} plantas · {item.areas.length} área(s)
                </Text>
              </View>
              <Text style={styles.chevron}>›</Text>
            </TouchableOpacity>
          )}
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>🌱</Text>
              <Text style={styles.emptyText}>Ningún técnico ha plantado {especieActual.nombre} todavía.</Text>
            </View>
          }
        />
      </View>
    );
  }

  // ============================================================
  // Nivel 1: especies con su total plantado
  // ============================================================
  return (
    <View style={styles.container}>
      <FlatList
        data={especies}
        keyExtractor={(item) => item.nombre}
        contentContainerStyle={styles.listContent}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} tintColor={COLORS.primary} />}
        ListHeaderComponent={
          <>
            <Text style={styles.title}>Áreas de Plantación</Text>
            <Text style={styles.subtitle}>Toca una especie para ver los técnicos y sus cantidades</Text>
          </>
        }
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.especieCard}
            onPress={() => setEspecieSeleccionada(item.nombre)}
            activeOpacity={0.7}
          >
            <Text style={styles.especieIcono}>{item.icono}</Text>
            <View style={styles.especieInfo}>
              <Text style={styles.especieNombre}>{item.nombre}</Text>
              <Text style={styles.especieStats}>
                {item.totalPlantas.toLocaleString()} plantas · {item.tecnicos} técnico(s) · {item.totalRegistros} registro(s)
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
  // Tarjeta de especie (nivel 1)
  especieCard: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm, ...SHADOWS.md,
  },
  especieIcono: { fontSize: 36, marginRight: SPACING.md },
  especieInfo: { flex: 1 },
  especieNombre: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  especieStats: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 2 },
  // Tarjeta de técnico (nivel 2)
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
