// ============================================================
// GEODAILY — Listado de Formularios (Técnico)
// ============================================================
// Soporta filtro opcional por beneficiarioCedula desde
// la jerarquía BeneficiarioDetailScreen → "Ver visitas anteriores"
// ============================================================

import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  RefreshControl,
  ImageBackground,
  Alert,
  TouchableOpacity,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS } from '../../theme';
import { useForm } from '../../store/FormContext';
import { useAuth } from '../../store/AuthContext';
import { useSync } from '../../store/SyncContext';
import {
  getFormulariosLocales,
  mergeFormulariosDelServidor,
  getFormulariosPurgados,
  restaurarFormulariosPurgados,
} from '../../services/database';
import { fetchFormulariosDelServidor } from '../../services/formularios.service';
import { fetchResumenRevisiones, EstadoRevision } from '../../services/revisiones.service';
import { descargarPaqueteMedia } from '../../services/mediaPackage.service';
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
  const [descargandoMediaId, setDescargandoMediaId] = useState<string | null>(null);
  /** Cuántos formularios eliminados en el servidor siguen recuperables aquí. */
  const [papeleraCount, setPapeleraCount] = useState(0);
  /** Evita que el merge/purga corra dos veces a la vez (mount + focus). */
  const cargaEnCursoRef = useRef(false);

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

  /**
   * Formularios pendientes de recuperar EN ESTE TELÉFONO para el usuario actual.
   * Se limita por `usuario_id` para que un técnico no vea ni restaure el trabajo
   * de otro si el equipo se reutilizó.
   */
  const leerPapeleraDelUsuario = useCallback(async () => {
    const todas = await getFormulariosPurgados();
    return todas.filter((p) => !user?.id || !p.usuario_id || p.usuario_id === user.id);
  }, [user?.id]);

  const contarPapelera = useCallback(() => {
    leerPapeleraDelUsuario()
      .then((p) => setPapeleraCount(p.length))
      .catch(() => {});
  }, [leerPapeleraDelUsuario]);

  const loadForms = useCallback(async () => {
    try {
      // Estado de revisiones (novedades / vistos buenos) — best effort,
      // si no hay conexión simplemente no se muestran badges
      fetchResumenRevisiones().then(setEstadosRevision).catch(() => {});

      // 1. Mostrar lo local de inmediato — el técnico en campo no espera red
      await publicarLocales();
      contarPapelera();
    } catch (error) {
      console.warn('[Listado] Error cargando formularios locales:', error);
    } finally {
      setIsLoading(false);
    }

    // 2. En segundo plano: traer del servidor, fusionar y refrescar.
    //    Esto es lo que permite que un técnico vea sus formularios al
    //    iniciar sesión en un teléfono distinto. Offline devuelve [] y
    //    la vista simplemente se queda con lo local.
    //
    //    El guard es importante: `loadForms` corre al montar Y al enfocar la
    //    pantalla. Sin él, el merge (y con él la purga + el aviso) podía
    //    dispararse dos veces en paralelo sobre la misma lista.
    if (cargaEnCursoRef.current) {
      setRefreshing(false);
      return;
    }
    cargaEnCursoRef.current = true;
    try {
      const remotos = await fetchFormulariosDelServidor();
      if (remotos.length > 0) {
        const { purgados } = await mergeFormulariosDelServidor(remotos, { usuarioId: user?.id });
        // Siempre republicar: el merge puede haber purgado formularios
        // borrados en el servidor aunque no haya insertado/actualizado nada.
        await publicarLocales();
        contarPapelera();

        // ⚠️ Si el servidor ya no tenía formularios que sí estaban en el
        // teléfono (los borró alguien desde el panel: 530 borrados solo por
        // el admin entre julio y septiembre), el técnico veía desaparecer su
        // trabajo sin explicación. Ahora se le avisa y se le ofrece
        // recuperarlos: la copia completa quedó en la papelera local.
        if (purgados.length > 0) {
          Alert.alert(
            '⚠️ Formularios eliminados en el servidor',
            `Se eliminaron ${purgados.length} formulario(s) que estaban guardados en este teléfono, porque ya no existen en el servidor.\n\n¿Deseas recuperarlos?`,
            [
              { text: 'No, dejarlos', style: 'cancel' },
              {
                text: 'Recuperar',
                onPress: async () => {
                  const n = await restaurarFormulariosPurgados(purgados);
                  await publicarLocales();
                  contarPapelera();
                  Alert.alert(
                    n > 0 ? '✅ Recuperados' : 'Sin cambios',
                    n > 0
                      ? `Se recuperaron ${n} formulario(s) con sus fotos y firmas. Quedan como pendientes de sincronizar.`
                      : 'No se pudo recuperar ningún formulario.'
                  );
                },
              },
            ]
          );
        }
      }
    } catch (e) {
      console.warn('[Listado] No se pudo traer del servidor, usando local:', e);
    } finally {
      cargaEnCursoRef.current = false;
      setRefreshing(false);
    }
  }, [publicarLocales, user?.id, contarPapelera]);

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

  /** Acceso manual a la papelera: recuperar formularios borrados en el servidor. */
  const abrirPapelera = useCallback(async () => {
    const enPapelera = await leerPapeleraDelUsuario();
    if (enPapelera.length === 0) {
      Alert.alert('Papelera vacía', 'No hay formularios eliminados pendientes de recuperar.');
      return;
    }
    Alert.alert(
      '🗑️ Papelera de formularios',
      `Hay ${enPapelera.length} formulario(s) eliminados en el servidor que todavía se conservan en este teléfono:\n\n` +
        enPapelera
          .slice(0, 8)
          .map((p) => `• ${p.beneficiario_nombre || p.id}`)
          .join('\n') +
        (enPapelera.length > 8 ? `\n… y ${enPapelera.length - 8} más` : ''),
      [
        { text: 'Cerrar', style: 'cancel' },
        {
          text: 'Recuperar todos',
          onPress: async () => {
            const n = await restaurarFormulariosPurgados(enPapelera.map((p) => p.id));
            await publicarLocales();
            contarPapelera();
            Alert.alert('✅ Recuperados', `${n} formulario(s) restaurados. Quedan pendientes de sincronizar.`);
          },
        },
      ]
    );
  }, [contarPapelera, leerPapeleraDelUsuario, publicarLocales]);

  const handleFormPress = (formulario: Formulario) => {
    navigation.navigate('FormularioDetail', { formulario });
  };

  const handleViewPDF = (formulario: Formulario) => {
    // Ahora manejado desde FormularioDetailScreen
    navigation.navigate('FormularioDetail', { formulario });
  };

  const handleDownloadMedia = async (formulario: Formulario) => {
    if (descargandoMediaId) return; // evita doble toque mientras arma otro paquete
    setDescargandoMediaId(formulario.id);
    try {
      await descargarPaqueteMedia(formulario);
    } finally {
      setDescargandoMediaId(null);
    }
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
        {papeleraCount > 0 && (
          <TouchableOpacity onPress={abrirPapelera} style={styles.papeleraLink}>
            <Text style={styles.papeleraLinkText}>
              🗑️ {papeleraCount} eliminado(s) en el servidor — tocar para recuperar
            </Text>
          </TouchableOpacity>
        )}
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
              onDownloadMedia={handleDownloadMedia}
              downloadingMedia={descargandoMediaId === item.id}
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
  // Acceso a la papelera: los formularios que el servidor borró pero que
  // siguen guardados en el teléfono y se pueden recuperar.
  papeleraLink: {
    marginTop: SPACING.xs,
    paddingVertical: SPACING.xs,
  },
  papeleraLinkText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.warning ?? COLORS.primary,
    textDecorationLine: 'underline',
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
