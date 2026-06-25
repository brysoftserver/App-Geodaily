// ============================================================
// GEODAILY — Dashboard Gerencial
// ============================================================

import React, { useMemo } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LineChart } from 'react-native-chart-kit';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useForm } from '../../store/FormContext';
import MetricCard from '../../components/MetricCard';

type DashboardGerencialProps = {
  navigation: NativeStackNavigationProp<any>;
};

const screenWidth = Dimensions.get('window').width;

const DashboardGerencialScreen: React.FC<DashboardGerencialProps> = ({ navigation }) => {
  const { formularios } = useForm();

  const metrics = useMemo(() => {
    const total = formularios.length;
    const hoy = new Date().toISOString().split('T')[0];
    const visitasHoy = formularios.filter(f => f.created_at.startsWith(hoy)).length;
    const sincronizadas = formularios.filter(f => f.sincronizado).length;
    const pendientes = total - sincronizadas;
    const tecnicosUnicos = new Set(formularios.map(f => f.tecnico.nombre)).size;
    return { total, visitasHoy, sincronizadas, pendientes, tecnicosUnicos };
  }, [formularios]);

  // Datos para gráfico de tendencia
  const chartData = useMemo(() => {
    const dateMap: Record<string, number> = {};
    formularios.forEach(f => {
      const d = f.created_at.split('T')[0];
      dateMap[d] = (dateMap[d] || 0) + 1;
    });
    const sorted = Object.keys(dateMap).sort().slice(-14);
    return {
      labels: sorted.map(d => d.slice(5)),
      values: sorted.map(d => dateMap[d]),
    };
  }, [formularios]);

  const chartConfig = {
    backgroundColor: COLORS.surface,
    backgroundGradientFrom: COLORS.surface,
    backgroundGradientTo: COLORS.surface,
    decimalPlaces: 0,
    color: (opacity = 1) => `rgba(230, 81, 0, ${opacity})`,
    labelColor: () => COLORS.textSecondary,
    style: { borderRadius: BORDER_RADIUS.md },
    propsForDots: { r: '4', strokeWidth: '2', stroke: COLORS.roleGerente },
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Dashboard Gerencial</Text>
      <Text style={styles.subtitle}>Resumen ejecutivo de operaciones</Text>

      {/* Métricas principales */}
      <View style={styles.metricsGrid}>
        <MetricCard titulo="Total Visitas" valor={metrics.total} color={COLORS.primary} />
        <MetricCard titulo="Visitas Hoy" valor={metrics.visitasHoy} color={COLORS.roleGerente} />
        <MetricCard titulo="Sincronizadas" valor={metrics.sincronizadas} color={COLORS.success} />
        <MetricCard titulo="Pendientes" valor={metrics.pendientes} color={COLORS.warning} />
        <MetricCard titulo="Técnicos Activos" valor={metrics.tecnicosUnicos} color={COLORS.roleTecnico} />
      </View>

      {/* Accesos rápidos */}
      <View style={styles.quickActions}>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => navigation.navigate('PerfilTecnicos')}
        >
          <Text style={styles.actionIcon}>👥</Text>
          <Text style={styles.actionText}>Ver Técnicos</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => navigation.navigate('Consolidado')}
        >
          <Text style={styles.actionIcon}>📋</Text>
          <Text style={styles.actionText}>Consolidado</Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.actionBtn}
          onPress={() => navigation.navigate('Proyeccion')}
        >
          <Text style={styles.actionIcon}>📈</Text>
          <Text style={styles.actionText}>Proyección</Text>
        </TouchableOpacity>
      </View>

      {/* Gráfico de tendencia */}
      {chartData.labels.length > 0 && (
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Tendencia de visitas (últimos 14 días)</Text>
          <LineChart
            data={{
              labels: chartData.labels,
              datasets: [{ data: chartData.values.length > 0 ? chartData.values : [0] }],
            }}
            width={screenWidth - SPACING.lg * 2}
            height={220}
            chartConfig={chartConfig}
            bezier
            style={styles.chart}
          />
        </View>
      )}

      {/* Últimas actividades */}
      <View style={styles.recentCard}>
        <Text style={styles.chartTitle}>Últimas visitas registradas</Text>
        {formularios.slice(0, 8).map((form) => (
          <View key={form.id} style={styles.recentItem}>
            <Text style={styles.recentName}>{form.beneficiario.nombre}</Text>
            <Text style={styles.recentMeta}>
              {form.beneficiario.municipio} · {form.tecnico.nombre} ·{' '}
              {form.tipo === 'visita_tecnica' ? 'Visita' : 'Plantación'}
            </Text>
          </View>
        ))}
        {formularios.length === 0 && (
          <Text style={styles.emptyText}>No hay visitas registradas aún.</Text>
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.lg, paddingBottom: SPACING.xl },
  title: { fontSize: FONTS.sizes.xxl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  subtitle: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginBottom: SPACING.md },
  metricsGrid: {
    flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginBottom: SPACING.md,
  },
  quickActions: {
    flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.md,
  },
  actionBtn: {
    flex: 1, backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md, alignItems: 'center', ...SHADOWS.sm,
  },
  actionIcon: { fontSize: 24, marginBottom: 4 },
  actionText: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  chartCard: {
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md, marginBottom: SPACING.md, ...SHADOWS.sm,
  },
  chartTitle: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary, marginBottom: SPACING.md },
  chart: { borderRadius: BORDER_RADIUS.md },
  recentCard: {
    backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md, ...SHADOWS.sm,
  },
  recentItem: {
    paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.divider,
  },
  recentName: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.medium, color: COLORS.textPrimary },
  recentMeta: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 2 },
  emptyText: { fontSize: FONTS.sizes.md, color: COLORS.textLight, textAlign: 'center', paddingVertical: SPACING.lg },
});

export default DashboardGerencialScreen;
