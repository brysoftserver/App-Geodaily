// ============================================================
// GEODAILY — Listado de Formularios (Técnico)
// ============================================================
// Soporta filtro opcional por beneficiarioCedula desde
// la jerarquía BeneficiarioDetailScreen → "Ver visitas anteriores"
// ============================================================

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ImageBackground,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../../theme';
import { useForm } from '../../store/FormContext';
import { useAuth } from '../../store/AuthContext';
import { useSync } from '../../store/SyncContext';
import { getFormulariosLocales, mergeFormulariosDelServidor } from '../../services/database';
import { fetchFormulariosDelServidor } from '../../services/formularios.service';
import { fetchResumenRevisiones, EstadoRevision } from '../../services/revisiones.service';
import { Formulario } from '../../types';
import FormCard from '../../components/FormCard';
import LoadingSpinner from '../../components/LoadingSpinner';
import { TerrenoStackParamList } from '../../navigation/TerrenoNavigator';

type FormularioListScreenProps = {
  navigation: NativeStackNavigationProp<TerrenoStackParamList, 'TerrenoFormularioList'>;
  route?: {
    params: {
      beneficiarioCedula?: string;
    };
  };
};

/** Valida que un formulario tenga los campos esenciales para renderizar */
const isValidFormulario = (f: Record<string, any>): f is import('../../types').Formulario => {
  if (!f || !f.id || !f.tipo) return false;
  if (!f.beneficiario || typeof f.beneficiario !== 'object') return false;
  if (!f.beneficiario.nombre) return false;
  // También el técnico: el detalle lo lee y un formulario del servidor con
  // tecnico_json vacío daba pantalla blanca sin recuperación posible.
  if (!f.tecnico || typeof f.tecnico !== 'object') return false;
  // Coordenadas pueden ser opcionales, pero si existen deben ser válidas
  return true;
};

const FormularioListScreen: React.FC<FormularioListScreenProps> = ({ navigation, route }) => {
  const { formularios, cargarFormularios } = useForm();
  const { user } = useAuth();
  const { failedForms, reintentarFormulario } = useSync();
  const insets = useSafeAreaInsets();
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [estadosRevision, setEstadosRevision] = useState<Record<string, EstadoRevision>>({});

  // Filtrar por beneficiario si viene como parámetro
  // `undefined` = sin filtro (historial completo). Una cadena VACÍA sí es un
  // filtro: son los beneficiarios sin cédula registrada. Antes la cadena vacía
  // era falsy y se mostraban TODOS los formularios del técnico bajo el nombre
  // de ese beneficiario — visitas de otras fincas atribuidas a esta.
  const beneficiarioCedula = route?.params?.beneficiarioCedula;
  const filtrarPorBeneficiario = beneficiarioCedula !== undefined;
  const formulariosFiltrados = useMemo(() => {
    if (!filtrarPorBeneficiario) return formularios;
    return formularios.filter(
      (f) => (f.beneficiario?.cedula || '') === (beneficiarioCedula || '')
    );
  }, [formularios, beneficiarioCedula, filtrarPorBeneficiario]);

  /** Lee la BD local y publica al contexto */
  const publicarLocales = useCallback(async () => {
    const localForms = await getFormulariosLocales(user?.id);
    // Filtrar formularios inválidos para evitar white screen
    const validForms = localForms.filter(isValidFormulario);
    if (validForms.length < localForms.length) {
      console.warn(
        `[Listado] Se omitieron ${localForms.length - validForms.length} formularios inválidos`
      );
    }
    // Siempre actualizar contexto, incluso si está vacío (limpia datos de otro usuario)
    cargarFormularios(validForms);
  }, [cargarFormularios, user?.id]);

  const loadForms = useCallback(async () => {
    try {
      // Estado de revisiones (novedades / vistos buenos) — best effort,
      // si no hay conexión simplemente no se muestran badges
      fetchResumenRevisiones().then(setEstadosRevision).catch(() => {});

      // 1. Mostrar lo local de inmediato — el técnico en campo no espera red
      await publicarLocales();
    } catch (error) {
      console.warn('[Listado] Error cargando formularios locales:', error);
    } finally {
      setIsLoading(false);
    }

    // 2. En segundo plano: traer del servidor, fusionar y refrescar.
    //    Esto es lo que permite que un técnico vea sus formularios al
    //    iniciar sesión en un teléfono distinto. Offline devuelve [] y
    //    la vista simplemente se queda con lo local.
    try {
      const remotos = await fetchFormulariosDelServidor();
      if (remotos.length > 0) {
        const aplicados = await mergeFormulariosDelServidor(remotos);
        if (aplicados > 0) await publicarLocales();
      }
    } catch (e) {
      console.warn('[Listado] No se pudo traer del servidor, usando local:', e);
    } finally {
      setRefreshing(false);
    }
  }, [publicarLocales]);

  useEffect(() => {
    loadForms();
  }, [loadForms]);

  // Recargar al enfocar la pantalla
  useEffect(() => {
    const unsubscribe = navigation.addListener('focus', () => {
      loadForms();
    });
    return unsubscribe;
  }, [navigation, loadForms]);

  const onRefresh = () => {
    setRefreshing(true);
    loadForms();
  };

  const handleFormPress = (formulario: Formulario) => {
    navigation.navigate('FormularioDetail', { formulario });
  };

  const handleViewPDF = (formulario: Formulario) => {
    // Ahora manejado desde FormularioDetailScreen
    navigation.navigate('FormularioDetail', { formulario });
  };

  if (isLoading) {
    return <LoadingSpinner message="Cargando formularios..." fullScreen />;
  }

  // Safely filter formularios again just in case context has invalid ones
  const safeFormularios = formulariosFiltrados.filter(isValidFormulario);

  // Obtener nombre del beneficiario del primer formulario filtrado (para el título)
  const beneficiarioNombre = safeFormularios.length > 0
    ? safeFormularios[0].beneficiario?.nombre
    : null;

  return (
    <ImageBackground
      source={require('../../../Logos_imagenes/fondo_login_geo_daily.png')}
      style={styles.backgroundImage}
      resizeMode="cover"
    >
    <SafeAreaView style={styles.safeContainer} edges={['top']}>
    <View style={styles.container}>
      <View style={[styles.header, { paddingTop: Math.max(insets.top, SPACING.md) }]}>
        <Text style={styles.title}>
          {beneficiarioNombre
            ? `Visitas de ${beneficiarioNombre}`
            : 'Historial de Formularios'}
        </Text>
        <Text style={styles.count}>
          {safeFormularios.length} formulario(s)
        </Text>
      </View>

      {safeFormularios.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyIcon}>📋</Text>
          <Text style={styles.emptyText}>No hay formularios registrados</Text>
          <Text style={styles.emptySubtext}>
            {beneficiarioNombre
              ? 'Este beneficiario aún no tiene visitas registradas'
              : 'Completa un formulario desde el listado de beneficiarios para verlo aquí'}
          </Text>
        </View>
      ) : (
        <FlatList
          data={safeFormularios}
          keyExtractor={(item) => item.id}
          renderItem={({ item }) => (
            <FormCard
              formulario={item}
              onPress={handleFormPress}
              onViewPDF={handleViewPDF}
              failed={failedForms.includes(item.id)}
              onRetry={(f) => reintentarFormulario(f.id)}
              estadoRevision={estadosRevision[item.id]}
            />
          )}
          contentContainerStyle={[styles.listContent, { paddingBottom: insets.bottom + SPACING.xxl }]}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              colors={[COLORS.primary]}
              tintColor={COLORS.primary}
            />
          }
        />
      )}
    </View>
    </SafeAreaView>
    </ImageBackground>
  );
};

const styles = StyleSheet.create({
  backgroundImage: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  safeContainer: {
    flex: 1,
    backgroundColor: 'transparent',
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  title: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  count: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    backgroundColor: COLORS.surfaceAlt,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    borderRadius: BORDER_RADIUS.full,
  },
  listContent: {
    paddingVertical: SPACING.sm,
  },
  emptyState: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  emptyIcon: {
    fontSize: 64,
    marginBottom: SPACING.md,
  },
  emptyText: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.sm,
  },
  emptySubtext: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textLight,
    textAlign: 'center',
  },
});

export default FormularioListScreen;
