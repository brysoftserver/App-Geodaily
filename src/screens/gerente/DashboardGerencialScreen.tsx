// ============================================================
// GEODAILY — Dashboard Gerencial
// ============================================================

import React, { useMemo, useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  RefreshControl,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { LineChart } from 'react-native-chart-kit';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS, API_CONFIG } from '../../theme';
import { useForm } from '../../store/FormContext';
import { getFormulariosLocales } from '../../services/database';
import { fetchFormulariosDelServidor } from '../../services/formularios.service';
import MetricCard from '../../components/MetricCard';
import LoadingSpinner from '../../components/LoadingSpinner';

type DashboardGerencialProps = {
  navigation: NativeStackNavigationProp<any>;
};

const screenWidth = Dimensions.get('window').width;

const DashboardGerencialScreen: React.FC<DashboardGerencialProps> = ({ navigation }) => {
  const { formularios, cargarFormularios } = useForm();
  const [loadingGerencial, setLoadingGerencial] = useState(true);
  const [refreshingGerencial, setRefreshingGerencial] = useState(false);
  const [gerencialError, setGerencialError] = useState<string | null>(null);

  // Cargar datos del servidor + local
  const loadGerencialData = useCallback(async () => {
    setGerencialError(null);
    try {
      const [locales, servidor] = await Promise.all([
        getFormulariosLocales(),
        fetchFormulariosDelServidor(),
      ]);
      const mapa = new Map<string, any>();
      for (const f of locales) mapa.set(f.id, f);
      for (const f of servidor) mapa.set(f.id, { ...f, sincronizado: true });
      const fusionados = Array.from(mapa.values());
      cargarFormularios(fusionados);
      console.log(`[DashboardGerencial] ${fusionados.length} formularios (${locales.length} locales + ${servidor.length} servidor)`);
      if (fusionados.length === 0) {
        setGerencialError(
          servidor.length === 0 && locales.length === 0
            ? 'No se encontraron formularios. Verifica que el backend esté activo.'
            : 'No hay formularios disponibles.'
        );
      }
    } catch (error: any) {
      console.warn('[DashboardGerencial] Error:', error?.message || error);
      setGerencialError(`Error de conexión: verifica que el backend esté activo en ${API_CONFIG.BASE_URL}`);
    } finally {
      setLoadingGerencial(false);
      setRefreshingGerencial(false);
    }
  }, [cargarFormularios]);

  useEffect(() => { loadGerencialData(); }, [loadGerencialData]);
  useFocusEffect(useCallback(() => { loadGerencialData(); }, [loadGerencialData]));

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

  if (loadingGerencial && formularios.length === 0) {
    return <LoadingSpinner message="Cargando dashboard gerencial..." fullScreen />;
  }

  return (
    <ScrollView
      style={styles.container}
      contentContainerStyle={styles.content}
      refreshControl={
        <RefreshControl
          refreshing={refreshingGerencial}
          onRefresh={() => { setRefreshingGerencial(true); loadGerencialData(); }}
          colors={[COLORS.roleGerente]}
          tintColor={COLORS.roleGerente}
        />
      }
    >
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

      {/* Mensaje de error */}
      {gerencialError && (
        <View style={[styles.chartCard, { borderLeftWidth: 4, borderLeftColor: COLORS.error }]}>
          <Text style={{ fontSize: FONTS.sizes.md, fontWeight: 'bold', color: COLORS.error }}>⚠️ Error</Text>
          <Text style={{ fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 4, lineHeight: 18 }}>
            {gerencialError}
          </Text>
        </View>
      )}

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
              {form.tipo === 'visita_tecnica' ? 'Visita' : form.tipo === 'caracterizacion' ? 'Caracterización' : 'Plantación'}
            </Text>
          </View>
        ))}
        {formularios.length === 0 && !loadingGerencial && (
          <View style={{ alignItems: 'center', paddingVertical: 24 }}>
            <Text style={{ fontSize: 48, marginBottom: 12 }}>📭</Text>
            <Text style={styles.emptyText}>
              No hay formularios disponibles.{'\n'}Tira hacia abajo para refrescar o verifica la conexión con el servidor.
            </Text>
          </View>
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
