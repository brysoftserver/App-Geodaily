// ============================================================
// GEODAILY — Detalle de Seguimiento
// ============================================================
// Vista de un seguimiento ya guardado — equivalente al "Ver" del
// formulario del técnico: toda la información capturada, con
// exportación a PDF y apertura de evidencias.
//
// Además, el autor (coordinador/interventor) y los roles supervisores
// (admin/coordinador/interventor) pueden CORREGIR/COMPLETAR el
// seguimiento terminado: textos, georreferenciación, fotos, videos y
// firmas — mismo espíritu que el «✎ Corregir» del formulario del técnico.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  ScrollView,
  Image,
  TouchableOpacity,
  StyleSheet,
  Modal,
  Pressable,
  ActivityIndicator,
  Alert,
  TextInput,
  Platform,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import * as ImagePicker from 'expo-image-picker';
import { Calendar, DateData, LocaleConfig } from 'react-native-calendars';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS, API_CONFIG } from '../../theme';
import { getSeguimientoLocalById, saveSeguimientoLocal, SeguimientoLocal, FotoSeguimientoLocal } from '../../services/database';
import { fetchDocumentosDeFormulario, DocumentoDeFormulario } from '../../services/documentos.service';
import { cabecerasDeArchivo, fuenteConAuth } from '../../services/archivos.service';
import { actualizarPdfSeguimiento, actualizarSeguimiento } from '../../services/seguimientos.service';
import { generarPDFSeguimiento, construirHtmlSeguimiento, DatosPDFSeguimiento } from '../../services/pdfLocal.service';
import { abrirVentanaDeCarga, imprimirHtmlEnVentana } from '../../utils/printWeb';
import { persistirEvidencia, eliminarArchivoLocal } from '../../services/mediaStorage.service';
import { formatFecha, getLocalDateString } from '../../utils/formatters';
import { useAuth } from '../../store/AuthContext';
import { useSync } from '../../store/SyncContext';
import MapViewOffline from '../../components/MapViewOffline';
import VideoPlayerModal from '../../components/VideoPlayerModal';
import LoadingSpinner from '../../components/LoadingSpinner';
import CapturaGPSPrecisa from '../../components/CapturaGPSPrecisa';

type SeguimientoDetailScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
  route: { params: { seguimientoId: string } };
};

/** Campos de texto editables del seguimiento. */
type CampoTexto = 'actividad' | 'objetivo_visita' | 'descripcion_actividad' | 'observaciones';

const ETIQUETA_CAMPO: Record<CampoTexto, string> = {
  actividad: 'Título de la visita',
  objetivo_visita: 'Objetivo de la Visita',
  descripcion_actividad: 'Descripción de la Actividad',
  observaciones: 'Observaciones',
};

// Español para el selector de fecha (idempotente: si CalendarioGlobalScreen ya
// lo configuró, simplemente se reescribe con los mismos valores).
LocaleConfig.locales['es'] = {
  monthNames: [
    'Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio',
    'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre',
  ],
  monthNamesShort: ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'],
  dayNames: ['Domingo', 'Lunes', 'Martes', 'Miércoles', 'Jueves', 'Viernes', 'Sábado'],
  dayNamesShort: ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'],
  today: 'Hoy',
};
LocaleConfig.defaultLocale = 'es';

const SeguimientoDetailScreen: React.FC<SeguimientoDetailScreenProps> = ({ route }) => {
  const { seguimientoId } = route.params;
  const insets = useSafeAreaInsets();
  const { puedeEditarSeguimiento } = useAuth();
  const { syncNow } = useSync();

  const [seguimiento, setSeguimiento] = useState<SeguimientoLocal | null>(null);
  const [documentos, setDocumentos] = useState<DocumentoDeFormulario[]>([]);
  const [headersArchivo, setHeadersArchivo] = useState<Record<string, string>>({});
  const [cargando, setCargando] = useState(true);
  const [imagenAmpliada, setImagenAmpliada] = useState<{ uri: string; headers?: Record<string, string>; titulo: string } | null>(null);
  const [videoPreview, setVideoPreview] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  const [abriendoDocId, setAbriendoDocId] = useState<string | null>(null);
  const [generandoPDF, setGenerandoPDF] = useState(false);

  // --- Edición ---
  const [editando, setEditando] = useState(false);
  const [guardando, setGuardando] = useState(false);
  const [campoEditando, setCampoEditando] = useState<{ campo: CampoTexto; valor: string } | null>(null);
  const [mostrarGPS, setMostrarGPS] = useState(false);
  const [mostrarFecha, setMostrarFecha] = useState(false);
  const [capturandoEvidencia, setCapturandoEvidencia] = useState(false);

  const cargarDatos = useCallback(async () => {
    const [local, headers] = await Promise.all([
      getSeguimientoLocalById(seguimientoId),
      cabecerasDeArchivo(),
    ]);
    setSeguimiento(local);
    setHeadersArchivo(headers);
    try {
      const docs = await fetchDocumentosDeFormulario(seguimientoId);
      setDocumentos(docs);
    } catch {
      // sin conexión — se queda sin documentos remotos, no bloquea la vista
    }
    setCargando(false);
  }, [seguimientoId]);

  useEffect(() => {
    cargarDatos();
  }, [cargarDatos]);

  const rolLabel = seguimiento?.autor_rol === 'interventor' ? 'Interventoría' : 'Coordinación';

  /**
   * Fuente de una foto/video. Se prioriza SIEMPRE el archivo_id remoto cuando
   * existe: el `uri` guardado en el JSON es la ruta local del dispositivo que
   * capturó, que NO existe en otros dispositivos (por eso las fotos/videos no
   * se veían al abrir el seguimiento desde otro teléfono). El `uri` local solo
   * se usa como respaldo cuando aún no hay archivo_id (borrador sin sincronizar).
   */
  const fuenteDe = (item: FotoSeguimientoLocal): { uri: string; headers: Record<string, string> } => {
    if (item.archivo_id) {
      return fuenteConAuth(`${API_CONFIG.BASE_URL}/api/archivos/${item.archivo_id}/contenido`, headersArchivo);
    }
    return { uri: item.uri, headers: {} };
  };

  /** Firma: 'data:...' local o archivo_id remoto. */
  const fuenteFirma = (valor?: string): { uri: string; headers: Record<string, string> } | null => {
    if (!valor) return null;
    if (valor.startsWith('data:')) return { uri: valor, headers: {} };
    return fuenteConAuth(`${API_CONFIG.BASE_URL}/api/archivos/${valor}/contenido`, headersArchivo);
  };

  const abrirDocumento = async (doc: DocumentoDeFormulario) => {
    setAbriendoDocId(doc.id);
    try {
      const url = doc.url.startsWith('http') ? doc.url : `${API_CONFIG.BASE_URL}${doc.url}`;
      const extension = doc.nombre.includes('.') ? doc.nombre.split('.').pop() : 'dat';
      const destino = `${FileSystem.cacheDirectory}doc_seguimiento_${doc.id}.${extension}`;
      const { uri } = await FileSystem.downloadAsync(url, destino, { headers: headersArchivo });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: doc.mimetype });
      } else {
        Alert.alert('Documento descargado', `Guardado en: ${uri}`);
      }
    } catch (error) {
      console.error('[SeguimientoDetail] No se pudo abrir el documento:', doc.id, error);
      Alert.alert('Error', 'No se pudo abrir el documento. Verifica tu conexión.');
    } finally {
      setAbriendoDocId(null);
    }
  };

  const exportarPDF = async () => {
    if (!seguimiento || generandoPDF) return;

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
    // detalle en vez del documento. Se abre el HTML institucional en una
    // pestaña y se imprime desde ahí (el usuario elige "Guardar como PDF").
    // La pestaña se abre SÍNCRONA, antes de cualquier await, para que el
    // navegador no la trate como pop-up.
    if (Platform.OS === 'web') {
      const ventana = abrirVentanaDeCarga();
      setGenerandoPDF(true);
      try {
        imprimirHtmlEnVentana(ventana, await construirHtmlSeguimiento(datos));
      } catch (error) {
        ventana?.close();
        Alert.alert('Error', error instanceof Error ? error.message : 'No se pudo generar el PDF.');
      } finally {
        setGenerandoPDF(false);
      }
      return;
    }

    setGenerandoPDF(true);
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
      setGenerandoPDF(false);
    }
  };

  // ------------------------------------------------------------------
  // Edición (corregir/completar) — autor + admin/coordinador/interventor
  // ------------------------------------------------------------------

  /**
   * Aplica un cambio al seguimiento: lo persiste localmente y, si ya estaba
   * sincronizado, lo marca como NO sincronizado para que el próximo ciclo lo
   * vuelva a subir (el servidor hace upsert por id, así que la corrección
   * reemplaza la versión anterior). Si hay red, además se envía de inmediato
   * para que el cambio se refleje sin esperar al ciclo de sincronización.
   *
   * IMPORTANTE: el registro solo se marca `sincronizado` cuando TODA su
   * evidencia (fotos/videos) ya tiene `archivo_id`, es decir, ya está en
   * MinIO. Antes bastaba con que el PATCH de un campo de texto respondiera
   * OK para marcar el seguimiento como sincronizado, y eso dejaba huérfana
   * para siempre cualquier foto/video que no hubiera logrado subir: como el
   * sincronizador solo mira los `sincronizado = 0`, la evidencia nunca se
   * reintentaba y el resto de dispositivos (admin/gerente) solo veía las
   * fotos que sí habían subido — el video se quedaba únicamente en el
   * teléfono que lo grabó. Ver SyncContext.sincronizarSeguimientos.
   */
  const aplicarCambio = useCallback(
    async (cambios: Partial<SeguimientoLocal>, camposServidor: Record<string, unknown>) => {
      if (!seguimiento) return;
      const actualizado: SeguimientoLocal = {
        ...seguimiento,
        ...cambios,
        sincronizado: false,
        updated_at: new Date().toISOString(),
      };
      await saveSeguimientoLocal(actualizado);
      setSeguimiento(actualizado);

      const evidenciaPendiente = [...(actualizado.fotos || []), ...(actualizado.videos || [])].some(
        (e) => !e.archivo_id
      );

      // Sin campos de servidor (p. ej. se agregó evidencia que debe subir el
      // sincronizador para obtener su archivo_id) no hay nada que enviar.
      if (Object.keys(camposServidor || {}).length === 0) return;

      // Envío inmediato (best-effort): si falla, el ciclo de sync lo reintenta.
      try {
        const respuestaServidor = await actualizarSeguimiento(seguimiento.id, camposServidor as any);
        // Se adopta el `updated_at` que devolvió el servidor (NOW() en la BD).
        // Es clave para la persistencia: el merge del listado solo pisa la
        // fila local cuando su `updated_at` difiere del remoto, así que sin
        // esto la corrección recién guardada quedaba con la marca de tiempo
        // del teléfono, el merge creía que había "algo nuevo" y bajaba la
        // copia del servidor — pisando justo lo que se acababa de corregir
        // cuando el servidor todavía no tenía el campo (p. ej. la fecha).
        const confirmado: SeguimientoLocal = {
          ...actualizado,
          updated_at: respuestaServidor?.updated_at || actualizado.updated_at,
          // Si aún queda evidencia sin archivo_id, el seguimiento se conserva
          // como NO sincronizado para que el ciclo vuelva a subirla.
          sincronizado: !evidenciaPendiente,
        };
        await saveSeguimientoLocal(confirmado);
        setSeguimiento(confirmado);
      } catch (error) {
        console.warn('[SeguimientoDetail] Edición guardada localmente, se subirá al sincronizar:', error);
      }
    },
    [seguimiento]
  );

  const guardarCampoTexto = useCallback(async () => {
    if (!campoEditando || !seguimiento) return;
    const valor = campoEditando.valor.trim();
    if (campoEditando.campo === 'actividad' && !valor) {
      Alert.alert('Campo obligatorio', 'La actividad no puede quedar vacía.');
      return;
    }
    setGuardando(true);
    try {
      await aplicarCambio(
        { [campoEditando.campo]: valor || undefined } as Partial<SeguimientoLocal>,
        { [campoEditando.campo]: valor }
      );
      setCampoEditando(null);
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'No se pudo guardar el cambio.');
    } finally {
      setGuardando(false);
    }
  }, [campoEditando, seguimiento, aplicarCambio]);

  /**
   * Corregir la fecha de la visita. El calendario entrega 'YYYY-MM-DD' en hora
   * local; se conserva la hora original del registro y solo se reemplaza el
   * día, para no inventar una hora distinta a la de la visita.
   */
  const guardarFecha = useCallback(
    async (fechaSeleccionada: string) => {
      if (!seguimiento) return;
      const [anio, mes, dia] = fechaSeleccionada.split('-').map(Number);
      const base = new Date(seguimiento.created_at);
      const nueva = new Date(
        anio,
        (mes || 1) - 1,
        dia || 1,
        base.getHours(),
        base.getMinutes(),
        base.getSeconds(),
        base.getMilliseconds()
      );
      if (Number.isNaN(nueva.getTime())) return;
      const iso = nueva.toISOString();
      setMostrarFecha(false);
      setGuardando(true);
      try {
        await aplicarCambio({ created_at: iso }, { created_at: iso });
      } catch (error) {
        Alert.alert('Error', error instanceof Error ? error.message : 'No se pudo guardar la fecha.');
      } finally {
        setGuardando(false);
      }
    },
    [seguimiento, aplicarCambio]
  );

  const guardarUbicacion = useCallback(
    async (lat: string, lon: string, alt: string, precision: string) => {
      setMostrarGPS(false);
      await aplicarCambio(
        {
          geo_latitud: Number(lat),
          geo_longitud: Number(lon),
          geo_altitud: alt ? Number(alt) : undefined,
          geo_precision: precision ? Number(precision) : undefined,
        },
        {
          geo_latitud: Number(lat),
          geo_longitud: Number(lon),
          geo_altitud: alt ? Number(alt) : null,
          geo_precision: precision ? Number(precision) : null,
        }
      );
    },
    [aplicarCambio]
  );

  const agregarFoto = useCallback(async () => {
    if (!seguimiento || capturandoEvidencia) return;
    setCapturandoEvidencia(true);
    try {
      const permiso = await ImagePicker.requestCameraPermissionsAsync();
      if (!permiso.granted) {
        Alert.alert('Permiso de cámara', 'Se necesita el permiso de cámara para agregar fotos.');
        return;
      }
      const resultado = await ImagePicker.launchCameraAsync({ quality: 0.7 });
      if (resultado.canceled || !resultado.assets?.[0]) return;
      const id = `foto_${Date.now()}`;
      const uri = await persistirEvidencia(resultado.assets[0].uri, id, false);
      const nuevas = [...seguimiento.fotos, { id, uri }];
      // Sin campos de servidor a propósito: el PATCH no puede subir el
      // archivo a MinIO, solo guardaría la ruta local del teléfono (inútil en
      // los demás dispositivos). Se deja el seguimiento pendiente y se dispara
      // el sincronizador, que sube la evidencia y obtiene su archivo_id.
      await aplicarCambio({ fotos: nuevas }, {});
      syncNow().catch(() => { /* el ciclo de sync lo reintenta */ });
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'No se pudo agregar la foto.');
    } finally {
      setCapturandoEvidencia(false);
    }
  }, [seguimiento, capturandoEvidencia, aplicarCambio, syncNow]);

  const quitarFoto = useCallback(
    (foto: FotoSeguimientoLocal) => {
      if (!seguimiento) return;
      Alert.alert('Eliminar foto', '¿Quitar esta foto del seguimiento?', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            const nuevas = seguimiento.fotos.filter((f) => f.id !== foto.id);
            if (!foto.archivo_id) await eliminarArchivoLocal(foto.uri);
            await aplicarCambio({ fotos: nuevas }, { fotos: nuevas.map((f) => ({ archivo_id: f.archivo_id, uri: f.uri })) });
          },
        },
      ]);
    },
    [seguimiento, aplicarCambio]
  );

  const agregarVideo = useCallback(async () => {
    if (!seguimiento || capturandoEvidencia) return;
    setCapturandoEvidencia(true);
    try {
      const permiso = await ImagePicker.requestCameraPermissionsAsync();
      if (!permiso.granted) {
        Alert.alert('Permiso de cámara', 'Se necesita el permiso de cámara para grabar video.');
        return;
      }
      const resultado = await ImagePicker.launchCameraAsync({ mediaTypes: ImagePicker.MediaTypeOptions.Videos, videoMaxDuration: 60 });
      if (resultado.canceled || !resultado.assets?.[0]) return;
      const id = `video_${Date.now()}`;
      const uri = await persistirEvidencia(resultado.assets[0].uri, id, true);
      const nuevos = [...seguimiento.videos, { id, uri }];
      // Igual que en agregarFoto: el archivo lo sube el sincronizador (es el
      // único que obtiene el archivo_id de MinIO). Si se enviara aquí, el
      // servidor guardaría solo la ruta local del teléfono y los demás
      // dispositivos verían el video roto o ausente.
      await aplicarCambio({ videos: nuevos }, {});
      syncNow().catch(() => { /* el ciclo de sync lo reintenta */ });
    } catch (error) {
      Alert.alert('Error', error instanceof Error ? error.message : 'No se pudo grabar el video.');
    } finally {
      setCapturandoEvidencia(false);
    }
  }, [seguimiento, capturandoEvidencia, aplicarCambio, syncNow]);

  const quitarVideo = useCallback(
    (video: FotoSeguimientoLocal) => {
      if (!seguimiento) return;
      Alert.alert('Eliminar video', '¿Quitar este video del seguimiento?', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            const nuevos = seguimiento.videos.filter((v) => v.id !== video.id);
            if (!video.archivo_id) await eliminarArchivoLocal(video.uri);
            await aplicarCambio({ videos: nuevos }, { videos: nuevos.map((v) => ({ archivo_id: v.archivo_id, uri: v.uri })) });
          },
        },
      ]);
    },
    [seguimiento, aplicarCambio]
  );

  const quitarFirma = useCallback(
    (tipo: 'beneficiario' | 'autor') => {
      if (!seguimiento) return;
      Alert.alert('Eliminar firma', '¿Quitar esta firma del seguimiento?', [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            const campo = tipo === 'beneficiario' ? 'firma_beneficiario' : 'firma_autor';
            await aplicarCambio({ [campo]: undefined } as Partial<SeguimientoLocal>, { [campo]: null });
          },
        },
      ]);
    },
    [seguimiento, aplicarCambio]
  );

  if (cargando) {
    return <LoadingSpinner message="Cargando seguimiento..." fullScreen />;
  }

  if (!seguimiento) {
    return (
      <View style={styles.notFound}>
        <Text style={styles.notFoundText}>No se encontró este seguimiento en el dispositivo.</Text>
      </View>
    );
  }

  const geoPoint = seguimiento.geo_latitud != null && seguimiento.geo_longitud != null
    ? { latitud: seguimiento.geo_latitud, longitud: seguimiento.geo_longitud }
    : null;

  return (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SPACING.xxl }]}>
      {/* Encabezado */}
      <View style={styles.section}>
        <View style={styles.headerRow}>
          <View style={styles.actividadWrap}>
            <Text style={styles.actividad}>{seguimiento.actividad}</Text>
            {editando && (
              <TouchableOpacity onPress={() => setCampoEditando({ campo: 'actividad', valor: seguimiento.actividad })}>
                <Text style={styles.editLink}>✎ Editar título</Text>
              </TouchableOpacity>
            )}
          </View>
          <View style={[styles.estadoBadge, { backgroundColor: (seguimiento.sincronizado ? COLORS.success : COLORS.warning) + '20' }]}>
            <View style={[styles.estadoDot, { backgroundColor: seguimiento.sincronizado ? COLORS.success : COLORS.warning }]} />
            <Text style={[styles.estadoText, { color: seguimiento.sincronizado ? COLORS.success : COLORS.warning }]}>
              {seguimiento.sincronizado ? 'Sincronizado' : 'Pendiente de subir'}
            </Text>
          </View>
        </View>
        <Text style={styles.metaText}>👤 {seguimiento.autor_nombre} — {rolLabel}</Text>
        <View style={styles.fechaRow}>
          <Text style={styles.metaText}>📅 {formatFecha(seguimiento.created_at)}</Text>
          {editando && (
            <TouchableOpacity onPress={() => setMostrarFecha(true)}>
              <Text style={styles.editLink}>✎ Editar</Text>
            </TouchableOpacity>
          )}
        </View>
        {seguimiento.beneficiario_nombre ? (
          <Text style={styles.metaText}>🏡 {seguimiento.beneficiario_nombre}</Text>
        ) : null}
        {puedeEditarSeguimiento && (
          <TouchableOpacity
            style={[styles.editToggle, editando && styles.editToggleActivo]}
            onPress={() => setEditando((v) => !v)}
            activeOpacity={0.8}
          >
            <Text style={[styles.editToggleText, editando && styles.editToggleTextActivo]}>
              {editando ? '✓ Terminar edición' : '✎ Corregir / completar'}
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Objetivo / Descripción / Observaciones */}
      <View style={styles.section}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>🎯 Objetivo de la Visita</Text>
          {editando && (
            <TouchableOpacity onPress={() => setCampoEditando({ campo: 'objetivo_visita', valor: seguimiento.objetivo_visita || '' })}>
              <Text style={styles.editLink}>✎ Editar</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.bodyText}>{seguimiento.objetivo_visita?.trim() || 'Sin objetivo registrado'}</Text>
      </View>
      <View style={styles.section}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>📝 Descripción de la Actividad</Text>
          {editando && (
            <TouchableOpacity onPress={() => setCampoEditando({ campo: 'descripcion_actividad', valor: seguimiento.descripcion_actividad || '' })}>
              <Text style={styles.editLink}>✎ Editar</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.bodyText}>{seguimiento.descripcion_actividad?.trim() || 'Sin descripción registrada'}</Text>
      </View>
      <View style={styles.section}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>💬 Observaciones</Text>
          {editando && (
            <TouchableOpacity onPress={() => setCampoEditando({ campo: 'observaciones', valor: seguimiento.observaciones || '' })}>
              <Text style={styles.editLink}>✎ Editar</Text>
            </TouchableOpacity>
          )}
        </View>
        <Text style={styles.bodyText}>{seguimiento.observaciones?.trim() || 'Sin observaciones'}</Text>
      </View>

      {/* Evidencias */}
      <View style={styles.section}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>📷 Fotos</Text>
          {editando && (
            <TouchableOpacity onPress={agregarFoto} disabled={capturandoEvidencia}>
              <Text style={styles.editLink}>＋ Agregar</Text>
            </TouchableOpacity>
          )}
        </View>
        {seguimiento.fotos.length === 0 ? (
          <Text style={styles.noData}>No se registraron fotos</Text>
        ) : (
          <View style={styles.fotosGrid}>
            {seguimiento.fotos.map((f, idx) => {
              const fuente = fuenteDe(f);
              return (
                <View key={f.id} style={styles.evidenciaWrap}>
                  <TouchableOpacity
                    onPress={() => setImagenAmpliada({ ...fuente, titulo: `Foto ${idx + 1}` })}
                    activeOpacity={0.8}
                  >
                    <Image source={fuente} style={styles.fotoThumb} />
                  </TouchableOpacity>
                  {editando && (
                    <TouchableOpacity style={styles.evidenciaQuitar} onPress={() => quitarFoto(f)}>
                      <Text style={styles.evidenciaQuitarText}>✕</Text>
                    </TouchableOpacity>
                  )}
                </View>
              );
            })}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <View style={styles.sectionTitleRow}>
          <Text style={styles.sectionTitle}>🎥 Video</Text>
          {editando && (
            <TouchableOpacity onPress={agregarVideo} disabled={capturandoEvidencia}>
              <Text style={styles.editLink}>＋ Agregar</Text>
            </TouchableOpacity>
          )}
        </View>
        {seguimiento.videos.length === 0 ? (
          <Text style={styles.noData}>No se grabó video</Text>
        ) : (
          <View style={styles.fotosGrid}>
            {seguimiento.videos.map((v, idx) => (
              <View key={v.id} style={styles.evidenciaWrap}>
                <TouchableOpacity
                  style={styles.videoThumb}
                  onPress={() => setVideoPreview(fuenteDe(v))}
                  activeOpacity={0.8}
                >
                  <Text style={styles.videoThumbIcon}>▶️</Text>
                  <Text style={styles.videoThumbLabel}>Video {idx + 1}</Text>
                </TouchableOpacity>
                {editando && (
                  <TouchableOpacity style={styles.evidenciaQuitar} onPress={() => quitarVideo(v)}>
                    <Text style={styles.evidenciaQuitarText}>✕</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}
          </View>
        )}
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>✍️ Firmas</Text>
        <View style={styles.firmasRow}>
          <View style={styles.firmaCol}>
            <Text style={styles.firmaLabel}>Beneficiario</Text>
            {(() => {
              const fuente = fuenteFirma(seguimiento.firma_beneficiario);
              return fuente ? <Image source={fuente} style={styles.firmaImg} /> : <Text style={styles.noData}>Sin firma</Text>;
            })()}
            {editando && seguimiento.firma_beneficiario ? (
              <TouchableOpacity onPress={() => quitarFirma('beneficiario')}>
                <Text style={styles.editLinkDanger}>✕ Quitar firma</Text>
              </TouchableOpacity>
            ) : null}
          </View>
          <View style={styles.firmaCol}>
            <Text style={styles.firmaLabel}>{rolLabel}</Text>
            {(() => {
              const fuente = fuenteFirma(seguimiento.firma_autor);
              return fuente ? <Image source={fuente} style={styles.firmaImg} /> : <Text style={styles.noData}>Sin firma</Text>;
            })()}
            {editando && seguimiento.firma_autor ? (
              <TouchableOpacity onPress={() => quitarFirma('autor')}>
                <Text style={styles.editLinkDanger}>✕ Quitar firma</Text>
              </TouchableOpacity>
            ) : null}
          </View>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>🖐️ Huella Biométrica</Text>
        <Text style={styles.bodyText}>{seguimiento.huella_beneficiario ? '✅ Verificada' : 'No registrada'}</Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>📄 Documentos</Text>
        {documentos.length === 0 ? (
          <Text style={styles.noData}>Sin documentos adjuntos</Text>
        ) : (
          <View style={styles.chipsWrap}>
            {documentos.map((d) => (
              <TouchableOpacity key={d.id} style={styles.chip} onPress={() => abrirDocumento(d)} disabled={abriendoDocId === d.id}>
                <Text style={styles.chipText} numberOfLines={1}>
                  📄 {d.nombre} — {abriendoDocId === d.id ? 'abriendo…' : 'toca para abrir'}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
      </View>

      {geoPoint && (
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>📍 Ubicación</Text>
            {editando && (
              <TouchableOpacity onPress={() => setMostrarGPS(true)}>
                <Text style={styles.editLink}>🔄 Recapturar</Text>
              </TouchableOpacity>
            )}
          </View>
          <Text style={styles.bodyText}>
            Lat: {geoPoint.latitud.toFixed(6)}  Lon: {geoPoint.longitud.toFixed(6)}
            {seguimiento.geo_altitud != null ? `  Alt: ${seguimiento.geo_altitud} m` : ''}
          </Text>
          <View style={styles.mapaContainer}>
            <MapViewOffline
              center={geoPoint}
              zoom={14}
              height={180}
              mapStyle="satelite"
              markers={[{ id: 'seguimiento', ...geoPoint, tipoIcono: 'pin', color: COLORS.primary }]}
              interactive={false}
            />
          </View>
        </View>
      )}

      {editando && !geoPoint && (
        <View style={styles.section}>
          <View style={styles.sectionTitleRow}>
            <Text style={styles.sectionTitle}>📍 Ubicación</Text>
            <TouchableOpacity onPress={() => setMostrarGPS(true)}>
              <Text style={styles.editLink}>📍 Capturar</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.noData}>Sin ubicación registrada</Text>
        </View>
      )}

      <TouchableOpacity style={styles.pdfBtnGrande} onPress={exportarPDF} disabled={generandoPDF}>
        {generandoPDF ? <ActivityIndicator color="#fff" /> : <Text style={styles.pdfBtnGrandeText}>📄 Exportar PDF</Text>}
      </TouchableOpacity>

      {/* Modal de edición de campo de texto */}
      <Modal visible={!!campoEditando} transparent animationType="fade" onRequestClose={() => setCampoEditando(null)}>
        <View style={styles.editModalOverlay}>
          <View style={styles.editModalCard}>
            <Text style={styles.editModalTitle}>
              {campoEditando ? ETIQUETA_CAMPO[campoEditando.campo] : ''}
            </Text>
            <TextInput
              style={styles.editModalInput}
              value={campoEditando?.valor ?? ''}
              onChangeText={(t) => setCampoEditando((prev) => (prev ? { ...prev, valor: t } : prev))}
              multiline
              autoFocus
              placeholder="Escribe aquí…"
              placeholderTextColor={COLORS.textLight}
            />
            <View style={styles.editModalActions}>
              <TouchableOpacity style={[styles.editModalBtn, styles.editModalBtnCancelar]} onPress={() => setCampoEditando(null)} disabled={guardando}>
                <Text style={styles.editModalBtnCancelarText}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.editModalBtn, styles.editModalBtnGuardar]} onPress={guardarCampoTexto} disabled={guardando}>
                {guardando ? <ActivityIndicator color="#fff" /> : <Text style={styles.editModalBtnGuardarText}>Guardar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Modal de recaptura GPS */}
      <Modal visible={mostrarGPS} transparent animationType="slide" onRequestClose={() => setMostrarGPS(false)}>
        <View style={styles.editModalOverlay}>
          <View style={styles.editModalCard}>
            <Text style={styles.editModalTitle}>📍 Recapturar ubicación</Text>
            <CapturaGPSPrecisa
              label="Nueva ubicación"
              latitud={seguimiento.geo_latitud != null ? String(seguimiento.geo_latitud) : undefined}
              longitud={seguimiento.geo_longitud != null ? String(seguimiento.geo_longitud) : undefined}
              altitud={seguimiento.geo_altitud != null ? String(seguimiento.geo_altitud) : undefined}
              precision={seguimiento.geo_precision != null ? String(seguimiento.geo_precision) : undefined}
              ubicacionTexto={seguimiento.beneficiario_nombre}
              onCapture={guardarUbicacion}
            />
            <TouchableOpacity style={[styles.editModalBtn, styles.editModalBtnCancelar]} onPress={() => setMostrarGPS(false)}>
              <Text style={styles.editModalBtnCancelarText}>Cerrar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Modal de edición de fecha */}
      <Modal visible={mostrarFecha} transparent animationType="fade" onRequestClose={() => setMostrarFecha(false)}>
        <View style={styles.editModalOverlay}>
          <View style={styles.editModalCard}>
            <Text style={styles.editModalTitle}>📅 Fecha de la visita</Text>
            <Text style={styles.fechaModalHint}>Fecha actual: {formatFecha(seguimiento.created_at)}</Text>
            <Calendar
              current={getLocalDateString(new Date(seguimiento.created_at))}
              onDayPress={(day: DateData) => guardarFecha(day.dateString)}
              markedDates={{
                [getLocalDateString(new Date(seguimiento.created_at))]: { selected: true, selectedColor: COLORS.primary },
              }}
              theme={{
                calendarBackground: '#FFFFFF',
                todayTextColor: COLORS.primary,
                selectedDayBackgroundColor: COLORS.primary,
                selectedDayTextColor: '#fff',
                arrowColor: COLORS.primary,
                monthTextColor: COLORS.textPrimary,
                textMonthFontWeight: 'bold',
              }}
            />
            <TouchableOpacity
              style={[styles.editModalBtn, styles.editModalBtnCancelar, styles.fechaModalCerrar]}
              onPress={() => setMostrarFecha(false)}
              disabled={guardando}
            >
              {guardando ? <ActivityIndicator color={COLORS.primary} /> : <Text style={styles.editModalBtnCancelarText}>Cerrar</Text>}
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Visor de foto ampliada */}
      <Modal visible={!!imagenAmpliada} transparent animationType="fade" onRequestClose={() => setImagenAmpliada(null)}>
        <Pressable style={styles.fotoModalOverlay} onPress={() => setImagenAmpliada(null)}>
          {imagenAmpliada && (
            <>
              <Image source={imagenAmpliada} style={styles.fotoModalImg} resizeMode="contain" />
              <Text style={styles.fotoModalHint}>Toca para cerrar</Text>
            </>
          )}
        </Pressable>
      </Modal>

      {/* Reproductor de video */}
      {videoPreview && (
        <VideoPlayerModal
          uri={videoPreview.uri}
          headers={videoPreview.headers}
          visible={!!videoPreview}
          onClose={() => setVideoPreview(null)}
        />
      )}
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
  notFound: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.xl,
  },
  notFoundText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  section: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primary,
    ...SHADOWS.sm,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: SPACING.xs,
    gap: SPACING.sm,
  },
  actividadWrap: {
    flex: 1,
  },
  actividad: {
    flex: 1,
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  fechaRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: SPACING.sm,
    marginTop: 2,
  },
  estadoBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: SPACING.sm,
    paddingVertical: 4,
    borderRadius: BORDER_RADIUS.full,
  },
  estadoDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    marginRight: 4,
  },
  estadoText: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.medium,
  },
  metaText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.primary,
    marginBottom: SPACING.sm,
  },
  bodyText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    lineHeight: 20,
  },
  noData: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
  },
  fotosGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.sm,
  },
  fotoThumb: {
    width: 100,
    height: 100,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.background,
  },
  videoThumb: {
    width: 100,
    height: 100,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.textPrimary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoThumbIcon: {
    fontSize: 28,
  },
  videoThumbLabel: {
    fontSize: FONTS.sizes.xs,
    color: '#fff',
    marginTop: 4,
  },
  firmasRow: {
    flexDirection: 'row',
    gap: SPACING.md,
  },
  firmaCol: {
    flex: 1,
  },
  firmaLabel: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  firmaImg: {
    width: '100%',
    height: 90,
    resizeMode: 'contain',
    backgroundColor: '#fff',
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
  },
  chip: {
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
    maxWidth: '100%',
  },
  chipText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textPrimary,
  },
  mapaContainer: {
    marginTop: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  pdfBtnGrande: {
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
    ...SHADOWS.md,
  },
  pdfBtnGrandeText: {
    color: '#fff',
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
  },
  fotoModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.9)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  fotoModalImg: {
    width: '100%',
    height: '80%',
  },
  fotoModalHint: {
    color: '#fff',
    fontSize: FONTS.sizes.sm,
    marginTop: SPACING.md,
  },
  editToggle: {
    marginTop: SPACING.sm,
    alignSelf: 'flex-start',
    paddingHorizontal: SPACING.md,
    paddingVertical: 6,
    borderRadius: BORDER_RADIUS.full,
    borderWidth: 1,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.primary + '10',
  },
  editToggleActivo: {
    backgroundColor: COLORS.primary,
  },
  editToggleText: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.primary,
  },
  editToggleTextActivo: {
    color: '#fff',
  },
  sectionTitleRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  editLink: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.primary,
  },
  editLinkDanger: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.error,
    marginTop: SPACING.xs,
  },
  evidenciaWrap: {
    position: 'relative',
  },
  evidenciaQuitar: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: COLORS.error,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  evidenciaQuitarText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: FONTS.weights.bold,
    lineHeight: 16,
  },
  editModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  editModalCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOWS.md,
  },
  editModalTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  editModalInput: {
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
    minHeight: 100,
    textAlignVertical: 'top',
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    backgroundColor: COLORS.background,
  },
  editModalActions: {
    flexDirection: 'row',
    gap: SPACING.sm,
    marginTop: SPACING.md,
  },
  editModalBtn: {
    flex: 1,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm + 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editModalBtnCancelar: {
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  editModalBtnCancelarText: {
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.semibold,
    fontSize: FONTS.sizes.sm,
  },
  editModalBtnGuardar: {
    backgroundColor: COLORS.primary,
  },
  editModalBtnGuardarText: {
    color: '#fff',
    fontWeight: FONTS.weights.bold,
    fontSize: FONTS.sizes.sm,
  },
  fechaModalHint: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
  },
  fechaModalCerrar: {
    marginTop: SPACING.md,
  },
});

export default SeguimientoDetailScreen;
