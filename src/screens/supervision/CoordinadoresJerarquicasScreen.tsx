// ============================================================
// GEODAILY — Listado de coordinadores/interventores y visitas
// ============================================================
// Estructura de 2 niveles (solo lectura, para el admin):
//   Nivel 1: Lista de coordinadores e interventores (autores de seguimientos)
//   Nivel 2: Seguimientos (visitas) realizados por ese autor, según su
//            tarjeta de "Seguimiento Coordinación" o "Seguimiento Interventoría"
//   Nivel 3: Detalle del seguimiento (pantalla existente SeguimientoDetail)
//
// Los datos provienen de la MISMA fuente que usan las tarjetas de
// seguimiento: la tabla local `seguimientos_locales` (offline-first) más
// lo que traiga el servidor vía /api/seguimientos (el admin ve TODOS los
// roles, ver backend/src/routes/seguimientos.js). No se modifica ni se
// elimina ningún formulario ni seguimiento desde aquí.
// ============================================================

import React, { useState, useMemo, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
  BackHandler,
  Alert,
  Platform,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useAuth } from '../../store/AuthContext';
import { SeguimientoLocal, getSeguimientosLocales, mergeSeguimientosDelServidor, purgarSeguimientosAusentes, eliminarSeguimientoLocal } from '../../services/database';
import { fetchSeguimientosConEstado, eliminarSeguimiento } from '../../services/seguimientos.service';
import LoadingSpinner from '../../components/LoadingSpinner';

type CoordinadoresJerarquicasScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
};

// --- Tipos auxiliares ---
interface AutorAgrupado {
  id: string;
  nombre: string;
  rol: 'coordinador' | 'interventor';
  totalSeguimientos: number;
  seguimientos: SeguimientoLocal[];
}

type Nivel = 'autores' | 'seguimientos';

const ROL_LABEL: Record<'coordinador' | 'interventor', string> = {
  coordinador: 'Coordinación',
  interventor: 'Interventoría',
};

const CoordinadoresJerarquicasScreen: React.FC<CoordinadoresJerarquicasScreenProps> = ({ navigation }) => {
  const { puedeEliminarSeguimiento } = useAuth();
  const [seguimientos, setSeguimientos] = useState<SeguimientoLocal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);

  // Estado de navegación jerárquica
  const [nivel, setNivel] = useState<Nivel>('autores');
  const nivelRef = useRef<Nivel>('autores');
  const [autorSeleccionado, setAutorSeleccionado] = useState<AutorAgrupado | null>(null);

  // --- Agrupar seguimientos por autor (coordinador/interventor) ---
  const autores = useMemo<AutorAgrupado[]>(() => {
    const mapa = new Map<string, AutorAgrupado>();

    for (const seg of seguimientos) {
      try {
        const rol = seg.autor_rol === 'interventor' ? 'interventor' : 'coordinador';
        const key = seg.autor_id || seg.autor_nombre || `${rol}-desconocido`;
        if (!key) continue;

        if (!mapa.has(key)) {
          mapa.set(key, {
            id: key,
            nombre: seg.autor_nombre || 'Sin nombre',
            rol,
            totalSeguimientos: 0,
            seguimientos: [],
          });
        }

        const grupo = mapa.get(key)!;
        if (seg.autor_nombre && (!grupo.nombre || grupo.nombre === 'Sin nombre')) {
          grupo.nombre = seg.autor_nombre;
        }
        grupo.totalSeguimientos++;
        grupo.seguimientos.push(seg);
      } catch (err) {
        console.warn('[CoordinadoresJerarquicas] Error agrupando seguimiento:', err, seg?.id);
      }
    }

    // Ordenar seguimientos por fecha (más reciente primero) y autores por nombre
    for (const autor of mapa.values()) {
      autor.seguimientos.sort(
        (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      );
    }

    return Array.from(mapa.values()).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
  }, [seguimientos]);

  // --- Cargar datos (local + servidor) ---
  const loadData = useCallback(async () => {
    setLoadError(null);
    try {
      // 1. Local de inmediato (incluye lo creado offline, aún sin subir).
      const locales = await getSeguimientosLocales();
      setSeguimientos(locales);

      // 2. En segundo plano: traer del servidor y fusionar (otros dispositivos).
      //    El admin recibe TODOS los roles desde /api/seguimientos.
      const { seguimientos: remotos, ok } = await fetchSeguimientosConEstado();
      if (ok) {
        // 2a. Purgar localmente lo que ya no existe en el servidor (borrado
        //     desde otro dispositivo). Solo si el fetch fue exitoso.
        await purgarSeguimientosAusentes(remotos.map((r) => r.id));
      }
      if (remotos.length > 0) {
        await mergeSeguimientosDelServidor(
          remotos.map((r) => ({
            id: r.id,
            autor_id: r.autor_id,
            autor_nombre: r.autor_nombre || '',
            autor_rol: r.autor_rol,
            beneficiario_cedula: r.beneficiario_cedula || undefined,
            beneficiario_nombre: r.beneficiario_nombre || undefined,
            formulario_id: r.formulario_id || undefined,
            actividad: r.actividad,
            objetivo_visita: r.objetivo_visita || undefined,
            descripcion_actividad: r.descripcion_actividad || undefined,
            observaciones: r.observaciones || undefined,
            // Solo evidencia que ya vive en MinIO: el `uri` de un item sin
            // archivo_id es la ruta local del teléfono que lo capturó y no
            // existe aquí (además dispararía reintentos de subida inútiles).
            fotos: (r.fotos_json || [])
              .filter((f) => !!f.archivo_id)
              .map((f) => ({ id: f.archivo_id, uri: f.uri || '', archivo_id: f.archivo_id })),
            videos: (r.videos_json || [])
              .filter((v) => !!v.archivo_id)
              .map((v) => ({ id: v.archivo_id, uri: v.uri || '', archivo_id: v.archivo_id })),
            firma_beneficiario: r.firma_beneficiario || undefined,
            firma_autor: r.firma_autor || undefined,
            geo_latitud: r.geo_latitud ?? undefined,
            geo_longitud: r.geo_longitud ?? undefined,
            geo_altitud: r.geo_altitud ?? undefined,
            geo_precision: r.geo_precision ?? undefined,
            huella_beneficiario: r.huella_beneficiario ?? undefined,
            pdf_url: r.pdf_url || undefined,
            sincronizado: true,
            completado: true,
            created_at: r.created_at,
            updated_at: r.updated_at,
          }))
        );
        const actualizados = await getSeguimientosLocales();
        setSeguimientos(actualizados);
      }

      if (locales.length === 0 && remotos.length === 0) {
        setLoadError('No se encontraron seguimientos registrados.');
      }
    } catch (error: any) {
      console.warn('[CoordinadoresJerarquicas] Error cargando:', error?.message || error);
      setLoadError(`Error de conexión: ${error?.message || 'No se pudo conectar con el servidor'}`);
      // Fallback: solo locales
      try {
        const locales = await getSeguimientosLocales();
        setSeguimientos(locales);
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

  // Mantener ref sincronizada con estado nivel
  useEffect(() => {
    nivelRef.current = nivel;
  }, [nivel]);

  const volverAAutores = () => {
    setNivel('autores');
    setAutorSeleccionado(null);
  };

  // Interceptar botón físico/gesto de atrás para navegación jerárquica interna
  useEffect(() => {
    const onBackPress = () => {
      if (nivel === 'seguimientos') {
        volverAAutores();
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
      if (nivelRef.current === 'autores') return; // dejar salir
      e.preventDefault(); // prevenir salida
      setNivel('autores');
      setAutorSeleccionado(null);
    });
    return unsubscribe;
  }, [navigation]);

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  // --- Navegación entre niveles ---
  const seleccionarAutor = (autor: AutorAgrupado) => {
    setAutorSeleccionado(autor);
    setNivel('seguimientos');
  };

  const abrirDetalleSeguimiento = (seg: SeguimientoLocal) => {
    navigation.navigate('AdminSeguimientoDetail', { seguimientoId: seg.id });
  };

  // --- ELIMINAR (long-press) ---
  // Borra el seguimiento del servidor (si ya está sincronizado) y de la copia
  // local. Mismo criterio que los formularios del técnico: admin, coordinador
  // e interventor pueden eliminar (ver backend/src/routes/seguimientos.js).
  const confirmarEliminarSeguimiento = (seg: SeguimientoLocal) => {
    if (!puedeEliminarSeguimiento) return;
    Alert.alert(
      'Eliminar seguimiento',
      `¿Eliminar definitivamente el seguimiento "${seg.actividad || 'sin actividad'}" de ${seg.autor_nombre || 'este autor'}?\n\nEsta acción NO se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            setEliminandoId(seg.id);
            try {
              // Si ya está sincronizado, borrarlo también del servidor — si
              // falla (sin conexión), se aborta sin tocar la copia local.
              if (seg.sincronizado) {
                await eliminarSeguimiento(seg.id);
              }
              await eliminarSeguimientoLocal(seg.id);
              await loadData();
            } catch (error: any) {
              Alert.alert('No se pudo eliminar', error?.message || 'Verifica tu conexión e intenta de nuevo.');
            } finally {
              setEliminandoId(null);
            }
          },
        },
      ]
    );
  };

  // --- Render por nivel ---

  const renderBreadcrumb = () => (
    <View style={styles.breadcrumb}>
      <TouchableOpacity onPress={volverAAutores} style={styles.breadcrumbItem}>
        <Text style={[styles.breadcrumbText, nivel === 'autores' && styles.breadcrumbActive]}>
          Coordinadores / Interventores
        </Text>
      </TouchableOpacity>
      {nivel === 'seguimientos' && (
        <>
          <Text style={styles.breadcrumbSep}>›</Text>
          <TouchableOpacity style={styles.breadcrumbItem}>
            <Text style={[styles.breadcrumbText, styles.breadcrumbActive]}>
              {autorSeleccionado?.nombre}
            </Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );

  // --- Nivel 1: Autores (coordinadores / interventores) ---
  const renderAutor = ({ item }: { item: AutorAgrupado }) => {
    const color = item.rol === 'interventor' ? COLORS.roleInterventor : COLORS.roleCoordinador;
    return (
      <TouchableOpacity
        style={styles.card}
        onPress={() => seleccionarAutor(item)}
        activeOpacity={0.7}
      >
        <View style={styles.cardRow}>
          <View style={[styles.avatarChip, { backgroundColor: color + '20' }]}>
            <Text style={[styles.avatarLetter, { color }]}>
              {item.nombre.charAt(0).toUpperCase()}
            </Text>
          </View>
          <View style={styles.cardInfo}>
            <Text style={styles.cardTitle}>{item.nombre}</Text>
            <View style={[styles.rolBadge, { backgroundColor: color + '15' }]}>
              <Text style={[styles.rolBadgeText, { color }]}>
                {ROL_LABEL[item.rol]}
              </Text>
            </View>
          </View>
          <View style={styles.badgeContainer}>
            <View style={styles.badge}>
              <Text style={styles.badgeNumber}>{item.totalSeguimientos}</Text>
              <Text style={styles.badgeLabel}>Visitas</Text>
            </View>
          </View>
          <Text style={styles.chevron}>›</Text>
        </View>
      </TouchableOpacity>
    );
  };

  // --- Nivel 2: Seguimientos (visitas) del autor ---
  const renderSeguimiento = ({ item, index }: { item: SeguimientoLocal; index: number }) => {
    const color = item.autor_rol === 'interventor' ? COLORS.roleInterventor : COLORS.roleCoordinador;
    return (
      <TouchableOpacity
        style={[styles.visitaCard, eliminandoId === item.id && styles.visitaCardEliminando]}
        onPress={() => abrirDetalleSeguimiento(item)}
        onLongPress={puedeEliminarSeguimiento ? () => confirmarEliminarSeguimiento(item) : undefined}
        disabled={eliminandoId === item.id}
        activeOpacity={0.7}
      >
        <View style={styles.visitaHeader}>
          <View style={styles.visitaHeaderLeft}>
            <View style={[styles.visitaNumero, { backgroundColor: color + '15' }]}>
              <Text style={[styles.visitaNumeroText, { color }]}>Visita {index + 1}</Text>
            </View>
            <Text style={styles.visitaFecha}>
              {new Date(item.created_at).toLocaleDateString('es-CO', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </Text>
          </View>
          {puedeEliminarSeguimiento && Platform.OS !== 'web' && (
            <Text style={styles.visitaAdminHint}>
              {eliminandoId === item.id ? 'Eliminando…' : '🗑 Mantener para eliminar'}
            </Text>
          )}
        </View>

        <View style={styles.visitaBody}>
          <View style={styles.visitaTag}>
            <Text style={styles.visitaTagText}>
              {item.autor_rol === 'interventor' ? '🛰️ Seguimiento Interventoría' : '🛰️ Seguimiento Coordinación'}
            </Text>
          </View>
          {item.actividad ? (
            <Text style={styles.visitaDesc} numberOfLines={2}>
              {item.actividad}
            </Text>
          ) : null}
          {item.beneficiario_nombre ? (
            <Text style={styles.visitaBeneficiario} numberOfLines={1}>
              👤 {item.beneficiario_nombre}
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
          <Text style={styles.verDetalle}>Ver detalle ›</Text>
        </View>
      </TouchableOpacity>
    );
  };

  // --- Pantalla de carga ---
  if (isLoading) {
    return <LoadingSpinner message="Cargando seguimientos..." fullScreen />;
  }

  // --- Estadísticas generales ---
  const totalSeguimientos = seguimientos.length;
  const totalCoordinadores = autores.filter((a) => a.rol === 'coordinador').length;
  const totalInterventores = autores.filter((a) => a.rol === 'interventor').length;

  return (
    <View style={styles.container}>
      {/* Header resumen */}
      <View style={styles.summaryBar}>
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>{totalCoordinadores}</Text>
          <Text style={styles.summaryLabel}>Coordinadores</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>{totalInterventores}</Text>
          <Text style={styles.summaryLabel}>Interventores</Text>
        </View>
        <View style={styles.summaryDivider} />
        <View style={styles.summaryItem}>
          <Text style={styles.summaryNumber}>{totalSeguimientos}</Text>
          <Text style={styles.summaryLabel}>Visitas</Text>
        </View>
      </View>

      {/* Breadcrumb */}
      {renderBreadcrumb()}

      {/* Lista según nivel */}
      {nivel === 'autores' && (
        <FlatList
          data={autores}
          keyExtractor={(item) => item.id}
          renderItem={renderAutor}
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
              <Text style={styles.emptyIcon}>🧑💼</Text>
              <Text style={styles.emptyText}>No hay coordinadores ni interventores con visitas</Text>
              <Text style={styles.emptySubtext}>
                {loadError || 'Aún no hay seguimientos registrados en el sistema.'}
                {'\n'}Tira hacia abajo para refrescar.
              </Text>
            </View>
          }
        />
      )}

      {nivel === 'seguimientos' && autorSeleccionado && (
        <FlatList
          data={autorSeleccionado.seguimientos}
          keyExtractor={(item) => item.id}
          renderItem={renderSeguimiento}
          contentContainerStyle={styles.listContent}
          ListHeaderComponent={
            <View style={styles.levelHeader}>
              <Text style={styles.levelTitle}>
                {autorSeleccionado.nombre}
              </Text>
              <Text style={styles.levelCount}>
                {ROL_LABEL[autorSeleccionado.rol]}
                {' · '}{autorSeleccionado.seguimientos.length} visita(s)
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
  summaryBar: {
    flexDirection: 'row',
    backgroundColor: COLORS.surface,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    ...SHADOWS.sm,
  },
  summaryItem: {
    flex: 1,
    alignItems: 'center',
  },
  summaryNumber: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  summaryLabel: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  summaryDivider: {
    width: 1,
    backgroundColor: COLORS.border,
    marginVertical: SPACING.xs,
  },
  breadcrumb: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.border,
  },
  breadcrumbItem: {
    paddingVertical: 2,
  },
  breadcrumbText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  breadcrumbActive: {
    color: COLORS.primary,
    fontWeight: FONTS.weights.semibold,
  },
  breadcrumbSep: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginHorizontal: SPACING.xs,
  },
  listContent: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    ...SHADOWS.md,
  },
  cardRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatarChip: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
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
  rolBadge: {
    alignSelf: 'flex-start',
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    marginTop: 4,
  },
  rolBadgeText: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.semibold,
  },
  badgeContainer: {
    marginLeft: SPACING.sm,
  },
  badge: {
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
  },
  badgeNumber: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  badgeLabel: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  chevron: {
    fontSize: FONTS.sizes.xl,
    color: COLORS.textSecondary,
    marginLeft: SPACING.sm,
  },
  levelHeader: {
    marginBottom: SPACING.md,
  },
  levelTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  levelCount: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  visitaCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    marginBottom: SPACING.md,
    ...SHADOWS.md,
  },
  visitaCardEliminando: {
    opacity: 0.5,
  },
  visitaAdminHint: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.error,
    fontWeight: FONTS.weights.semibold,
    marginHorizontal: SPACING.sm,
  },
  visitaHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    flexWrap: 'wrap',
    marginBottom: SPACING.sm,
  },
  visitaHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flexShrink: 1,
  },
  visitaNumero: {
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
  },
  visitaNumeroText: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.semibold,
  },
  visitaFecha: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginLeft: SPACING.sm,
  },
  visitaBody: {
    marginBottom: SPACING.sm,
  },
  visitaTag: {
    alignSelf: 'flex-start',
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    marginBottom: SPACING.xs,
  },
  visitaTagText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  visitaDesc: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    lineHeight: 20,
  },
  visitaBeneficiario: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
  visitaFooter: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
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
    marginRight: SPACING.xs,
  },
  statusText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  verDetalle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.primary,
    fontWeight: FONTS.weights.semibold,
  },
  emptyState: {
    alignItems: 'center',
    paddingVertical: SPACING.xxl,
    paddingHorizontal: SPACING.lg,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: SPACING.md,
  },
  emptyText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    textAlign: 'center',
  },
  emptySubtext: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.sm,
    lineHeight: 20,
  },
});

export default CoordinadoresJerarquicasScreen;
