// ============================================================
// GEODAILY — Listado de Beneficiarios (Técnico)
// ============================================================
// Muestra los beneficiarios agrupados del técnico actual.
// Nivel 1 de la jerarquía: Técnico → Beneficiario → Visitas
// ============================================================

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  RefreshControl,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useFocusEffect } from '@react-navigation/native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { Formulario, DatosBeneficiario, BeneficiarioDB } from '../../types';
import { getFormulariosLocales } from '../../services/database';
import { fetchFormulariosDelServidor } from '../../services/formularios.service';
import { getBeneficiariosByTecnico, sincronizarBeneficiariosDesdeServidor } from '../../services/beneficiariosDB.service';
import { useAuth } from '../../store/AuthContext';
import LoadingSpinner from '../../components/LoadingSpinner';

type BeneficiariosListScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
};

// --- Tipo auxiliar para beneficiario agrupado ---
interface BeneficiarioAgrupado extends DatosBeneficiario {
  visitas: Formulario[];
  ultimaVisita?: string;
}

const BeneficiariosListScreen: React.FC<BeneficiariosListScreenProps> = ({ navigation }) => {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();

  const [formularios, setFormularios] = useState<Formulario[]>([]);
  const [assignedDB, setAssignedDB] = useState<BeneficiarioDB[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  // --- Agrupar formularios por beneficiario y fusionar con asignados de BD ---
  const beneficiarios = useMemo(() => {
    const mapa = new Map<string, BeneficiarioAgrupado>();

    // 1. Agrupar por formularios (visitas existentes)
    for (const form of formularios) {
      try {
        const benef = form.beneficiario;
        if (!benef || !benef.nombre) continue;
        const key = benef.cedula || benef.nombre;

        if (!mapa.has(key)) {
          mapa.set(key, {
            nombre: benef.nombre || 'Sin nombre',
            cedula: benef.cedula || '',
            telefono: benef.telefono || '',
            departamento: benef.departamento || '',
            municipio: benef.municipio || '',
            vereda: benef.vereda || '',
            finca: benef.finca || '',
            visitas: [],
          });
        }

        const grupo = mapa.get(key)!;
        grupo.visitas.push(form);

        if (!grupo.ultimaVisita || form.created_at > grupo.ultimaVisita) {
          grupo.ultimaVisita = form.created_at;
        }
      } catch (err) {
        console.warn('[BeneficiariosList] Error agrupando:', err);
      }
    }

    // 2. Agregar beneficiarios asignados desde la BD local (que no tengan visitas aún)
    for (const b of assignedDB) {
      const key = b.cedula || b.nombre_completo;
      if (!mapa.has(key)) {
        mapa.set(key, {
          nombre: b.nombre_completo,
          cedula: b.cedula,
          telefono: '',
          departamento: '',
          municipio: b.corregimiento || '',
          vereda: b.vereda || '',
          finca: '',
          visitas: [],
        });
      }
    }

    // Ordenar: beneficiarios por nombre
    for (const b of mapa.values()) {
      b.visitas.sort(
        (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      );
    }

    return Array.from(mapa.values()).sort((a, b) => (a.nombre || '').localeCompare(b.nombre || ''));
  }, [formularios, assignedDB]);

  // --- Cargar datos ---
  const loadData = useCallback(async () => {
    setLoadError(null);
    try {
      // Refrescar el espejo local de beneficiarios desde el servidor (ahí
      // llegan las asignaciones hechas por admin/supervisión desde otros
      // dispositivos). Sin conexión, se usa el espejo local anterior.
      await sincronizarBeneficiariosDesdeServidor();

      const [locales, servidor, asignadosBD] = await Promise.all([
        getFormulariosLocales(user?.id),
        fetchFormulariosDelServidor(),
        getBeneficiariosByTecnico(user?.id || ''),
      ]);

      setAssignedDB(asignadosBD);

      // Fusionar: locales tienen datos no sincronizados, servidor tiene los completos
      const mapaFusion = new Map<string, Formulario>();
      for (const f of locales) mapaFusion.set(f.id, f);
      for (const f of servidor) mapaFusion.set(f.id, { ...f, sincronizado: true });

      // Filtrar solo los del técnico actual
      const cedulaTecnico = (user as any)?.cedula || '';
      const fusionados = Array.from(mapaFusion.values()).filter((f) => {
        if (!cedulaTecnico) return true; // fallback: mostrar todos
        return f.tecnico?.cedula === cedulaTecnico;
      });

      // Ver si hay al menos algunos datos que mostrar
      if (fusionados.length === 0 && asignadosBD.length === 0) {
        setLoadError(
          'No se encontraron beneficiarios asignados. Verifica que tengas formularios registrados o que el servidor esté disponible.'
        );
      } else if (fusionados.length === 0 && asignadosBD.length > 0) {
        setLoadError(null); // hay asignados de BD aunque sin visitas aún
      }

      setFormularios(fusionados);
    } catch (error: any) {
      console.warn('[BeneficiariosList] Error:', error?.message || error);
      setLoadError(`Error de conexión: ${error?.message || 'No se pudo conectar'}`);

      // Fallback: solo locales
      try {
        const [locales, asignadosBD] = await Promise.all([
          getFormulariosLocales(user?.id),
          getBeneficiariosByTecnico(user?.id || ''),
        ]);
        setFormularios(locales);
        setAssignedDB(asignadosBD);
        if (locales.length === 0 && asignadosBD.length === 0) {
          setLoadError('No hay datos disponibles. Verifica la conexión.');
        } else {
          setLoadError(null);
        }
      } catch {
        // mantener error original
      }
    } finally {
      setIsLoading(false);
      setRefreshing(false);
    }
  }, [user?.id]);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const onRefresh = () => {
    setRefreshing(true);
    loadData();
  };

  const seleccionarBeneficiario = (benef: BeneficiarioAgrupado) => {
    navigation.navigate('BeneficiarioDetail', {
      beneficiario: {
        nombre: benef.nombre,
        cedula: benef.cedula,
        telefono: benef.telefono,
        departamento: benef.departamento,
        municipio: benef.municipio,
        vereda: benef.vereda,
        finca: benef.finca,
      },
      visitas: benef.visitas,
    });
  };

  // --- Render beneficiario ---
  const renderBeneficiario = ({ item }: { item: BeneficiarioAgrupado }) => {
    const sinVisitas = item.visitas.length === 0;
    return (
    <TouchableOpacity
      style={styles.card}
      onPress={() => seleccionarBeneficiario(item)}
      activeOpacity={0.7}
    >
      <View style={styles.cardRow}>
        <View style={[styles.avatarChip, { backgroundColor: sinVisitas ? COLORS.textLight + '30' : COLORS.secondary + '25' }]}>
          <Text style={[styles.avatarLetter, { color: sinVisitas ? COLORS.textLight : COLORS.secondaryDark }]}>
            {item.nombre.charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={styles.cardInfo}>
          <Text style={styles.cardTitle}>{item.nombre}</Text>
          <Text style={styles.cardSubtitle}>
            📍 {item.vereda ? `${item.vereda}, ` : ''}{item.municipio || item.departamento || ''}
            {item.finca ? ` · ${item.finca}` : ''}
          </Text>
          {sinVisitas ? (
            <Text style={styles.cardNoVisit}>🆕 Asignado — sin visitas aún</Text>
          ) : item.ultimaVisita ? (
            <Text style={styles.cardLastVisit}>
              🕐 Última visita: {new Date(item.ultimaVisita).toLocaleDateString('es-CO', {
                day: 'numeric', month: 'short', year: 'numeric'
              })}
            </Text>
          ) : null}
        </View>
        <View style={styles.badgeContainer}>
          <View style={[styles.badge, sinVisitas && styles.badgeEmpty]}>
            <Text style={[styles.badgeNumber, sinVisitas && styles.badgeNumberEmpty]}>
              {sinVisitas ? '—' : item.visitas.length}
            </Text>
            <Text style={styles.badgeLabel}>{sinVisitas ? '' : 'Visitas'}</Text>
          </View>
        </View>
        <Text style={styles.chevron}>›</Text>
      </View>
    </TouchableOpacity>
  );
  };

  // --- Pantalla de carga ---
  if (isLoading) {
    return <LoadingSpinner message="Cargando beneficiarios..." fullScreen />;
  }

  return (
    <View style={[styles.container, { paddingTop: Math.max(insets.top, SPACING.md) }]}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>👥 Mis Beneficiarios</Text>
        <Text style={styles.headerSubtitle}>
          {beneficiarios.length} beneficiario(s) asignado(s)
        </Text>
      </View>

      {loadError ? (
        <View style={styles.errorContainer}>
          <Text style={styles.errorIcon}>⚠️</Text>
          <Text style={styles.errorText}>{loadError}</Text>
        </View>
      ) : null}

      <FlatList
        data={beneficiarios}
        keyExtractor={(item) => item.cedula || item.nombre}
        renderItem={renderBeneficiario}
        contentContainerStyle={styles.listContent}
        refreshControl={
          <RefreshControl refreshing={refreshing} onRefresh={onRefresh} colors={[COLORS.primary]} />
        }
        ListEmptyComponent={
          <View style={styles.emptyContainer}>
            <Text style={styles.emptyIcon}>📭</Text>
            <Text style={styles.emptyText}>No hay beneficiarios</Text>
            <Text style={styles.emptySubtext}>Sincroniza o registra formularios para ver tus beneficiarios aquí</Text>
          </View>
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    padding: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  headerTitle: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  headerSubtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
  },
  listContent: {
    padding: SPACING.lg,
    paddingTop: SPACING.sm,
    paddingBottom: SPACING.xxl,
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.secondary,
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
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  cardLastVisit: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
    marginTop: 2,
  },
  badgeContainer: {
    alignItems: 'center',
    marginRight: SPACING.sm,
  },
  badge: {
    alignItems: 'center',
    paddingHorizontal: SPACING.sm,
  },
  badgeNumber: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.primary,
  },
  badgeLabel: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
  },
  badgeEmpty: {
    opacity: 0.5,
  },
  badgeNumberEmpty: {
    color: COLORS.textLight,
  },
  cardNoVisit: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.warning,
    marginTop: 2,
    fontStyle: 'italic',
  },
  chevron: {
    fontSize: 22,
    color: COLORS.textLight,
  },
  errorContainer: {
    marginHorizontal: SPACING.lg,
    padding: SPACING.md,
    backgroundColor: '#FFF3E0',
    borderRadius: BORDER_RADIUS.sm,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.warning,
    marginBottom: SPACING.md,
  },
  errorIcon: {
    fontSize: 18,
    marginBottom: SPACING.xs,
  },
  errorText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    lineHeight: 18,
  },
  emptyContainer: {
    alignItems: 'center',
    padding: SPACING.xl,
    marginTop: SPACING.xl,
  },
  emptyIcon: {
    fontSize: 48,
    marginBottom: SPACING.md,
  },
  emptyText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textSecondary,
  },
  emptySubtext: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textLight,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },
});

export default BeneficiariosListScreen;
