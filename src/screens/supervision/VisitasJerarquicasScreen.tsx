// ============================================================
// GEODAILY — Visitas Jerárquicas (Técnicos → Beneficiarios → Visitas)
// ============================================================
// Estructura de 3 niveles:
//   Nivel 1: Lista de técnicos
//   Nivel 2: Beneficiarios de ese técnico
//   Nivel 3: Visitas numeradas del beneficiario (Visita 1…N)
//   Nivel 4: Detalle del formulario + ver/descargar PDF
// ============================================================

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  BackHandler,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { Formulario } from '../../types';
import { getFormulariosLocales } from '../../services/database';
import { fetchFormulariosDelServidor } from '../../services/formularios.service';
import LoadingSpinner from '../../components/LoadingSpinner';

type VisitasJerarquicasScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

// --- Tipos auxiliares ---
interface TecnicoAgrupado {
  id: string;
  nombre: string;
  cedula: string;
  telefono: string;
  email: string;
  totalVisitas: number;
  totalBeneficiarios: number;
  beneficiarios: BeneficiarioAgrupado[];
}

interface BeneficiarioAgrupado {
  nombre: string;
  cedula: string;
  telefono: string;
  municipio: string;
  vereda: string;
  finca: string;
  visitas: Formulario[];
}

type Nivel = 'tecnicos' | 'beneficiarios' | 'visitas';

const VisitasJerarquicasScreen: React.FC<VisitasJerarquicasScreenProps> = ({ navigation }) => {
  const [formularios, setFormularios] = useState<Formulario[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Estado de navegación jerárquica
  const [nivel, setNivel] = useState<Nivel>('tecnicos');
  const [tecnicoSeleccionado, setTecnicoSeleccionado] = useState<TecnicoAgrupado | null>(null);
  const [beneficiarioSeleccionado, setBeneficiarioSeleccionado] = useState<BeneficiarioAgrupado | null>(null);

  // --- Agrupar datos ---
  const tecnicos = useMemo(() => {
    const mapa = new Map<string, TecnicoAgrupado>();

    for (const form of formularios) {
      const tec = form.tecnico;
      if (!tec) continue; // evitar crash si el técnico es null/undefined
      const key = tec.nombre || tec.cedula;
      if (!key) continue;

      if (!mapa.has(key)) {
        mapa.set(key, {
          id: tec.cedula || tec.nombre,
          nombre: tec.nombre,
          cedula: tec.cedula || '',
          telefono: tec.telefono || '',
          email: tec.email || '',
          totalVisitas: 0,
          totalBeneficiarios: 0,
          beneficiarios: [],
        });
      }

      const grupo = mapa.get(key)!;
      // Si este form tiene cédula pero el grupo no, actualizarla
      if (tec.cedula && !grupo.cedula) {
        grupo.cedula = tec.cedula;
      }
      grupo.totalVisitas++;

      // Agrupar beneficiarios dentro del técnico
      const benef = form.beneficiario;
      if (!benef) continue; // evitar crash si el beneficiario es null/undefined
      const benefKey = benef.nombre || benef.cedula;
      let benefGrupo = grupo.beneficiarios.find(
        (b) => (b.nombre || b.cedula) === benefKey
      );
      if (!benefGrupo) {
        benefGrupo = {
          nombre: benef.nombre,
          cedula: benef.cedula || '',
          telefono: benef.telefono || '',
          municipio: benef.municipio || '',
          vereda: benef.vereda || '',
          finca: benef.finca || '',
          visitas: [],
        };
        grupo.beneficiarios.push(benefGrupo);
      }
      benefGrupo.visitas.push(form);
    }

    // Ordenar: técnicos por nombre, beneficiarios por nombre, visitas por fecha
    for (const tec of mapa.values()) {
      tec.totalBeneficiarios = tec.beneficiarios.length;
      tec.beneficiarios.sort((a, b) => a.nombre.localeCompare(b.nombre));
      for (const benef of tec.beneficiarios) {
        benef.visitas.sort(
          (a, b) => new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );
      }
    }

    return Array.from(mapa.values()).sort((a, b) => a.nombre.localeCompare(b.nombre));
  }, [formularios]);

  // --- Cargar datos (servidor + local) ---
  const loadData = useCallback(async () => {
    setLoadError(null);
    let localesCount = 0;
    let servidorCount = 0;
    try {
      // Cargar en paralelo: local + servidor
      const [locales, servidor] = await Promise.all([
        getFormulariosLocales(),
        fetchFormulariosDelServidor(),
      ]);
      localesCount = locales.length;
      servidorCount = servidor.length;

      // Fusionar: servidor tiene los datos más completos,
      // locales tienen lo que aún no se ha sincronizado
      const mapaFusion = new Map<string, Formulario>();

      // Primero insertar locales (en caso de que haya datos no sincronizados)
      for (const f of locales) {
        mapaFusion.set(f.id, f);
      }

      // Luego insertar/sobrescribir con datos del servidor
      for (const f of servidor) {
        mapaFusion.set(f.id, { ...f, sincronizado: true });
      }

      const fusionados = Array.from(mapaFusion.values());
      console.log(
        `[VisitasJerarquicas] ${fusionados.length} formularios: ${localesCount} locales + ${servidorCount} servidor`
      );

      if (fusionados.length === 0) {
        setLoadError(
          servidorCount === 0 && localesCount === 0
            ? 'No se encontraron formularios en el servidor. Verifica que el backend esté activo.'
            : 'No hay formularios disponibles.'
        );
      }

      setFormularios(fusionados);
    } catch (error: any) {
      console.warn('[VisitasJerarquicas] Error cargando:', error?.message || error);
      setLoadError(`Error de conexión: ${error?.message || 'No se pudo conectar con el servidor'}`);
      // Fallback: solo locales
      try {
        const locales = await getFormulariosLocales();
        setFormularios(locales);
        if (locales.length === 0) {
          setLoadError(`Error de conexión — no se pudieron cargar los datos del servidor. Verifica que el backend esté activo.`);
        }
      } catch {
        setLoadError('Error al cargar los datos. Intenta de nuevo más tarde.');
      }
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, []);

  // Cargar al montar y recargar cada vez que la pantalla obtiene foco
  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  // Interceptar botón físico/gesto de atrás para navegación jerárquica interna
  useEffect(() => {
    const onBackPress = () => {
      if (nivel === 'beneficiarios') {
        volverATecnicos();
        return true; // prevenir salida
      }
      if (nivel === 'visitas') {
        volverABeneficiarios();
        return true; // prevenir salida
      }
      return false; // salir de la pantalla
    };

    const backHandler = BackHandler.addEventListener('hardwareBackPress', onBackPress);
    return () => backHandler.remove();
  }, [nivel]);

  // Interceptar gesto/swipe de navegación (iOS) para subir nivel jerárquico
  useEffect(() => {
    const unsubscribe = navigation.addListener('beforeRemove', (e) => {
      if (nivel === 'tecnicos') return; // dejar salir
      e.preventDefault(); // prevenir salida
      // Subir un nivel
      if (nivel === 'visitas') volverABeneficiarios();
      else if (nivel === 'beneficiarios') volverATecnicos();
    });
    return unsubscribe;
  }, [navigation, nivel]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // --- Navegación entre niveles ---
  const seleccionarTecnico = (tec: TecnicoAgrupado) => {
    setTecnicoSeleccionado(tec);
    setNivel('beneficiarios');
  };

  const seleccionarBeneficiario = (benef: BeneficiarioAgrupado) => {
    setBeneficiarioSeleccionado(benef);
    setNivel('visitas');
  };

  const volverATecnicos = () => {
    setNivel('tecnicos');
    setTecnicoSeleccionado(null);
    setBeneficiarioSeleccionado(null);
  };

  const volverABeneficiarios = () => {
    setNivel('beneficiarios');
    setBeneficiarioSeleccionado(null);
  };

  const abrirDetalleFormulario = (form: Formulario) => {
    // Detectar qué navegador está usando esta pantalla
    const state = navigation.getState();
    const currentRoute = state?.routes?.[state.index];
    const isInterventor = currentRoute?.name?.startsWith('Interventor');
    const detailScreen = isInterventor ? 'InterventorFormularioDetail' : 'SupervisionFormularioDetail';
    navigation.navigate(detailScreen, { formulario: form });
  };

  // --- Render por nivel ---

  const renderBreadcrumb = () => (
    <View style={styles.breadcrumb}>
      <TouchableOpacity onPress={volverATecnicos} style={styles.breadcrumbItem}>
        <Text style={[styles.breadcrumbText, nivel === 'tecnicos' && styles.breadcrumbActive]}>
          Técnicos
        </Text>
      </TouchableOpacity>
      {nivel !== 'tecnicos' && (
        <>
          <Text style={styles.breadcrumbSep}>›</Text>
          <TouchableOpacity onPress={volverABeneficiarios} style={styles.breadcrumbItem}>
            <Text style={[styles.breadcrumbText, nivel === 'beneficiarios' && styles.breadcrumbActive]}>
              {tecnicoSeleccionado?.nombre || 'Beneficiarios'}
            </Text>
          </TouchableOpacity>
        </>
      )}
      {nivel === 'visitas' && (
        <>
          <Text style={styles.breadcrumbSep}>›</Text>
          <TouchableOpacity style={styles.breadcrumbItem}>
            <Text style={[styles.breadcrumbText, styles.breadcrumbActive]}>
              {beneficiarioSeleccionado?.nombre}
            </Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  // --- Nivel 1: Técnicos ---
  const renderTecnico = ({ item }: { item: TecnicoAgrupado }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => seleccionarTecnico(item)}
      activeOpacity={0.7}
    >
      <View style={styles.cardRow}>
        <View style={[styles.avatarChip, { backgroundColor: COLORS.roleTecnico + '20' }]}>
          <Text style={[styles.avatarLetter, { color: COLORS.roleTecnico }]}>
            {item.nombre.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle}>{item.nombre}</Text>
          <Text style={styles.cardSubtitle}>
            📍 {item.cedula || 'Sin cédula'} {item.telefono ? `· ${item.telefono}` : ''}
          </Text>
        </View>
        <View style={styles.badgeContainer}>
          <View style={styles.badge}>
            <Text style={styles.badgeNumber}>{item.totalVisitas}</Text>
            <Text style={styles.badgeLabel}>Visitas</Text>
          </View>
          <View style={[styles.badge, styles.badgeSecondary]}>
            <Text style={[styles.badgeNumber, { color: COLORS.roleSupervisor }]}>
              {item.totalBeneficiarios}
            </Text>
            <Text style={styles.badgeLabel}>Benef.</Text>
          </View>
        </View>
        <Text style={styles.chevron}>›</Text>
      </View>
    </TouchableOpacity>
  );

  // --- Nivel 2: Beneficiarios ---
  const renderBeneficiario = ({ item }: { item: BeneficiarioAgrupado }) => (
    <TouchableOpacity
      style={styles.card}
      onPress={() => seleccionarBeneficiario(item)}
      activeOpacity={0.7}
    >
      <View style={styles.cardRow}>
        <View style={[styles.avatarChip, { backgroundColor: COLORS.secondary + '20' }]}>
          <Text style={[styles.avatarLetter, { color: COLORS.secondaryDark }]}>
            {item.nombre.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle}>{item.nombre}</Text>
          <Text style={styles.cardSubtitle}>
            📍 {item.vereda}, {item.municipio} {item.finca ? `· ${item.finca}` : ''}
          </Text>
        </View>
        <View style={styles.badgeContainer}>
          <View style={styles.badge}>
            <Text style={styles.badgeNumber}>{item.visitas.length}</Text>
            <Text style={styles.badgeLabel}>Visitas</Text>
          </View>
        </View>
        <Text style={styles.chevron}>›</Text>
      </View>
    </TouchableOpacity>
  );

  // --- Nivel 3: Visitas ---
  const renderVisita = ({ item, index }: { item: Formulario; index: number }) => (
    <TouchableOpacity
      style={styles.visitaCard}
      onPress={() => abrirDetalleFormulario(item)}
      activeOpacity={0.7}
    >
      <View style={styles.visitaHeader}>
        <View style={styles.visitaNumero}>
          <Text style={styles.visitaNumeroText}>Visita {index + 1}</Text>
        </View>
        <Text style={styles.visitaFecha}>
          {new Date(item.created_at).toLocaleDateString('es-CO', {
            day: 'numeric',
            month: 'long',
            year: 'numeric',
          })}
        </Text>
      </View>

      <View style={styles.visitaBody}>
        <View style={styles.visitaTag}>
          <Text style={styles.visitaTagText}>
            {item.tipo === 'caracterizacion' ? '📋 Caracterización'
              : item.tipo === 'visita_tecnica' ? '🔧 Visita Técnica'
              : '🌱 Plantación'}
          </Text>
        </View>
        {item.actividad?.descripcion ? (
          <Text style={styles.visitaDesc} numberOfLines={2}>
            {item.actividad.descripcion}
          </Text>
        ) : null}
      </View>

      <View style={styles.visitaFooter}>
        <View style={styles.statusIndicator}>
          <View
            style={[
              styles.statusDot,
              { backgroundColor: item.sincronizado ? COLORS.success : COLORS.warning },
            ]}
          />
          <Text style={styles.statusText}>
            {item.sincronizado ? 'Sincronizado' : 'Pendiente'}
          </Text>
        </View>
        <View style={styles.visitaActions}>
          <TouchableOpacity
            style={styles.actionBtn}
            onPress={() => abrirDetalleFormulario(item)}
          >
            <Text style={styles.actionBtnText}>👁️ Ver</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.actionBtn, styles.actionBtnPDF]}
            onPress={() => abrirDetalleFormulario(item)}
          >
            <Text style={styles.actionBtnTextPDF}>📄 PDF</Text>
          </TouchableOpacity>
        </View>
      </View>
    </TouchableOpacity>
  );

  // --- Pantalla de carga ---
  if (isLoading) {
    return <LoadingSpinner message="Cargando visitas..." fullScreen />;
  }

  // --- Estadísticas generales ---
  const totalVisitas = formularios.length;
  const totalTecnicos = tecnicos.length;
  const totalBeneficiarios = tecnicos.reduce((sum, t) => sum + t.totalBeneficiarios, 0);

  return (
    <View style={styles.container}>
      {/* Header resumen */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>{totalTecnicos}</Text>
          <Text style={styles.summaryLabel}>Técnicos</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>{totalBeneficiarios}</Text>
          <Text style={styles.summaryLabel}>Beneficiarios</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>{totalVisitas}</Text>
          <Text style={styles.summaryLabel}>Visitas</Text>
        </View>
      </View>

      {/* Breadcrumb */}
      {renderBreadcrumb()}

      {/* Lista según nivel */}
      {nivel === 'tecnicos' && (
        <FlatList
          data={tecnicos}
          keyExtractor={(item) => item.id}
          renderItem={renderTecnico}
          contentContainerStyle={styles.listContent}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[COLORS.primary]}
              tintColor={COLORS.primary}
            />
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyIcon}>👷</Text>
              <Text style={styles.emptyText}>No hay técnicos registrados</Text>
              <Text style={styles.emptySubtext}>
                {loadError || 'Aún no hay formularios en el sistema.'}
                {'\n'}Tira hacia abajo para refrescar.
              </Text>
            </View>
          }
        />
      )}

      {nivel === 'beneficiarios' && tecnicoSeleccionado && (
        <FlatList
          data={tecnicoSeleccionado.beneficiarios}
          keyExtractor={(item) => item.cedula || item.nombre}
          renderItem={renderBeneficiario}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.levelHeader}>
              <Text style={styles.levelTitle}>Beneficiarios de {tecnicoSeleccionado.nombre}</Text>
              <Text style={styles.levelCount}>
                {tecnicoSeleccionado.totalBeneficiarios} beneficiario(s), {tecnicoSeleccionado.totalVisitas} visita(s)
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Sin beneficiarios</Text>
            </View>
          }
        />
      )}

      {nivel === 'visitas' && beneficiarioSeleccionado && (
        <FlatList
          data={beneficiarioSeleccionado.visitas}
          keyExtractor={(item) => item.id}
          renderItem={renderVisita}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.levelHeader}>
              <Text style={styles.levelTitle}>
                {beneficiarioSeleccionado.nombre}
              </Text>
              <Text style={styles.levelCount}>
                {beneficiarioSeleccionado.vereda}, {beneficiarioSeleccionado.municipio}
                {' · '}{beneficiarioSeleccionado.visitas.length} visita(s)
              </Text>
            </View>
          }
          ListEmptyComponent={
            <View style={styles.emptyState}>
              <Text style={styles.emptyText}>Sin visitas registradas</Text>
            </View>
          }
        />
      )}
    </View>
  );
};

// ============================================================
// ESTILOS
// ============================================================
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },

  // --- Summary bar ---
  summaryBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
    alignItems: 'center',
    justifyContent: 'space-around',
  },
  summaryItem: {
    alignItems: 'center',
  },
  summaryNumber: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.primary,
  },
  summaryLabel: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  summaryDivider: {
    width: 1,
    height: 30,
    backgroundColor: COLORS.divider,
  },

  // --- Breadcrumb ---
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surfaceAlt,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  breadcrumbItem: {
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  breadcrumbText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.medium,
  },
  breadcrumbActive: {
    color: COLORS.primary,
    fontWeight: FONTS.weights.bold,
  },
  breadcrumbSep: {
    fontSize: FONTS.sizes.lg,
    color: COLORS.textLight,
    marginHorizontal: 4,
  },

  // --- Level header ---
  levelHeader: {
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
  },
  levelTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  levelCount: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 2,
  },

  // --- Cards genéricos ---
  card: {
    backgroundColor: COLORS.surface,
    marginHorizontal: SPACING.md,
    marginVertical: 4,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    ...SHADOWS.sm,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarChip: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  avatarLetter: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
  },
  cardInfo: {
    flex: 1,
  },
  cardTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  cardSubtitle: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  badgeContainer: {
    flexDirection: 'row',
    gap: 6,
    marginRight: SPACING.sm,
  },
  badge: {
    alignItems: 'center',
    backgroundColor: COLORS.primary + '10',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.sm,
    minWidth: 44,
  },
  badgeSecondary: {
    backgroundColor: COLORS.roleSupervisor + '10',
  },
  badgeNumber: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    color: COLORS.primary,
  },
  badgeLabel: {
    fontSize: 9,
    color: COLORS.textLight,
    textTransform: 'uppercase',
  },
  chevron: {
    fontSize: 22,
    color: COLORS.textLight,
    marginLeft: 4,
  },

  // --- Visita card (nivel 3) ---
  visitaCard: {
    backgroundColor: COLORS.surface,
    marginHorizontal: SPACING.md,
    marginVertical: 4,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    ...SHADOWS.sm,
  },
  visitaHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  visitaNumero: {
    backgroundColor: COLORS.primary + '15',
    paddingHorizontal: SPACING.md,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.full,
  },
  visitaNumeroText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    color: COLORS.primary,
  },
  visitaFecha: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  visitaBody: {
    marginBottom: SPACING.sm,
  },
  visitaTag: {
    marginBottom: 4,
  },
  visitaTagText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  visitaDesc: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    marginTop: 2,
  },
  visitaFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
    paddingTop: SPACING.sm,
  },
  statusIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  statusText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  visitaActions: {
    flexDirection: 'row',
    gap: 8,
  },
  actionBtn: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.info + '15',
  },
  actionBtnText: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.medium,
    color: COLORS.info,
  },
  actionBtnPDF: {
    backgroundColor: COLORS.error + '10',
  },
  actionBtnTextPDF: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.medium,
    color: COLORS.error,
  },

  // --- List ---
  listContent: {
    paddingVertical: SPACING.sm,
    paddingBottom: SPACING.xxl,
  },

  // --- Empty state ---
  emptyState: {
    alignItems: 'center',
    padding: SPACING.xl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: SPACING.md,
  },
  emptyText: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: SPACING.sm,
  },
});

export default VisitasJerarquicasScreen;
