// ============================================================
// GEODAILY — Dashboard de Supervisión
// ============================================================

import React, { useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { LineChart, BarChart } from 'react-native-chart-kit';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useForm } from '../../store/FormContext';
import MetricCard from '../../components/MetricCard';
import FilterBar from '../../components/FilterBar';

type DashboardScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

const FILTER_OPTIONS = [
  { value: 'all', label: 'Todo' },
  { value: 'visita_tecnica', label: 'Visitas' },
  { value: 'plantacion', label: 'Plantación' },
];

const screenWidth = Dimensions.get('window').width;

const DashboardScreen: React.FC<DashboardScreenProps> = ({ navigation }) => {
  const { formularios } = useForm();
  const [filter, setFilter] = useState('all');

  const filteredForms = useMemo(() => {
    if (filter === 'all') return formularios;
    return formularios.filter((f) => f.tipo === filter);
  }, [formularios, filter]);

  const metrics = useMemo(() => {
    const total = filteredForms.length;
    const tecnicas = filteredForms.filter((f) => f.tipo === 'visita_tecnica').length;
    const plantaciones = filteredForms.filter((f) => f.tipo === 'plantacion').length;
    const sincronizadas = filteredForms.filter((f) => f.sincronizado).length;
    const pendientes = total - sincronizadas;

    return { total, tecnicas, plantaciones, sincronizadas, pendientes };
  }, [filteredForms]);

  // Agrupar por fecha para el gráfico
  const chartData = useMemo(() => {
    const dateMap: Record<string, { visitas: number; plantaciones: number }> = {};

    filteredForms.forEach((f) => {
      const date = f.created_at.split('T')[0];
      if (!dateMap[date]) {
        dateMap[date] = { visitas: 0, plantaciones: 0 };
      }
      if (f.tipo === 'visita_tecnica') {
        dateMap[date].visitas++;
      } else {
        dateMap[date].plantaciones++;
      }
    });

    const sortedDates = Object.keys(dateMap).sort().slice(-7); // últimas 7 fechas
    return {
      labels: sortedDates.map((d) => d.slice(5)), // MM-DD
      visitas: sortedDates.map((d) => dateMap[d].visitas),
      plantaciones: sortedDates.map((d) => dateMap[d].plantaciones),
    };
  }, [filteredForms]);

  // Distribución por municipio
  const municipioData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredForms.forEach((f) => {
      const m = f.beneficiario.municipio;
      map[m] = (map[m] || 0) + 1;
    });
    return Object.entries(map)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5);
  }, [filteredForms]);

  const chartConfig = {
    backgroundColor: COLORS.surface,
    backgroundGradientFrom: COLORS.surface,
    backgroundGradientTo: COLORS.surface,
    decimalPlaces: 0,
    color: (opacity = 1) => `rgba(27, 94, 32, ${opacity})`,
    labelColor: () => COLORS.textSecondary,
    style: { borderRadius: BORDER_RADIUS.md },
    propsForDots: { r: '5', strokeWidth: '2', stroke: COLORS.primary },
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Dashboard</Text>
      <Text style={styles.subtitle}>Métricas generales de las visitas a terreno</Text>

      <FilterBar options={FILTER_OPTIONS} selected={filter} onSelect={(v) => v && setFilter(v)} />

      {/* Tarjetas de métricas */}
      <View style={styles.metricsGrid}>
        <MetricCard
          titulo="Total Visitas"
          valor={metrics.total}
          color={COLORS.info}
          icono="📊"
        />
        <MetricCard
          titulo="Visitas Técnicas"
          valor={metrics.tecnicas}
          color={COLORS.roleTecnico}
          icono="🔧"
        />
        <MetricCard
          titulo="Plantaciones"
          valor={metrics.plantaciones}
          color={COLORS.primary}
          icono="🌱"
        />
        <MetricCard
          titulo="Sincronizadas"
          valor={metrics.sincronizadas}
          color={COLORS.success}
          icono="☁️"
        />
        <MetricCard
          titulo="Pendientes"
          valor={metrics.pendientes}
          color={COLORS.warning}
          icono="⏳"
        />
        <MetricCard
          titulo="Municipios"
          valor={municipioData.length}
          color={COLORS.secondary}
          icono="📍"
        />
      </View>

      {/* Gráfico de tendencia */}
      {chartData.labels.length > 0 && (
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Tendencia de visitas (últimos días)</Text>
          <LineChart
            data={{
              labels: chartData.labels,
              datasets: [
                {
                  data: chartData.visitas.length > 0
                    ? chartData.visitas
                    : [0],
                  color: (opacity) => `rgba(27, 94, 32, ${opacity})`,
                  strokeWidth: 2,
                },
                {
                  data: chartData.plantaciones.length > 0
                    ? chartData.plantaciones
                    : [0],
                  color: (opacity) => `rgba(249, 168, 37, ${opacity})`,
                  strokeWidth: 2,
                },
              ],
              legend: ['Visitas Técnicas', 'Plantaciones'],
            }}
            width={screenWidth - SPACING.lg * 2}
            height={220}
            chartConfig={chartConfig}
            bezier
            style={styles.chart}
          />
        </View>
      )}

      {/* Distribución por municipio */}
      {municipioData.length > 0 && (
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>Distribución por Municipio</Text>
          <BarChart
            data={{
              labels: municipioData.map(([name]) => name.slice(0, 6)),
              datasets: [{ data: municipioData.map(([, count]) => count) }],
            }}
            width={screenWidth - SPACING.lg * 2}
            height={220}
            chartConfig={{
              ...chartConfig,
              color: (opacity = 1) => `rgba(249, 168, 37, ${opacity})`,
            }}
            yAxisLabel=""
            yAxisSuffix=""
            style={styles.chart}
          />
        </View>
      )}

      {/* Últimas actividades */}
      <View style={styles.recentCard}>
        <Text style={styles.chartTitle}>Últimas actividades</Text>
        {filteredForms.slice(0, 5).map((form) => (
          <View key={form.id} style={styles.recentItem}>
            <Text style={styles.recentName}>{form.beneficiario.nombre}</Text>
            <Text style={styles.recentMeta}>
              {form.beneficiario.municipio} ·{' '}
              {form.tipo === 'visita_tecnica' ? 'Visita' : 'Plantación'}
            </Text>
          </View>
        ))}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.lg,
  },
  title: {
    fontSize: FONTS.sizes.xxl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.md,
  },
  metricsGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginHorizontal: -SPACING.xs,
    marginTop: SPACING.sm,
  },
  chartCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.md,
    ...SHADOWS.sm,
  },
  chartTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.md,
  },
  chart: {
    borderRadius: BORDER_RADIUS.md,
  },
  recentCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.md,
    ...SHADOWS.sm,
  },
  recentItem: {
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  recentName: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  recentMeta: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
});

export default DashboardScreen;
