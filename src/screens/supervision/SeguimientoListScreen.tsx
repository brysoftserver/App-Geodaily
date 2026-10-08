// ============================================================
// GEODAILY — Listado de Seguimientos Realizados
// ============================================================
// Local-first, igual que el listado de formularios del técnico: muestra de
// inmediato lo que hay en SQLite (incluye lo creado offline, aún sin subir)
// y en segundo plano trae del servidor lo que falte (otros dispositivos).
// ============================================================

import React, { useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, Alert, ActivityIndicator, TouchableOpacity, Platform } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useAuth } from '../../store/AuthContext';
import { fetchSeguimientosConEstado, actualizarPdfSeguimiento, eliminarSeguimiento } from '../../services/seguimientos.service';
import { getSeguimientosLocales, mergeSeguimientosDelServidor, purgarSeguimientosAusentes, eliminarSeguimientoLocal, SeguimientoLocal } from '../../services/database';
import { generarPDFSeguimiento, construirHtmlSeguimiento, DatosPDFSeguimiento } from '../../services/pdfLocal.service';
import { abrirVentanaDeCarga, imprimirHtmlEnVentana } from '../../utils/printWeb';
import { formatFecha } from '../../utils/formatters';
import LoadingSpinner from '../../components/LoadingSpinner';
import * as Sharing from 'expo-sharing';

type SeguimientoListScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
};

const SeguimientoListScreen: React.FC<SeguimientoListScreenProps> = ({ navigation }) => {
  const { isInterventor, puedeEliminarSeguimiento } = useAuth();
  const rolActual = isInterventor ? 'interventor' : 'coordinador';
  const [seguimientos, setSeguimientos] = useState<SeguimientoLocal[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [generandoId, setGenerandoId] = useState<string | null>(null);
  const [eliminandoId, setEliminandoId] = useState<string | null>(null);

  const publicarLocales = useCallback(async () => {
    const locales = await getSeguimientosLocales(rolActual);
    setSeguimientos(locales);
  }, [rolActual]);

  const cargar = useCallback(async () => {
    // 1. Local de inmediato — incluye lo creado offline, aún sin subir.
    await publicarLocales();
    setIsLoading(false);

    // 2. En segundo plano: traer del servidor y fusionar (otros dispositivos).
    try {
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
        await publicarLocales();
      }
    } catch (e) {
      console.warn('[Seguimientos] No se pudo traer del servidor, usando local:', e);
    } finally {
      setRefreshing(false);
    }
  }, [publicarLocales]);

  React.useEffect(() => {
    cargar();
  }, [cargar]);

  const onRefresh = () => {
    setRefreshing(true);
    cargar();
  };

  const exportarPDF = async (seguimiento: SeguimientoLocal) => {
    if (generandoId) return;

    const datos: DatosPDFSeguimiento = {
      autorRol: seguimiento.autor_rol,
      autorNombre: seguimiento.autor_nombre || '—',
      actividad: seguimiento.actividad,
      objetivoVisita: seguimiento.objetivo_visita,
      descripcionActividad: seguimiento.descripcion_actividad,
      observaciones: seguimiento.observaciones,
      beneficiarioNombre: seguimiento.beneficiario_nombre,
      fecha: seguimiento.created_at,
      fotos: seguimiento.fotos.map((f) => ({ archivo_id: f.archivo_id, uri: f.uri })),
      tieneVideo: seguimiento.videos.length > 0,
      firmaBeneficiario: seguimiento.firma_beneficiario,
      firmaAutor: seguimiento.firma_autor,
      geoLatitud: seguimiento.geo_latitud,
      geoLongitud: seguimiento.geo_longitud,
      geoAltitud: seguimiento.geo_altitud,
      geoPrecision: seguimiento.geo_precision,
    };

    // En web expo-print NO genera PDF: su implementación es window.print()
    // sobre la pantalla abierta, así que el botón terminaba imprimiendo el
    // listado en vez del documento. Se abre el HTML institucional en una
    // pestaña y se imprime desde ahí (el usuario elige "Guardar como PDF").
    // La pestaña se abre SÍNCRONA, antes de cualquier await, para que el
    // navegador no la trate como pop-up.
    if (Platform.OS === 'web') {
      const ventana = abrirVentanaDeCarga();
      setGenerandoId(seguimiento.id);
      try {
        imprimirHtmlEnVentana(ventana, await construirHtmlSeguimiento(datos));
      } catch (error) {
        ventana?.close();
        Alert.alert('Error', error instanceof Error ? error.message : 'No se pudo generar el PDF.');
      } finally {
        setGenerandoId(null);
      }
      return;
    }

    setGenerandoId(seguimiento.id);
    try {
      const pdfPath = await generarPDFSeguimiento(datos);
      if (!pdfPath) {
        Alert.alert('Error', 'No se pudo generar el PDF.');
        return;
      }
      if (seguimiento.sincronizado) {
        actualizarPdfSeguimiento(seguimiento.id, pdfPath).catch(() => {});
      }
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(pdfPath, { mimeType: 'application/pdf' });
      }
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'No se pudo generar el PDF.');
    } finally {
      setGenerandoId(null);
    }
  };

  const eliminar = (item: SeguimientoLocal) => {
    if (!puedeEliminarSeguimiento) return;
    Alert.alert(
      'Eliminar seguimiento',
      `¿Eliminar "${item.actividad}"? Esta acción no se puede deshacer.`,
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            setEliminandoId(item.id);
            try {
              // Si ya está sincronizado, hay que borrarlo también del
              // servidor — si falla (sin conexión), se aborta sin tocar la
              // copia local para poder reintentar después.
              if (item.sincronizado) {
                await eliminarSeguimiento(item.id);
              }
              await eliminarSeguimientoLocal(item.id);
              await cargar();
            } catch (error) {
              Alert.alert('No se pudo eliminar', error instanceof Error ? error.message : 'Verifica tu conexión e intenta de nuevo.');
            } finally {
              setEliminandoId(null);
            }
          },
        },
      ]
    );
  };

  if (isLoading) {
    return <LoadingSpinner message="Cargando seguimientos..." fullScreen />;
  }

  return (
    <FlatList
      style={styles.container}
      contentContainerStyle={styles.content}
      data={seguimientos}
      keyExtractor={(item) => item.id}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListEmptyComponent={
        <View style={styles.empty}>
          <Text style={styles.emptyText}>Aún no has registrado ningún seguimiento.</Text>
        </View>
      }
      renderItem={({ item }) => (
        <TouchableOpacity
          style={[styles.card, eliminandoId === item.id && styles.cardEliminando]}
          onPress={() => navigation.navigate('SeguimientoDetail', { seguimientoId: item.id })}
          onLongPress={puedeEliminarSeguimiento ? () => eliminar(item) : undefined}
          disabled={eliminandoId === item.id}
          activeOpacity={0.7}
        >
          <View style={styles.cardHeader}>
            <Text style={styles.cardTitle} numberOfLines={1}>{item.actividad}</Text>
            <Text style={styles.cardFecha}>{formatFecha(item.created_at)}</Text>
          </View>
          {item.beneficiario_nombre ? (
            <Text style={styles.cardBeneficiario}>👤 {item.beneficiario_nombre}</Text>
          ) : null}
          {item.objetivo_visita ? (
            <Text style={styles.cardDesc} numberOfLines={2}>🎯 {item.objetivo_visita}</Text>
          ) : null}
          <View style={styles.cardFooter}>
            <View style={styles.estadoWrap}>
              <View style={[styles.estadoDot, { backgroundColor: item.sincronizado ? COLORS.success : COLORS.warning }]} />
              <Text style={styles.cardAutor}>
                {eliminandoId === item.id
                  ? 'Eliminando…'
                  : `${item.autor_nombre} · ${item.sincronizado ? 'Sincronizado' : 'Pendiente de subir'}`}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.pdfBtn}
              onPress={() => exportarPDF(item)}
              disabled={generandoId === item.id}
            >
              {generandoId === item.id ? (
                <ActivityIndicator size="small" color={COLORS.primary} />
              ) : (
                <Text style={styles.pdfBtnText}>📄 PDF</Text>
              )}
            </TouchableOpacity>
          </View>
          <Text style={styles.hintEliminar}>
            {puedeEliminarSeguimiento ? '🗑 Mantener presionado para eliminar' : ''}
          </Text>
        </TouchableOpacity>
      )}
    />
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.lg,
    flexGrow: 1,
  },
  empty: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: SPACING.xxl,
  },
  emptyText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  card: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    ...SHADOWS.sm,
  },
  cardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  cardTitle: {
    flex: 1,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginRight: SPACING.sm,
  },
  cardFecha: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
  },
  cardBeneficiario: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
  cardDesc: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  cardFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: SPACING.xs,
    paddingTop: SPACING.xs,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  estadoWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  estadoDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginRight: 6,
  },
  cardAutor: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
  },
  pdfBtn: {
    backgroundColor: COLORS.primary + '15',
    borderRadius: BORDER_RADIUS.sm,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
    minWidth: 60,
    alignItems: 'center',
  },
  pdfBtnText: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.medium,
    color: COLORS.primary,
  },
  cardEliminando: {
    opacity: 0.5,
  },
  hintEliminar: {
    fontSize: 10,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.xs,
  },
});

export default SeguimientoListScreen;
