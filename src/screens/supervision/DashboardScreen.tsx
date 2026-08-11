// ============================================================
// GEODAILY — Dashboard de Supervisión / Interventoría
// ============================================================

import React, { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, RefreshControl } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS, API_CONFIG } from '../../theme';
import { useForm } from '../../store/FormContext';
import { useAuth } from '../../store/AuthContext';
import { getFormulariosLocales } from '../../services/database';
import { fetchFormulariosDelServidor } from '../../services/formularios.service';
import { Formulario } from '../../types';
import { normalizarVereda } from '../../utils/corregimientos';
import MetricCard from '../../components/MetricCard';
import LoadingSpinner from '../../components/LoadingSpinner';
import MapaVisitasPuertoRico from '../../components/dashboard/MapaVisitasPuertoRico';
import EncuestaSocialResultados from '../../components/dashboard/EncuestaSocialResultados';
import ActividadesRecientes from '../../components/dashboard/ActividadesRecientes';
import BotonPdfDashboard from '../../components/dashboard/BotonPdfDashboard';

type DashboardScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
};

/** Intervalo de refresco silencioso mientras el dashboard está en pantalla (aprox. "tiempo real" sin infraestructura de sockets). */
const INTERVALO_AUTOREFRESH_MS = 30000;

const DashboardScreen: React.FC<DashboardScreenProps> = ({ navigation }) => {
  const { formularios, cargarFormularios } = useForm();
  const { user, isInterventor, isAdmin } = useAuth();
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [refreshingDashboard, setRefreshingDashboard] = useState(false);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  const enFocoRef = useRef(false);

  const detailScreen = isInterventor ? 'InterventorFormularioDetail' : 'SupervisionFormularioDetail';

  // Cargar datos del servidor + local y fusionar en FormContext
  const loadDashboardData = useCallback(async (silencioso = false) => {
    if (!silencioso) setDashboardError(null);
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

      if (!silencioso && fusionados.length === 0) {
        setDashboardError(
          servidorCount === 0 && localesCount === 0
            ? 'No se encontraron formularios en el servidor. Verifica que el backend esté corriendo.'
            : 'No hay formularios disponibles.'
        );
      }
    } catch (error: any) {
      if (!silencioso) {
        console.warn('[Dashboard] Error cargando datos:', error?.message || error);
        setDashboardError(
          `Error de conexión: ${error?.message || 'No se pudo conectar con el servidor'}. Verifica que el backend esté activo en ${API_CONFIG.BASE_URL}`
        );
      }
    } finally {
      setLoadingDashboard(false);
      setRefreshingDashboard(false);
    }
  }, [cargarFormularios]);

  // Cargar al montar
  useEffect(() => {
    loadDashboardData();
  }, [loadDashboardData]);

  // Recargar al enfocar la pantalla + poll silencioso mientras está enfocada
  useFocusEffect(
    useCallback(() => {
      enFocoRef.current = true;
      loadDashboardData();

      const intervalo = setInterval(() => {
        if (enFocoRef.current) loadDashboardData(true);
      }, INTERVALO_AUTOREFRESH_MS);

      return () => {
        enFocoRef.current = false;
        clearInterval(intervalo);
      };
    }, [loadDashboardData])
  );

  const irADetalle = useCallback(
    (formulario: Formulario) => {
      navigation.navigate(detailScreen, { formulario });
    },
    [navigation, detailScreen]
  );

  // --- Tarjetas ---
  const metrics = useMemo(() => {
    const encuestaSocioambiental = formularios.filter((f) => f.tipo === 'caracterizacion').length;
    const visitasTecnicas = formularios.filter((f) => f.tipo === 'visita_tecnica').length;
    const veredasUnicas = new Set(
      formularios.map((f) => normalizarVereda(f.beneficiario?.vereda)).filter((v): v is string => !!v)
    ).size;
    return { encuestaSocioambiental, visitasTecnicas, veredasUnicas };
  }, [formularios]);

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
      <View style={styles.headerRow}>
        <View style={styles.headerTextos}>
          <Text style={styles.title}>Dashboard</Text>
          <Text style={styles.subtitle}>Métricas generales de las visitas a terreno</Text>
        </View>
        <BotonPdfDashboard
          datos={{
            formularios,
            rolUsuario: user?.rol || (isInterventor ? 'interventor' : 'supervisor'),
            nombreUsuario: user?.nombre || 'Usuario',
          }}
        />
      </View>

      {dashboardError && (
        <View style={[styles.chartCard, { borderLeftWidth: 4, borderLeftColor: COLORS.error }]}>
          <Text style={{ fontSize: FONTS.sizes.md, fontWeight: 'bold', color: COLORS.error }}>⚠️ Error</Text>
          <Text style={{ fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 4, lineHeight: 18 }}>
            {dashboardError}
          </Text>
        </View>
      )}

      {/* 1. Mapa interactivo */}
      <MapaVisitasPuertoRico
        formularios={formularios}
        onVerDetalle={irADetalle}
        isAdmin={isAdmin}
        onFormularioEliminado={() => loadDashboardData(true)}
      />

      {/* 2. Tarjetas de métricas */}
      <View style={styles.metricsGrid}>
        <MetricCard
          titulo="Encuesta Social"
          valor={metrics.encuestaSocioambiental}
          color={COLORS.secondary}
          icono="📋"
          subtitulo="Formulario 1"
        />
        <MetricCard
          titulo="Visitas Técnicas"
          valor={metrics.visitasTecnicas}
          color={COLORS.roleTecnico}
          icono="🔧"
          subtitulo="Formulario 2"
        />
        <MetricCard
          titulo="Veredas Visitadas"
          valor={metrics.veredasUnicas}
          color={COLORS.primary}
          icono="🥾"
          subtitulo="Únicas"
        />
      </View>

      {/* 3. Resultados de la Encuesta Social AgroAmbiental (Formulario 1) */}
      <EncuestaSocialResultados formularios={formularios} />

      {/* 4. Últimas actividades (clickeable) */}
      <ActividadesRecientes formularios={formularios} onSeleccionar={irADetalle} />
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
  headerRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerTextos: {
    flex: 1,
    marginRight: SPACING.sm,
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
    marginTop: SPACING.md,
  },
  chartCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginTop: SPACING.md,
    ...SHADOWS.sm,
  },
});

export default DashboardScreen;
