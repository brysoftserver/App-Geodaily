// ============================================================
// GEODAILY — Dashboard de Supervisión
// ============================================================

import React, { useMemo, useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  Dimensions,
  RefreshControl,
  Platform,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { LineChart, BarChart } from 'react-native-chart-kit';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS, API_CONFIG } from '../../theme';
import { useForm } from '../../store/FormContext';
import { getFormulariosLocales } from '../../services/database';
import { fetchFormulariosDelServidor } from '../../services/formularios.service';
import MetricCard from '../../components/MetricCard';
import FilterBar from '../../components/FilterBar';
import LoadingSpinner from '../../components/LoadingSpinner';

type DashboardScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
};

const FILTER_OPTIONS = [
  { value: 'all', label: 'Todo' },
  { value: 'visita_tecnica', label: 'Visitas' },
];

const screenWidth = Dimensions.get('window').width;

const DashboardScreen: React.FC<DashboardScreenProps> = ({ navigation: _navigation }) => {
  const { formularios, cargarFormularios } = useForm();
  const [filter, setFilter] = useState('all');
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [refreshingDashboard, setRefreshingDashboard] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);

  // Cargar datos del servidor + local y fusionar en FormContext
  const loadDashboardData = useCallback(async () => {
    setDashboardError(null);
    let servidorCount = 0;
    let localesCount = 0;
    try {
      const [locales, servidor] = await Promise.all([
        getFormulariosLocales(),
        fetchFormulariosDelServidor(),
      ]);
      localesCount = locales.length;
      servidorCount = servidor.length;

      const mapa = new Map<string, any>();
      for (const f of locales) mapa.set(f.id, f);
      for (const f of servidor) mapa.set(f.id, { ...f, sincronizado: true });

      const fusionados = Array.from(mapa.values());
      cargarFormularios(fusionados);
      console.log(`[Dashboard] ${fusionados.length} formularios (${localesCount} locales + ${servidorCount} servidor)`);

      if (fusionados.length === 0) {
        setDashboardError(
          servidorCount === 0 && localesCount === 0
            ? 'No se encontraron formularios en el servidor. Verifica que el backend esté corriendo.'
            : 'No hay formularios disponibles.'
        );
      }
    } catch (error: any) {
      console.warn('[Dashboard] Error cargando datos:', error?.message || error);
      setDashboardError(
        `Error de conexión: ${error?.message || 'No se pudo conectar con el servidor'}. Verifica que el backend esté activo en ${API_CONFIG.BASE_URL}`
      );
    } finally {
      setLoadingDashboard(false);
      setRefreshingDashboard(false);
    }
  }, [cargarFormularios]);

  // Cargar al montar
  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // Recargar al enfocar la pantalla
  useFocusEffect(
    useCallback(() => {
      loadDashboardData();
    }, [loadDashboardData])
  );

  const filteredForms = useMemo(() => {
    if (filter === 'all') return formularios;
    return formularios.filter((f) => f.tipo === filter);
  }, [formularios, filter]);

  const metrics = useMemo(() => {
    const total = filteredForms.length;
    const tecnicas = filteredForms.filter((f) => f.tipo === 'visita_tecnica').length;
    const sincronizadas = filteredForms.filter((f) => f.sincronizado).length;
    const pendientes = total - sincronizadas;

    return { total, tecnicas, sincronizadas, pendientes };
  }, [filteredForms]);

  // Agrupar por fecha para el gráfico (con protección null)
  const chartData = useMemo(() => {
    const dateMap: Record<string, { visitas: number }> = {};

    filteredForms.forEach((f) => {
      if (!f) return;
      const date = (f.created_at || '').split('T')[0];
      if (!date) return;
      if (!dateMap[date]) {
        dateMap[date] = { visitas: 0 };
      }
      if (f.tipo === 'visita_tecnica') {
        dateMap[date].visitas++;
      }
    });

    const sortedDates = Object.keys(dateMap).sort().slice(-7); // últimas 7 fechas
    return {
      labels: sortedDates.map((d) => d.slice(5)), // MM-DD
      visitas: sortedDates.map((d) => dateMap[d]?.visitas || 0),
    };
  }, [filteredForms]);

  // Distribución por municipio (con protección null)
  const municipioData = useMemo(() => {
    const map: Record<string, number> = {};
    filteredForms.forEach((f) => {
      if (!f?.beneficiario) return;
      const m = f.beneficiario.municipio || 'Desconocido';
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

  if (loadingDashboard && formularios.length === 0) {
    return <LoadingSpinner message="Cargando dashboard..." fullScreen />;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshingDashboard}
          onRefresh={() => {
            setRefreshingDashboard(true);
            loadDashboardData();
          }}
          colors={[COLORS.primary]}
          tintColor={COLORS.primary}
        />
      }
    >
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

      {/* Mensaje de error */}
      {dashboardError && (
        <View style={[styles.chartCard, { borderLeftWidth: 4, borderLeftColor: COLORS.error }]}>
          <Text style={{ fontSize: FONTS.sizes.md, fontWeight: 'bold', color: COLORS.error }}>⚠️ Error</Text>
          <Text style={{ fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 4, lineHeight: 18 }}>
            {dashboardError}
          </Text>
        </View>
      )}

      {/* Mensaje si no hay datos */}
      {metrics.total === 0 && !loadingDashboard && (
        <View style={styles.chartCard}>
          <Text style={styles.chartTitle}>📭 Sin datos</Text>
          <Text style={styles.chartSubtitle}>
            No hay formularios disponibles. Usa el menú &ldquo;Listado de técnicos y visitas&rdquo; para verificar la conexión con el servidor.
          </Text>
        </View>
      )}

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
              ],
              legend: ['Visitas Técnicas'],
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
            <Text style={styles.recentName}>{form.beneficiario?.nombre || '—'}</Text>
            <Text style={styles.recentMeta}>
              {form.beneficiario?.municipio || '—'} ·{' '}
              {form.tipo === 'visita_tecnica' ? 'Visita' : form.tipo === 'caracterizacion' ? 'Caracterización' : 'Plantación'}
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
    paddingBottom: SPACING.xxl,
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
  chartSubtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: SPACING.sm,
    lineHeight: 20,
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
