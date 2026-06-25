// ============================================================
// GEODAILY — Proyección de Producción (Gerencia)
// ============================================================

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LineChart, BarChart } from 'react-native-chart-kit';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useForm } from '../../store/FormContext';

type ProyeccionProps = {
  navigation: NativeStackNavigationProp<any>;
};

const screenWidth = Dimensions.get('window').width;

// Factores de estimación por hectárea (ejemplo cacao)
const ESTIMACION_KG_HA = 800; // kg/ha/año en sistemas tradicionales
const ARBOLES_POR_HA = 1200; // densidad típica cacao

const ProyeccionScreen: React.FC<ProyeccionProps> = ({ navigation }) => {
  const { formularios } = useForm();
  const [periodo, setPeriodo] = useState<'3m' | '6m' | '12m'>('12m');

  // Solo formularios de plantación
  const plantaciones = useMemo(() =>
    formularios.filter(f => f.tipo === 'plantacion'),
  [formularios]);

  // Área estimada (asumiendo 1 visita = 1 ha para demo)
  const areaHa = plantaciones.length;
  const arbolesEstimados = areaHa * ARBOLES_POR_HA;
  const produccionAnualKg = areaHa * ESTIMACION_KG_HA;

  const factorPeriodo = periodo === '3m' ? 0.25 : periodo === '6m' ? 0.5 : 1;
  const produccionPeriodo = produccionAnualKg * factorPeriodo;

  // Proyección mensual
  const proyeccionMensual = useMemo(() => {
    const meses = ['Ene','Feb','Mar','Abr','May','Jun','Jul','Ago','Sep','Oct','Nov','Dic'];
    const actual = new Date().getMonth();
    const datos: number[] = [];
    const labels: string[] = [];
    for (let i = 0; i < 12; i++) {
      const idx = (actual + i) % 12;
      labels.push(meses[idx]);
      // Producción con variación estacional simulada
      const estacional = 1 + Math.sin((idx / 12) * Math.PI * 2) * 0.3;
      datos.push(Math.round((ESTIMACION_KG_HA / 12) * areaHa * estacional));
    }
    return { labels, datos };
  }, [areaHa]);

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
      <Text style={styles.subtitle}>Basada en {plantaciones.length} registro(s) de plantación</Text>

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
});

export default ProyeccionScreen;
