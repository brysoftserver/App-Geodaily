// ============================================================
// GEODAILY — Sección de Seguimiento (Coordinación / Interventoría)
// ============================================================
// Formulario propio del rol superior para registrar su acompañamiento en
// campo: NO depende del formulario del técnico como requisito y funciona
// OFFLINE — se guarda de inmediato en SQLite local y SyncContext lo sube al
// servidor apenas haya conexión.
//
// ESTE componente es la sección reutilizable (campos + Cuadro de Evidencias
// + Ubicación + botón guardar) y NO incluye ScrollView ni
// KeyboardAvoidingView, para poder renderizarla:
//   1. Como pantalla completa  → src/screens/supervision/SeguimientoFormScreen
//      (que aporta el ScrollView/KeyboardAvoidingView).
//   2. Incrustada al final del detalle de un formulario en modo "campo"
//      → src/screens/terreno/FormularioDetailScreen (aprovecha su ScrollView,
//      evitando el anidamiento de scrolls).
//
// Cuadro de Evidencias replica EXACTAMENTE el mismo set que usa el
// Formulario 1 (Caracterización): Fotos, Video, Firma del Beneficiario,
// Firma de quien registra el seguimiento, Huella Biométrica y Documentos —
// con la Ubicación (misma captura GPS de 8s que la pregunta 20) al final.
//
// Autoguardado: borrador cada 20s, al pasar la app a segundo plano y al
// desmontarse. Mientras no se presione "Guardar Seguimiento" el registro
// queda marcado como incompleto (completado=false) y aparece en
// "Seguimientos Incompletos" en vez del listado de terminados — y nunca
// se sincroniza con el servidor hasta completarse.
//
// Durabilidad de las evidencias: fotos, videos y documentos se copian a
// documentDirectory/evidencias/ (persistirEvidencia) apenas se capturan,
// porque la cámara escribe en el directorio de CACHÉ del sistema y Android
// puede vaciarlo sin avisar cuando se queda sin espacio. Antes solo los
// documentos eran persistentes: el borrador se recuperaba al reabrir, pero
// las fotos y videos podían quedar rotos si Android limpiaba la caché antes
// de sincronizar. Al descartar una evidencia se borra su archivo para no
// dejar huérfanos en disco (eliminarArchivoLocal).
//
// Vínculo con la visita: si se recibe `formularioId`, el seguimiento se
// guarda con ese id (columna formulario_id) junto con la cédula y el nombre
// del beneficiario, de modo que quede amarrado a esa visita y se pueda
// retomar el mismo registro cada vez que se abra.
// ============================================================

import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Alert,
  Modal,
  Pressable,
  Dimensions,
  AppState,
  ActivityIndicator,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as LocalAuthentication from 'expo-local-authentication';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../theme';
import { useAuth } from '../store/AuthContext';
import { useSync } from '../store/SyncContext';
import {
  saveSeguimientoLocal,
  getSeguimientoLocalById,
  getSeguimientoLocalPorFormulario,
  saveDocumentoLocal,
  getDocumentosDeBeneficiario,
  FotoSeguimientoLocal,
} from '../services/database';
import { persistirEvidencia, eliminarArchivoLocal } from '../services/mediaStorage.service';
import { DocumentoFinca } from '../types';
import SignaturePad from './SignaturePad';
import CapturaGPSPrecisa from './CapturaGPSPrecisa';
import LoadingSpinner from './LoadingSpinner';
import VideoPlayerModal from './VideoPlayerModal';

export type SeguimientoCoordinacionSectionProps = {
  /** Borrador/registro existente a retomar (pantalla "Seguimientos Incompletos"). */
  seguimientoId?: string;
  /** Visita (formulario del técnico) a la que se amarra el seguimiento. */
  formularioId?: string;
  /** Beneficiario de esa visita — se copia al seguimiento para que el registro quede identificado. */
  beneficiarioCedula?: string;
  beneficiarioNombre?: string;
  /** Se ejecuta cuando el usuario confirma el Alert de guardado terminado (la pantalla que lo contiene decide si navega atrás). */
  onGuardado?: () => void;
  /** true cuando se incrusta dentro de otra pantalla: agrega el título de la sección y no usa spinner de pantalla completa. */
  embedded?: boolean;
};

const generarId = () => `seg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const SeguimientoCoordinacionSection: React.FC<SeguimientoCoordinacionSectionProps> = ({
  seguimientoId,
  formularioId,
  beneficiarioCedula,
  beneficiarioNombre,
  onGuardado,
  embedded = false,
}) => {
  const { isInterventor, user } = useAuth();
  const { syncNow } = useSync();
  const insets = useSafeAreaInsets();
  const idRef = useRef(seguimientoId || generarId());
  const createdAtRef = useRef(new Date().toISOString());
  // Una vez el usuario presiona "Guardar Seguimiento", este flag queda en true
  // y el autoguardado deja de tocar el registro — así no lo vuelve a marcar
  // como incompleto (antes el guardado final al salir de la pantalla pisaba
  // completado=true con false y el seguimiento terminaba en "Incompletos").
  const completadoRef = useRef(false);
  const nombreRol = isInterventor ? 'Interventoría' : 'Coordinación';

  const [cargandoBorrador, setCargandoBorrador] = useState(!!(seguimientoId || formularioId));
  const [actividad, setActividad] = useState('');
  const [objetivoVisita, setObjetivoVisita] = useState('');
  const [descripcionActividad, setDescripcionActividad] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [fotos, setFotos] = useState<FotoSeguimientoLocal[]>([]);
  const [videos, setVideos] = useState<FotoSeguimientoLocal[]>([]);
  const [firmaBeneficiario, setFirmaBeneficiario] = useState<string | undefined>(undefined);
  const [firmaAutor, setFirmaAutor] = useState<string | undefined>(undefined);
  const [huellaBeneficiario, setHuellaBeneficiario] = useState(false);
  const [documentos, setDocumentos] = useState<DocumentoFinca[]>([]);
  const [padActivo, setPadActivo] = useState<'beneficiario' | 'autor' | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [verificandoHuella, setVerificandoHuella] = useState(false);

  // Visor de evidencias — foto a pantalla completa y reproductor de video,
  // igual que la cámara del Formulario 1: permite revisar que la foto/video
  // quedó bien antes de guardar el seguimiento.
  const [fotoPreview, setFotoPreview] = useState<FotoSeguimientoLocal | null>(null);
  const [videoPreview, setVideoPreview] = useState<FotoSeguimientoLocal | null>(null);

  // Georeferencia puntual (captura única de 8s de alta precisión) — igual
  // componente que la pregunta 20 del Formulario 1 (Caracterización).
  const [geoLatitud, setGeoLatitud] = useState('');
  const [geoLongitud, setGeoLongitud] = useState('');
  const [geoAltitud, setGeoAltitud] = useState('');
  const [geoPrecision, setGeoPrecision] = useState('');

  // ─── Cargar el seguimiento ya existente: por id (borrador abierto desde
  // "Seguimientos Incompletos") o por visita (cuando se entra a la revisión
  // en campo de un formulario que ya tenía su seguimiento empezado). ───
  useEffect(() => {
    let cancelado = false;
    (async () => {
      if (seguimientoId || formularioId) setCargandoBorrador(true);

      let draft: Awaited<ReturnType<typeof getSeguimientoLocalById>> = null;
      if (seguimientoId) {
        draft = await getSeguimientoLocalById(seguimientoId);
      } else if (formularioId) {
        draft = await getSeguimientoLocalPorFormulario(formularioId);
      }
      if (cancelado) return;

      // Estado limpio antes de hidratar — evita que queden datos de un
      // formulario distinto si esta sección se reutiliza para otro.
      setActividad('');
      setObjetivoVisita('');
      setDescripcionActividad('');
      setObservaciones('');
      setFotos([]);
      setVideos([]);
      setFirmaBeneficiario(undefined);
      setFirmaAutor(undefined);
      setHuellaBeneficiario(false);
      setGeoLatitud('');
      setGeoLongitud('');
      setGeoAltitud('');
      setGeoPrecision('');
      completadoRef.current = false;
      createdAtRef.current = new Date().toISOString();
      idRef.current = seguimientoId || generarId();

      if (draft) {
        idRef.current = draft.id;
        createdAtRef.current = draft.created_at;
        completadoRef.current = !!draft.completado;
        setActividad(draft.actividad || '');
        setObjetivoVisita(draft.objetivo_visita || '');
        setDescripcionActividad(draft.descripcion_actividad || '');
        setObservaciones(draft.observaciones || '');
        setFotos(draft.fotos || []);
        setVideos(draft.videos || []);
        setFirmaBeneficiario(draft.firma_beneficiario);
        setFirmaAutor(draft.firma_autor);
        setHuellaBeneficiario(!!draft.huella_beneficiario);
        setGeoLatitud(draft.geo_latitud != null ? String(draft.geo_latitud) : '');
        setGeoLongitud(draft.geo_longitud != null ? String(draft.geo_longitud) : '');
        setGeoAltitud(draft.geo_altitud != null ? String(draft.geo_altitud) : '');
        setGeoPrecision(draft.geo_precision != null ? String(draft.geo_precision) : '');
      }

      const docs = await getDocumentosDeBeneficiario(undefined, idRef.current);
      if (cancelado) return;
      setDocumentos(docs);
      setCargandoBorrador(false);
    })();
    return () => { cancelado = true; };
  }, [seguimientoId, formularioId]);

  /**
   * Persiste el estado actual localmente. `completado` solo es true cuando
   * se presiona "Guardar Seguimiento" — en cualquier otro caso (evidencia
   * capturada, autoguardado periódico, desmontaje) queda en false, así el
   * registro se ve como "Incompleto" y no se sincroniza todavía (mismo
   * criterio que FormDraftStore del técnico).
   */
  const guardarBorrador = async (cambios: {
    fotos?: FotoSeguimientoLocal[];
    videos?: FotoSeguimientoLocal[];
    firmaBeneficiario?: string;
    firmaAutor?: string;
    huella?: boolean;
    geo?: { latitud: string; longitud: string; altitud: string; precision: string };
    completado?: boolean;
  }): Promise<boolean> => {
    try {
      const geo = cambios.geo;
      await saveSeguimientoLocal({
        id: idRef.current,
        autor_id: user?.id || '',
        autor_nombre: user?.nombre || '',
        autor_rol: isInterventor ? 'interventor' : 'coordinador',
        // Vínculo con la visita y su beneficiario — quedan vacíos cuando el
        // seguimiento se hace desde la tarjeta general de inicio (no amarra
        // ningún beneficiario: sirve para ECA, viveros o visitas sin formulario).
        formulario_id: formularioId || undefined,
        beneficiario_cedula: beneficiarioCedula || undefined,
        beneficiario_nombre: beneficiarioNombre || undefined,
        actividad: actividad.trim(),
        objetivo_visita: objetivoVisita.trim() || undefined,
        descripcion_actividad: descripcionActividad.trim() || undefined,
        observaciones: observaciones.trim() || undefined,
        fotos: cambios.fotos ?? fotos,
        videos: cambios.videos ?? videos,
        firma_beneficiario: 'firmaBeneficiario' in cambios ? cambios.firmaBeneficiario : firmaBeneficiario,
        firma_autor: 'firmaAutor' in cambios ? cambios.firmaAutor : firmaAutor,
        huella_beneficiario: cambios.huella ?? huellaBeneficiario,
        geo_latitud: geo ? Number(geo.latitud) || undefined : (Number(geoLatitud) || undefined),
        geo_longitud: geo ? Number(geo.longitud) || undefined : (Number(geoLongitud) || undefined),
        geo_altitud: geo ? Number(geo.altitud) || undefined : (Number(geoAltitud) || undefined),
        geo_precision: geo ? Number(geo.precision) || undefined : (Number(geoPrecision) || undefined),
        sincronizado: false,
        completado: cambios.completado ?? completadoRef.current,
        created_at: createdAtRef.current,
        updated_at: new Date().toISOString(),
      });
      return true;
    } catch (error) {
      console.warn('[Seguimiento] No se pudo guardar el borrador local:', error);
      return false;
    }
  };

  // ─── Autoguardado silencioso — cada 20s, al pasar a segundo plano y al
  // desmontarse, igual que FormularioCaracterizacionScreen. ───
  const autoguardarRef = useRef<(() => Promise<void>) | null>(null);
  useEffect(() => {
    autoguardarRef.current = async () => {
      // Ya se guardó como terminado: no volver a escribir el registro.
      if (completadoRef.current) return;
      // Nada que guardar todavía: evita crear borradores vacíos.
      if (!actividad.trim() && fotos.length === 0 && videos.length === 0 && !firmaBeneficiario && !firmaAutor) {
        return;
      }
      await guardarBorrador({});
    };
  });

  useEffect(() => {
    const intervalo = setInterval(() => {
      autoguardarRef.current?.();
    }, 20000);

    const sub = AppState.addEventListener('change', (estado) => {
      if (estado === 'background' || estado === 'inactive') {
        autoguardarRef.current?.();
      }
    });

    return () => {
      clearInterval(intervalo);
      sub.remove();
      // Último guardado al salir de la pantalla.
      autoguardarRef.current?.();
    };
  }, []);

  const capturarUbicacion = async (latitud: string, longitud: string, altitud: string, precision: string) => {
    setGeoLatitud(latitud);
    setGeoLongitud(longitud);
    setGeoAltitud(altitud);
    setGeoPrecision(precision);
    if (!(await guardarBorrador({ geo: { latitud, longitud, altitud, precision } }))) {
      Alert.alert('Ubicación sin respaldo', 'La ubicación no quedó guardada localmente. Pulsa Guardar Seguimiento antes de salir.');
    }
  };

  const tomarFoto = async () => {
    const permiso = await ImagePicker.requestCameraPermissionsAsync();
    if (!permiso.granted) {
      Alert.alert('Permiso requerido', 'Se necesita acceso a la cámara para tomar la foto.');
      return;
    }
    const resultado = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (resultado.canceled || !resultado.assets?.[0]?.uri) return;

    // Igual que el técnico (useCamera): la cámara escribe en el directorio de
    // CACHÉ del sistema y Android puede vaciarlo sin avisar cuando se queda
    // sin espacio. Se copia a documentDirectory antes de registrar la foto,
    // porque el seguimiento puede quedar días sin sincronizar en campo.
    const fotoId = `foto-${Date.now()}`;
    const uriPersistente = await persistirEvidencia(resultado.assets[0].uri, fotoId);
    const nuevaFoto: FotoSeguimientoLocal = { id: fotoId, uri: uriPersistente };
    const fotosActualizadas = [...fotos, nuevaFoto];
    setFotos(fotosActualizadas);
    if (!(await guardarBorrador({ fotos: fotosActualizadas }))) {
      Alert.alert('Foto sin respaldo', 'La foto sigue en esta pantalla, pero no quedó registrada localmente. Guarda el seguimiento antes de salir.');
    }
  };

  const quitarFoto = async (id: string) => {
    const fotoQuitada = fotos.find((f) => f.id === id);
    const fotosActualizadas = fotos.filter((f) => f.id !== id);
    setFotos(fotosActualizadas);
    if (!(await guardarBorrador({ fotos: fotosActualizadas }))) {
      setFotos(fotos);
      Alert.alert('No se pudo quitar la foto', 'La actualización no quedó guardada; se conservó la evidencia local.');
      return;
    }
    // Liberar el archivo persistente: al vivir en documentDirectory (y no en
    // la caché, que Android vacía solo) una foto descartada quedaría huérfana
    // en disco para siempre si no se borra explícitamente.
    if (fotoQuitada?.uri) await eliminarArchivoLocal(fotoQuitada.uri);
  };

  const grabarVideo = async () => {
    const permiso = await ImagePicker.requestCameraPermissionsAsync();
    if (!permiso.granted) {
      Alert.alert('Permiso requerido', 'Se necesita acceso a la cámara para grabar el video.');
      return;
    }
    const resultado = await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: 30 });
    if (resultado.canceled || !resultado.assets?.[0]?.uri) return;

    // Mismo motivo que en tomarFoto: sacar el video de la caché del sistema
    // antes de registrarlo (esVideo=true para el respaldo de extensión .mp4).
    const videoId = `video-${Date.now()}`;
    const uriPersistente = await persistirEvidencia(resultado.assets[0].uri, videoId, true);
    const nuevoVideo: FotoSeguimientoLocal = { id: videoId, uri: uriPersistente };
    const videosActualizados = [...videos, nuevoVideo];
    setVideos(videosActualizados);
    if (!(await guardarBorrador({ videos: videosActualizados }))) {
      Alert.alert('Video sin respaldo', 'El video sigue en esta pantalla, pero no quedó registrado localmente. Guarda el seguimiento antes de salir.');
    }
  };

  const quitarVideo = async (id: string) => {
    const videoQuitado = videos.find((v) => v.id === id);
    const videosActualizados = videos.filter((v) => v.id !== id);
    setVideos(videosActualizados);
    if (!(await guardarBorrador({ videos: videosActualizados }))) {
      setVideos(videos);
      Alert.alert('No se pudo quitar el video', 'La actualización no quedó guardada; se conservó la evidencia local.');
      return;
    }
    // Mismo motivo que en quitarFoto. Los videos pesan mucho más, así que
    // dejarlos en disco sería peor.
    if (videoQuitado?.uri) await eliminarArchivoLocal(videoQuitado.uri);
  };

  const capturarFirma = async (tipo: 'beneficiario' | 'autor', sig: string) => {
    setPadActivo(null);
    if (tipo === 'beneficiario') {
      setFirmaBeneficiario(sig);
      if (!(await guardarBorrador({ firmaBeneficiario: sig }))) {
        Alert.alert('Firma sin respaldo', 'La firma no quedó guardada localmente. Guarda el seguimiento antes de salir.');
      }
    } else {
      setFirmaAutor(sig);
      if (!(await guardarBorrador({ firmaAutor: sig }))) {
        Alert.alert('Firma sin respaldo', 'La firma no quedó guardada localmente. Guarda el seguimiento antes de salir.');
      }
    }
  };

  // ─── Huella Biométrica — igual criterio que FirmaBiometricaScreen: el
  // sensor del teléfono solo puede validar la huella de quien lo sostiene
  // (aquí, el coordinador/interventor), no la del beneficiario. Certifica
  // presencia en la visita, sin PIN como atajo. ───
  const verificarHuella = async () => {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolada = await LocalAuthentication.isEnrolledAsync();
    if (!compatible || !enrolada) {
      Alert.alert('No disponible', 'Este dispositivo no tiene sensor biométrico o no hay huellas registradas.');
      return;
    }
    setVerificandoHuella(true);
    try {
      const resultado = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Confirma con tu huella que realizaste este seguimiento',
        cancelLabel: 'Cancelar',
        disableDeviceFallback: true,
      });
      if (resultado.success) {
        setHuellaBeneficiario(true);
        if (!(await guardarBorrador({ huella: true }))) {
          Alert.alert('Verificación sin respaldo', 'La confirmación biométrica no quedó guardada localmente. Guarda el seguimiento antes de salir.');
        }
      } else if (resultado.error !== 'user_cancel') {
        Alert.alert('Error', 'No se pudo autenticar la huella. Intenta de nuevo.');
      }
    } catch {
      Alert.alert('Error', 'Error al acceder al sensor biométrico.');
    } finally {
      setVerificandoHuella(false);
    }
  };

  // ─── Documentos — se guardan local primero (offline-safe) y SyncContext
  // los sube solo cuando hay señal (misma cola genérica que ya usa el
  // técnico para sus documentos). ───
  const agregarDocumento = async () => {
    try {
      const resultado = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });
      if (resultado.canceled || !resultado.assets?.[0]) return;

      const asset = resultado.assets[0];
      const esPdf = asset.name?.toLowerCase().endsWith('.pdf');
      const docId = `doc-${Date.now()}`;
      const nombreDoc = asset.name || `documento_${Date.now()}`;
      const uriPersistente = await persistirEvidencia(asset.uri, docId);

      const nuevoDoc: DocumentoFinca = {
        id: docId,
        formulario_id: idRef.current,
        tipo: esPdf ? 'pdf' : 'foto',
        uri: uriPersistente,
        nombre: nombreDoc,
        descripcion: `Seguimiento ${nombreRol}`,
        created_at: new Date().toISOString(),
      };
      await saveDocumentoLocal(nuevoDoc);
      setDocumentos((prev) => [nuevoDoc, ...prev]);
    } catch (error) {
      console.error('[Seguimiento] Error agregando documento:', error);
      Alert.alert('Error', 'No se pudo agregar el documento.');
    }
  };

  const guardar = async () => {
    if (!actividad.trim()) {
      Alert.alert('Falta información', 'La actividad es obligatoria.');
      return;
    }

    setGuardando(true);
    try {
      // Marcar como terminado ANTES de persistir: a partir de aquí el
      // autoguardado ya no puede revertirlo a "incompleto".
      completadoRef.current = true;
      const localGuardado = await guardarBorrador({ completado: true });
      if (!localGuardado) {
        completadoRef.current = false;
        Alert.alert('No se pudo guardar', 'El seguimiento no quedó guardado en este dispositivo. Libera espacio e inténtalo de nuevo.');
        return;
      }

      // Intento oportunista: si hay conexión, se sube de inmediato; si no,
      // SyncContext lo reintentará solo apenas vuelva la señal.
      syncNow().catch(() => { /* la cola reintenta */ });

      Alert.alert(
        '✅ Seguimiento guardado',
        'Quedó guardado en este dispositivo y se sincronizará automáticamente cuando haya conexión.',
        [{ text: 'OK', onPress: () => onGuardado?.() }]
      );
    } catch (error) {
      Alert.alert('No se pudo guardar', error instanceof Error ? error.message : String(error));
    } finally {
      setGuardando(false);
    }
  };

  if (cargandoBorrador) {
    return embedded
      ? <LoadingSpinner message="Cargando seguimiento..." />
      : <LoadingSpinner message="Cargando borrador..." fullScreen />;
  }

  return (
    <>
      {embedded && (
        <>
          <Text style={styles.seccionTitulo}>🛰️ Seguimiento de {nombreRol}</Text>
          <Text style={styles.seccionSubtitulo}>
            Registro de acompañamiento en campo de esta visita — se guarda sin conexión.{'\n'}
            {beneficiarioNombre ? `Beneficiario: ${beneficiarioNombre}` : 'Sin beneficiario asociado'}
          </Text>
        </>
      )}

      <Text style={styles.label}>Actividad *</Text>
      <TextInput
        style={styles.input}
        value={actividad}
        onChangeText={setActividad}
        placeholder="Ej. Visita de seguimiento al beneficiario"
        placeholderTextColor={COLORS.textSecondary}
      />

      <Text style={styles.label}>Objetivo de la visita</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={objetivoVisita}
        onChangeText={setObjetivoVisita}
        placeholder="¿Cuál es el propósito de esta visita?"
        placeholderTextColor={COLORS.textSecondary}
        multiline
        numberOfLines={3}
      />

      <Text style={styles.label}>Descripción de la actividad</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={descripcionActividad}
        onChangeText={setDescripcionActividad}
        placeholder="Describe lo realizado durante la visita"
        placeholderTextColor={COLORS.textSecondary}
        multiline
        numberOfLines={4}
      />

      <Text style={styles.label}>Observaciones</Text>
      <TextInput
        style={[styles.input, styles.textArea]}
        value={observaciones}
        onChangeText={setObservaciones}
        placeholder="Observaciones adicionales"
        placeholderTextColor={COLORS.textSecondary}
        multiline
        numberOfLines={3}
      />

      <Text style={styles.label}>Cuadro de Evidencias</Text>

      {/* Fotos */}
      <TouchableOpacity style={[styles.evidenciaCard, fotos.length > 0 && styles.evidenciaCardOk]} onPress={tomarFoto} activeOpacity={0.7}>
        <View style={styles.evidenciaIcon}>
          <Text style={styles.evidenciaIconText}>📷</Text>
        </View>
        <View style={styles.evidenciaContent}>
          <Text style={styles.evidenciaCardTitle}>Fotos de la evidencia</Text>
          <Text style={styles.evidenciaCardDesc}>
            {fotos.length > 0 ? `${fotos.length} foto(s) capturada(s) — toca para agregar otra` : 'Toca para tomar una foto'}
          </Text>
        </View>
        <Text style={styles.evidenciaArrow}>›</Text>
      </TouchableOpacity>
      {fotos.length > 0 && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.fotosRow}>
            {fotos.map((f) => (
              <View key={f.id} style={styles.fotoThumb}>
                <TouchableOpacity style={styles.fotoImgTap} onPress={() => setFotoPreview(f)} activeOpacity={0.8}>
                  <Image source={{ uri: f.uri }} style={styles.fotoImg} />
                </TouchableOpacity>
                <TouchableOpacity style={styles.fotoRemove} onPress={() => quitarFoto(f.id)}>
                  <Text style={styles.fotoRemoveText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
          <Text style={styles.previewHint}>👆 Toca una foto para verla en grande</Text>
        </>
      )}

      {/* Video */}
      <TouchableOpacity style={[styles.evidenciaCard, videos.length > 0 && styles.evidenciaCardOk]} onPress={grabarVideo} activeOpacity={0.7}>
        <View style={styles.evidenciaIcon}>
          <Text style={styles.evidenciaIconText}>🎥</Text>
        </View>
        <View style={styles.evidenciaContent}>
          <Text style={styles.evidenciaCardTitle}>Tomar Video</Text>
          <Text style={styles.evidenciaCardDesc}>
            {videos.length > 0 ? `${videos.length} video(s) grabado(s) — toca para agregar otro (máx. 30s)` : 'Grabar video corto (máx. 30s)'}
          </Text>
        </View>
        <Text style={styles.evidenciaArrow}>›</Text>
      </TouchableOpacity>
      {videos.length > 0 && (
        <>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.fotosRow}>
            {videos.map((v, idx) => (
              <View key={v.id} style={styles.videoThumbWrap}>
                <TouchableOpacity style={styles.videoThumb} onPress={() => setVideoPreview(v)} activeOpacity={0.8}>
                  <Text style={styles.videoThumbIcon}>▶️</Text>
                </TouchableOpacity>
                <Text style={styles.videoThumbLabel} numberOfLines={1}>Video {idx + 1}</Text>
                <TouchableOpacity style={styles.fotoRemove} onPress={() => quitarVideo(v.id)}>
                  <Text style={styles.fotoRemoveText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
          </ScrollView>
          <Text style={styles.previewHint}>👆 Toca un video para reproducirlo</Text>
        </>
      )}

      {/* Firma del Beneficiario */}
      <TouchableOpacity style={[styles.evidenciaCard, !!firmaBeneficiario && styles.evidenciaCardOk]} onPress={() => setPadActivo('beneficiario')} activeOpacity={0.7}>
        <View style={styles.evidenciaIcon}>
          <Text style={styles.evidenciaIconText}>✍️</Text>
        </View>
        <View style={styles.evidenciaContent}>
          <Text style={styles.evidenciaCardTitle}>Firma del Beneficiario</Text>
          <Text style={styles.evidenciaCardDesc}>
            {firmaBeneficiario ? 'Firma registrada ✓ — toca para rehacer' : 'Capturar firma del beneficiario'}
          </Text>
        </View>
        <Text style={styles.evidenciaArrow}>›</Text>
      </TouchableOpacity>
      {!!firmaBeneficiario && <Image source={{ uri: firmaBeneficiario }} style={styles.firmaPreview} />}

      {/* Firma del autor (Coordinación/Interventoría) */}
      <TouchableOpacity style={[styles.evidenciaCard, !!firmaAutor && styles.evidenciaCardOk]} onPress={() => setPadActivo('autor')} activeOpacity={0.7}>
        <View style={styles.evidenciaIcon}>
          <Text style={styles.evidenciaIconText}>🖊️</Text>
        </View>
        <View style={styles.evidenciaContent}>
          <Text style={styles.evidenciaCardTitle}>Firma de {nombreRol}</Text>
          <Text style={styles.evidenciaCardDesc}>
            {firmaAutor ? 'Firma registrada ✓ — toca para rehacer' : 'Capturar tu firma'}
          </Text>
        </View>
        <Text style={styles.evidenciaArrow}>›</Text>
      </TouchableOpacity>
      {!!firmaAutor && <Image source={{ uri: firmaAutor }} style={styles.firmaPreview} />}

      {/* Huella Biométrica */}
      <TouchableOpacity style={[styles.evidenciaCard, huellaBeneficiario && styles.evidenciaCardOk]} onPress={verificarHuella} activeOpacity={0.7} disabled={verificandoHuella}>
        <View style={styles.evidenciaIcon}>
          {verificandoHuella ? <ActivityIndicator size="small" color={COLORS.primary} /> : <Text style={styles.evidenciaIconText}>🖐️</Text>}
        </View>
        <View style={styles.evidenciaContent}>
          <Text style={styles.evidenciaCardTitle}>Huella Biométrica</Text>
          <Text style={styles.evidenciaCardDesc}>
            {huellaBeneficiario ? 'Huella registrada ✓' : 'Confirmar con tu huella que realizaste la visita'}
          </Text>
        </View>
        <Text style={styles.evidenciaArrow}>›</Text>
      </TouchableOpacity>

      {/* Documentos */}
      <TouchableOpacity style={[styles.evidenciaCard, documentos.length > 0 && styles.evidenciaCardOk]} onPress={agregarDocumento} activeOpacity={0.7}>
        <View style={styles.evidenciaIcon}>
          <Text style={styles.evidenciaIconText}>📄</Text>
        </View>
        <View style={styles.evidenciaContent}>
          <Text style={styles.evidenciaCardTitle}>Documentos</Text>
          <Text style={styles.evidenciaCardDesc}>
            {documentos.length > 0 ? `${documentos.length} documento(s) vinculado(s) ✓` : 'Subir PDF o foto'}
          </Text>
        </View>
        <Text style={styles.evidenciaArrow}>›</Text>
      </TouchableOpacity>
      {documentos.length > 0 && (
        <View style={styles.chipsWrap}>
          {documentos.map((d) => (
            <View key={d.id} style={styles.chip}>
              <Text style={styles.chipText} numberOfLines={1}>📄 {d.nombre}</Text>
            </View>
          ))}
        </View>
      )}

      {/* Ubicación — al final, mismo componente que la pregunta 20 del
          Formulario 1: botón con cuenta regresiva de 8s (se queda con la
          lectura GPS de mayor precisión) y, debajo, un mapa pequeño con
          el punto capturado. */}
      <View style={styles.ubicacionWrap}>
        <CapturaGPSPrecisa
          label="Ubicación"
          latitud={geoLatitud}
          longitud={geoLongitud}
          altitud={geoAltitud}
          precision={geoPrecision}
          onCapture={capturarUbicacion}
        />
      </View>

      <Text style={styles.avisoOffline}>
        📴 Funciona sin conexión — se guarda en el dispositivo y se sincroniza solo cuando haya señal.
      </Text>

      <TouchableOpacity
        style={[styles.guardarBtn, guardando && styles.guardarBtnDisabled]}
        onPress={guardar}
        disabled={guardando}
      >
        <Text style={styles.guardarBtnText}>{guardando ? 'Guardando…' : 'Guardar Seguimiento'}</Text>
      </TouchableOpacity>

      {/* Pantalla dedicada para firmar — Modal nativo, se dibuja por encima
          del contenedor para que el gesto de dibujar no se confunda con el
          scroll de la pantalla que lo contiene. */}
      <Modal visible={padActivo !== null} animationType="slide" onRequestClose={() => setPadActivo(null)}>
        <View style={[styles.firmaModalContainer, { paddingTop: insets.top + SPACING.sm }]}>
          <View style={styles.firmaModalHeader}>
            <Text style={styles.firmaModalTitle}>
              ✍️ {padActivo === 'beneficiario' ? 'Firma del Beneficiario' : `Firma de ${nombreRol}`}
            </Text>
            <TouchableOpacity onPress={() => setPadActivo(null)}>
              <Text style={styles.firmaModalClose}>✕ Cerrar</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.hint}>Dibuja la firma con el dedo dentro del recuadro blanco.</Text>
          {padActivo && (
            <SignaturePad
              key={padActivo}
              onOK={(sig) => capturarFirma(padActivo, sig)}
              description={padActivo === 'beneficiario' ? 'Firma del beneficiario' : `Firma de ${nombreRol}`}
              containerStyle={styles.firmaModalPadContainer}
              height={Dimensions.get('window').height * 0.45}
            />
          )}
        </View>
      </Modal>

      {/* Visor de foto a pantalla completa — mismo patrón que la cámara del
          Formulario 1: toca la miniatura para revisar que la foto quedó bien. */}
      <Modal
        visible={!!fotoPreview}
        transparent
        animationType="fade"
        onRequestClose={() => setFotoPreview(null)}
      >
        <Pressable style={styles.visorOverlay} onPress={() => setFotoPreview(null)}>
          {fotoPreview && (
            <Pressable style={styles.visorContent} onPress={() => {}}>
              <Image source={{ uri: fotoPreview.uri }} style={styles.visorImage} resizeMode="contain" />
              <TouchableOpacity style={styles.visorCloseBtn} onPress={() => setFotoPreview(null)}>
                <Text style={styles.visorCloseText}>✕ Cerrar</Text>
              </TouchableOpacity>
            </Pressable>
          )}
        </Pressable>
      </Modal>

      {/* Reproductor de video — mismo componente compartido que usa la cámara
          del Formulario 1 y el detalle de un formulario completado. */}
      <VideoPlayerModal
        uri={videoPreview?.uri ?? null}
        visible={!!videoPreview}
        onClose={() => setVideoPreview(null)}
      />
    </>
  );
};

const styles = StyleSheet.create({
  seccionTitulo: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginTop: SPACING.sm,
  },
  seccionSubtitulo: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
    lineHeight: 16,
  },
  label: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
    marginTop: SPACING.md,
  },
  input: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
  },
  textArea: {
    minHeight: 90,
    textAlignVertical: 'top',
  },
  evidenciaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.border,
    padding: SPACING.md,
    marginTop: SPACING.sm,
  },
  evidenciaCardOk: {
    borderColor: COLORS.success,
    backgroundColor: COLORS.success + '0D',
  },
  evidenciaIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: COLORS.primary + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  evidenciaIconText: {
    fontSize: 20,
  },
  evidenciaContent: {
    flex: 1,
  },
  evidenciaCardTitle: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  evidenciaCardDesc: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  evidenciaArrow: {
    fontSize: 22,
    color: COLORS.textSecondary,
  },
  fotosRow: {
    marginTop: SPACING.sm,
  },
  fotoThumb: {
    width: 90,
    height: 90,
    borderRadius: BORDER_RADIUS.sm,
    marginRight: SPACING.sm,
    position: 'relative',
  },
  fotoImgTap: {
    width: '100%',
    height: '100%',
  },
  fotoImg: {
    width: '100%',
    height: '100%',
    borderRadius: BORDER_RADIUS.sm,
  },
  videoThumbWrap: {
    width: 90,
    marginRight: SPACING.sm,
    position: 'relative',
  },
  videoThumb: {
    width: 90,
    height: 90,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: COLORS.textPrimary,
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoThumbIcon: {
    fontSize: 24,
  },
  videoThumbLabel: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: 2,
  },
  fotoRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.error,
    justifyContent: 'center',
    alignItems: 'center',
  },
  fotoRemoveText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: FONTS.weights.bold,
  },
  firmaPreview: {
    width: 200,
    height: 100,
    resizeMode: 'contain',
    backgroundColor: '#fff',
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    marginTop: SPACING.sm,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: SPACING.xs,
    marginTop: SPACING.sm,
  },
  chip: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 6,
    maxWidth: 220,
  },
  chipText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textPrimary,
  },
  ubicacionWrap: {
    marginTop: SPACING.md,
  },
  avisoOffline: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginTop: SPACING.lg,
    fontStyle: 'italic',
  },
  guardarBtn: {
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.md,
    alignItems: 'center',
    marginTop: SPACING.sm,
    ...SHADOWS.md,
  },
  guardarBtnDisabled: {
    opacity: 0.6,
  },
  guardarBtnText: {
    color: '#fff',
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
  },
  firmaModalContainer: {
    flex: 1,
    backgroundColor: COLORS.background,
    paddingHorizontal: SPACING.md,
  },
  firmaModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  firmaModalTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  firmaModalClose: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.error,
    fontWeight: FONTS.weights.semibold,
  },
  firmaModalPadContainer: {
    flex: 1,
  },
  hint: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginBottom: SPACING.sm,
  },
  previewHint: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: SPACING.xs,
    fontStyle: 'italic',
  },
  visorOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  visorContent: {
    width: '100%',
    height: '100%',
    justifyContent: 'center',
    alignItems: 'center',
    padding: SPACING.md,
  },
  visorImage: {
    width: '100%',
    height: '80%',
  },
  visorCloseBtn: {
    marginTop: SPACING.md,
    backgroundColor: 'rgba(255,255,255,0.15)',
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
  },
  visorCloseText: {
    color: '#fff',
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
  },
});

export default SeguimientoCoordinacionSection;
