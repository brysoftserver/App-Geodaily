// ============================================================
// GEODAILY — Proyección de Producción (Gerencia)
// ============================================================

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { BarChart } from 'react-native-chart-kit';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS, API_CONFIG } from '../../theme';
import { Formulario } from '../../types';
import { getFormulariosLocales, getMediciones, getPlantaciones } from '../../services/database';
import { fetchFormulariosDelServidor } from '../../services/formularios.service';
import { useAuth } from '../../store/AuthContext';

type ProyeccionProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
};

const screenWidth = Dimensions.get('window').width;

// Factores de estimación por hectárea (ejemplo cacao)
const ESTIMACION_KG_HA = 800; // kg/ha/año en sistemas tradicionales
const ARBOLES_POR_HA = 1200; // densidad típica cacao

const ProyeccionScreen: React.FC<ProyeccionProps> = ({ navigation: _navigation }) => {
  const { user, isAdmin, isCoordinador, isGerente, isInterventor } = useAuth();
  const canViewAll = isAdmin || isCoordinador || isGerente || isInterventor;
  const [periodo, setPeriodo] = useState<'3m' | '6m' | '12m'>('12m');
  const [formularios, setFormularios] = useState<Formulario[]>([]);
  const [mediciones, setMediciones] = useState<Record<string, any>[]>([]);
  const [plantaciones, setPlantaciones] = useState<Record<string, any>[]>([]);

  // Cargar formularios reales (local + servidor)
  const loadData = useCallback(async () => {
    try {
      const [locales, servidor] = await Promise.all([
        getFormulariosLocales(),
        fetchFormulariosDelServidor(),
      ]);
      const mapa = new Map<string, Formulario>();
      for (const f of locales) mapa.set(f.id, f);
      for (const f of servidor) mapa.set(f.id, f);
      setFormularios(Array.from(mapa.values()));
    } catch (error) {
      console.warn('[Proyeccion] Error cargando formularios:', error);
    }
  }, []);

  // Cargar mediciones y plantaciones reales de terreno (local + servidor).
  // Para roles con visión global se consulta el servidor (ven TODAS); si
  // falla o no hay token, se cae al respaldo local sin romper la pantalla.
  const loadTerreno = useCallback(async () => {
    const token = user?.token;
    // --- Mediciones ---
    try {
      if (canViewAll && token) {
        const res = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.MEDICIONES}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data?.mediciones)) {
            setMediciones(data.mediciones);
          } else {
            setMediciones(await getMediciones());
          }
        } else {
          setMediciones(await getMediciones());
        }
      } else {
        setMediciones(await getMediciones());
      }
    } catch (error) {
      console.warn('[Proyeccion] Error cargando mediciones:', error);
      try { setMediciones(await getMediciones()); } catch { /* ignorar */ }
    }
    // --- Plantaciones ---
    try {
      if (canViewAll && token) {
        const res = await fetch(`${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.PLANTACIONES}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (Array.isArray(data?.plantaciones)) {
            setPlantaciones(data.plantaciones);
          } else {
            setPlantaciones(await getPlantaciones());
          }
        } else {
          setPlantaciones(await getPlantaciones());
        }
      } else {
        setPlantaciones(await getPlantaciones());
      }
    } catch (error) {
      console.warn('[Proyeccion] Error cargando plantaciones:', error);
      try { setPlantaciones(await getPlantaciones()); } catch { /* ignorar */ }
    }
  }, [canViewAll, user?.token]);

  useEffect(() => {
    loadData();
    loadTerreno();
  }, [loadData, loadTerreno]);

  // Área REAL registrada: hectáreas reportadas en el paso sociodemográfico,
  // contando una sola vez a cada beneficiario (por cédula) aunque tenga
  // varias visitas.
  const areaHa = useMemo(() => {
    const porBeneficiario = new Map<string, number>();
    for (const f of formularios) {
      const cedula = f.beneficiario?.cedula;
      const ha = Number(f.sociodemografico?.hectareas);
      if (cedula && ha > 0) porBeneficiario.set(cedula, ha);
    }
    let total = 0;
    porBeneficiario.forEach((ha) => { total += ha; });
    return Math.round(total * 10) / 10;
  }, [formularios]);

  const arbolesEstimados = Math.round(areaHa * ARBOLES_POR_HA);
  const produccionAnualKg = Math.round(areaHa * ESTIMACION_KG_HA);

  // --- Datos REALES de terreno ---
  // Hectáreas medidas con GPS (suma de area_hectareas de las mediciones).
  const hectareasMedidas = useMemo(() => {
    let total = 0;
    for (const m of mediciones) {
      const ha = Number(m.area_hectareas);
      if (Number.isFinite(ha) && ha > 0) total += ha;
    }
    return Math.round(total * 100) / 100;
  }, [mediciones]);

  const totalMediciones = mediciones.length;

  // Plantas sembradas (suma de cantidad) y desglose por especie.
  const { totalPlantas, plantasPorEspecie } = useMemo(() => {
    const porEspecie = new Map<string, number>();
    let total = 0;
    for (const p of plantaciones) {
      const cant = Number(p.cantidad);
      const n = Number.isFinite(cant) && cant > 0 ? cant : 0;
      total += n;
      const especie = (p.especie && String(p.especie).trim()) || 'Desconocida';
      porEspecie.set(especie, (porEspecie.get(especie) || 0) + n);
    }
    const lista = Array.from(porEspecie.entries())
      .map(([especie, cantidad]) => ({ especie, cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad);
    return { totalPlantas: total, plantasPorEspecie: lista };
  }, [plantaciones]);

  // Diferencia entre lo registrado en caracterizaciones y lo medido en campo.
  const diferenciaHa = Math.round((hectareasMedidas - areaHa) * 100) / 100;

  const factorPeriodo = periodo === '3m' ? 0.25 : periodo === '6m' ? 0.5 : 1;
  const produccionPeriodo = Math.round(produccionAnualKg * factorPeriodo);

  // Proyección mensual: estimación anual repartida uniforme entre los meses
  const proyeccionMensual = useMemo(() => {
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const actual = new Date().getMonth();
    const mensual = Math.round(produccionAnualKg / 12);
    const datos: number[] = [];
    const labels: string[] = [];
    for (let i = 0; i < 12; i++) {
      const idx = (actual + i) % 12;
      labels.push(meses[idx]);
      datos.push(mensual);
    }
    return { labels, datos };
  }, [produccionAnualKg]);

  const chartConfig = {
    backgroundColor: COLORS.surface,
    backgroundGradientFrom: COLORS.surface,
    backgroundGradientTo: COLORS.surface,
    decimalPlaces: 0,
    color: (opacity = 1) => `rgba(27, 94, 32, ${opacity})`,
    labelColor: () => COLORS.textSecondary,
    style: { borderRadius: BORDER_RADIUS.md },
    propsForDots: { r: '4', strokeWidth: '2', stroke: COLORS.primary },
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Proyección de Producción</Text>
      <Text style={styles.subtitle}>
        {areaHa > 0
          ? `Estimación basada en ${areaHa} ha reales registradas en las caracterizaciones`
          : 'Aún no hay hectáreas registradas en las caracterizaciones — la proyección se calculará a medida que los técnicos completen formularios'}
      </Text>

      {/* Selector de período */}
      <View style={styles.periodRow}>
        {(['3m', '6m', '12m'] as const).map(p => (
          <TouchableOpacity
            key={p}
            style={[styles.periodBtn, periodo === p && styles.periodBtnActive]}
            onPress={() => setPeriodo(p)}
          >
            <Text style={[styles.periodBtnText, periodo === p && styles.periodBtnTextActive]}>
              {p === '3m' ? '3 meses' : p === '6m' ? '6 meses' : '12 meses'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {/* Tarjetas de estimación */}
      <View style={styles.estimationGrid}>
        <View style={styles.estCard}>
          <Text style={styles.estIcon}>🌱</Text>
          <Text style={styles.estLabel}>Área registrada</Text>
          <Text style={styles.estValor}>{areaHa} ha</Text>
        </View>
        <View style={styles.estCard}>
          <Text style={styles.estIcon}>🌳</Text>
          <Text style={styles.estLabel}>Árboles estimados</Text>
          <Text style={styles.estValor}>{arbolesEstimados.toLocaleString()}</Text>
        </View>
        <View style={styles.estCard}>
          <Text style={styles.estIcon}>📦</Text>
          <Text style={styles.estLabel}>Producción estimada</Text>
          <Text style={styles.estValor}>{produccionPeriodo.toLocaleString()} kg</Text>
        </View>
        <View style={styles.estCard}>
          <Text style={styles.estIcon}>💰</Text>
          <Text style={styles.estLabel}>Ingreso estimado*</Text>
          <Text style={styles.estValor}>${(produccionPeriodo * 12000).toLocaleString()}</Text>
        </View>
      </View>

      <Text style={styles.disclaimer}>* Estimación a $12.000/kg precio referencia cacao</Text>

      {/* ============================================================
          DATOS REALES DE TERRENO (mediciones GPS + plantaciones)
          ============================================================ */}
      <Text style={styles.sectionTitle}>Datos reales de terreno</Text>
      <View style={styles.estimationGrid}>
        <View style={styles.estCard}>
          <Text style={styles.estIcon}>📐</Text>
          <Text style={styles.estLabel}>Hectáreas medidas</Text>
          <Text style={[styles.estValor, { color: COLORS.primary }]}>{hectareasMedidas} ha</Text>
        </View>
        <View style={styles.estCard}>
          <Text style={styles.estIcon}>📍</Text>
          <Text style={styles.estLabel}>Mediciones</Text>
          <Text style={[styles.estValor, { color: COLORS.primary }]}>{totalMediciones}</Text>
        </View>
        <View style={styles.estCard}>
          <Text style={styles.estIcon}>🌱</Text>
          <Text style={styles.estLabel}>Plantas sembradas</Text>
          <Text style={[styles.estValor, { color: COLORS.success }]}>{totalPlantas.toLocaleString()}</Text>
        </View>
        <View style={styles.estCard}>
          <Text style={styles.estIcon}>⚖️</Text>
          <Text style={styles.estLabel}>Diferencia vs registrado</Text>
          <Text style={[styles.estValor, { color: diferenciaHa >= 0 ? COLORS.success : COLORS.error }]}>
            {diferenciaHa >= 0 ? '+' : ''}{diferenciaHa} ha
          </Text>
        </View>
      </View>
      <Text style={styles.disclaimer}>
        Comparación entre el área medida con GPS en terreno ({hectareasMedidas} ha) y el área
        declarada en las caracterizaciones ({areaHa} ha).
      </Text>

      {/* Plantas por especie */}
      {plantasPorEspecie.length > 0 && (
        <View style={styles.infoCard}>
          <Text style={styles.infoTitle}>Plantas sembradas por especie</Text>
          {plantasPorEspecie.map(({ especie, cantidad }) => (
            <View key={especie} style={styles.infoRow}>
              <Text style={styles.infoLabel}>{especie}</Text>
              <Text style={styles.infoValue}>{cantidad.toLocaleString()}</Text>
            </View>
          ))}
          <View style={[styles.infoRow, styles.infoRowTotal]}>
            <Text style={styles.infoLabelTotal}>Total</Text>
            <Text style={styles.infoValueTotal}>{totalPlantas.toLocaleString()}</Text>
          </View>
        </View>
      )}

      {/* Gráfico de proyección */}
      <View style={styles.chartCard}>
        <Text style={styles.chartTitle}>Proyección mensual de producción (kg)</Text>
        <BarChart
          data={{
            labels: proyeccionMensual.labels,
            datasets: [{ data: proyeccionMensual.datos }],
          }}
          width={screenWidth - SPACING.lg * 2}
          height={220}
          chartConfig={{
            ...chartConfig,
            color: (opacity = 1) => `rgba(230, 81, 0, ${opacity})`,
          }}
          yAxisLabel=""
          yAxisSuffix=""
          style={styles.chart}
        />
      </View>

      {/* Métricas de resumen */}
      <View style={styles.infoCard}>
        <Text style={styles.infoTitle}>Factores de estimación</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Densidad de siembra</Text>
          <Text style={styles.infoValue}>{ARBOLES_POR_HA} árboles/ha</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Rendimiento promedio</Text>
          <Text style={styles.infoValue}>{ESTIMACION_KG_HA} kg/ha/año</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Precio referencia</Text>
          <Text style={styles.infoValue}>$12.000/kg</Text>
        </View>
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xl },
  title: { fontSize: FONTS.sizes.xxl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  subtitle: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginBottom: SPACING.md },
  periodRow: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md },
  periodBtn: {
    flex: 1, paddingVertical: SPACING.sm, borderRadius: BORDER_RADIUS.full,
    backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, alignItems: 'center',
  },
  periodBtnActive: { backgroundColor: COLORS.roleGerente, borderColor: COLORS.roleGerente },
  periodBtnText: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },
  periodBtnTextActive: { color: '#fff', fontWeight: FONTS.weights.semibold },
  estimationGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.xs },
  estCard: {
    flex: 1, minWidth: '45%', backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md, alignItems: 'center', ...SHADOWS.sm,
  },
  estIcon: { fontSize: 28, marginBottom: SPACING.xs },
  estLabel: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary },
  estValor: { fontSize: FONTS.sizes.xl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, marginTop: 2 },
  disclaimer: { fontSize: FONTS.sizes.xs, color: COLORS.textLight, marginBottom: SPACING.md, fontStyle: 'italic' },
  sectionTitle: {
    fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary, marginBottom: SPACING.sm,
  },
  chartCard: {
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md, marginBottom: SPACING.md, ...SHADOWS.sm,
  },
  chartTitle: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary, marginBottom: SPACING.md },
  chart: { borderRadius: BORDER_RADIUS.md },
  infoCard: {
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md, padding: SPACING.md, ...SHADOWS.sm,
  },
  infoTitle: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  infoRow: { flexDirection: 'row', justifyContent: 'space-between', paddingVertical: 4 },
  infoLabel: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },
  infoValue: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.medium, color: COLORS.textPrimary },
  infoRowTotal: {
    borderTopWidth: 1, borderTopColor: COLORS.border, marginTop: SPACING.xs, paddingTop: SPACING.sm,
  },
  infoLabelTotal: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  infoValueTotal: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.bold, color: COLORS.primary },
});

export default ProyeccionScreen;
