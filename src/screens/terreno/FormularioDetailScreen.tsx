// ============================================================
// GEODAILY — Detalle de Formulario (Read-Only + PDF)
// ============================================================
// Muestra todos los datos de un formulario completado,
// con miniaturas de evidencias y opciones de PDF.
// ============================================================

import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  Image,
  StyleSheet,
  Alert,
  Platform,
  Dimensions,
  Modal,
  Pressable,
  TextInput,
  ActivityIndicator,
} from 'react-native';
import * as FileSystem from 'expo-file-system/legacy';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { RouteProp } from '@react-navigation/native';
import { WebView } from 'react-native-webview';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS, API_CONFIG } from '../../theme';
import { Formulario, DatosCaracterizacionNueva, FotoGeotag } from '../../types';
import VideoPlayerModal from '../../components/VideoPlayerModal';
import {
  resolverEvidenciasRemotas,
  cabecerasDeArchivo,
  resolverFirmasRemotas,
  FirmaResuelta,
} from '../../services/archivos.service';
import { fetchDocumentosDeFormulario, DocumentoDeFormulario } from '../../services/documentos.service';
import { formatFecha } from '../../utils/formatters';
import { construirSeccionesEncuesta, esEncuestaSocial } from '../../utils/encuestaSchema';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Print from 'expo-print';
import * as Sharing from 'expo-sharing';
import * as IntentLauncher from 'expo-intent-launcher';
import { convertirFotosAHTML, generarSelloBiometrico } from '../../services/pdfLocal.service';
import { useAuth } from '../../store/AuthContext';
import {
  registrarRevision,
  Revision,
  EvidenciaRevisor,
  guardarEvidenciaRevisor,
  fetchEvidenciasRevisor,
} from '../../services/revisiones.service';
import { useRevisiones } from '../../hooks/useRevisiones';
import { useLocation } from '../../hooks/useLocation';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import SignaturePad from '../../components/SignaturePad';
import MapViewOffline from '../../components/MapViewOffline';
import { uploadPhoto } from '../../services/photos.service';
import { uploadVideo } from '../../services/videos.service';
import { subirDocumento } from '../../services/documentos.service';
import { subirFirma } from '../../services/firmas.service';

type FormularioDetailScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
  route: RouteProp<Record<string, any> & { params: { formulario: Formulario; modo?: 'online' | 'campo' } }, 'params'>;
};

// ============================================================
// Sección de Revisión — flujo jerárquico de retroalimentación
// (técnico ve el estado; supervisor/interventor/gerente/admin revisan)
// ============================================================

const ROL_LABEL: Record<string, string> = {
  supervisor: 'Supervisor',
  interventor: 'Interventor',
  gerente: 'Gerente',
  admin: 'Administrador',
};

const SeccionRevision: React.FC<{ formulario: Formulario; revisiones: Revision[]; cargando: boolean; recargar: () => Promise<void> }> = ({ formulario, revisiones, recargar }) => {
  const formularioId = formulario.id;
  const { user } = useAuth();
  const rol = user?.rol || 'tecnico';
  const esRevisor = ['supervisor', 'interventor', 'gerente', 'admin'].includes(rol);

  const [enviando, setEnviando] = useState(false);
  const [modalNovedad, setModalNovedad] = useState(false);
  const [novedadTexto, setNovedadTexto] = useState('');

  const cargar = recargar;

  const estadoDe = (r: string): 'ok' | 'novedades' | null => {
    if (revisiones.some((x) => x.revisor_rol === r && x.tipo === 'visto_bueno')) return 'ok';
    if (revisiones.some((x) => x.revisor_rol === r && x.tipo === 'novedad')) return 'novedades';
    return null;
  };
  const yaAprobePorMiRol = estadoDe(rol) === 'ok';
  const novedades = revisiones.filter((r) => r.tipo === 'novedad');

  const enviarNovedad = async () => {
    if (!novedadTexto.trim()) {
      Alert.alert('Novedad vacía', 'Escribe la observación o corrección solicitada.');
      return;
    }
    setEnviando(true);
    try {
      await registrarRevision(formularioId, 'novedad', novedadTexto.trim());
      setNovedadTexto('');
      setModalNovedad(false);
      await cargar();
      Alert.alert('✅ Novedad registrada', 'El técnico verá esta observación en el formulario.');
    } catch (error) {
      Alert.alert('No se pudo registrar', error instanceof Error ? error.message : String(error));
    } finally {
      setEnviando(false);
    }
  };

  const enviarVistoBueno = async () => {
    setEnviando(true);
    try {
      await registrarRevision(formularioId, 'visto_bueno');
      await cargar();
      Alert.alert('✅ Todo OK', 'Visto bueno registrado correctamente.');
    } catch (error) {
      Alert.alert('No se pudo aprobar', error instanceof Error ? error.message : String(error));
    } finally {
      setEnviando(false);
    }
  };

  const handleTodoOK = () => {
    Alert.alert('Dar visto bueno', '¿Confirmas que este formulario está correcto (Todo OK)?', [
      { text: 'Cancelar', style: 'cancel' },
      { text: 'Todo OK', onPress: () => enviarVistoBueno() },
    ]);
  };

  const Chip = ({ rolChip }: { rolChip: 'supervisor' | 'interventor' }) => {
    const est = estadoDe(rolChip);
    return (
      <View style={[rev.chip, est === 'ok' ? rev.chipOk : est === 'novedades' ? rev.chipNov : rev.chipPend]}>
        <Text style={rev.chipText}>
          {ROL_LABEL[rolChip]}: {est === 'ok' ? '✔ Todo OK' : est === 'novedades' ? '⚠ Novedades' : '— Pendiente'}
        </Text>
      </View>
    );
  };

  return (
    <View style={rev.section}>
      <Text style={rev.title}>🔎 Revisión y Aprobación</Text>

      {/* Estado jerárquico (visible para todos, incluido el técnico) */}
      <View style={rev.chipsRow}>
        <Chip rolChip="supervisor" />
        <Chip rolChip="interventor" />
      </View>

      {/* Novedades registradas */}
      {novedades.length > 0 && (
        <View style={rev.novedadesBox}>
          <Text style={rev.novedadesTitle}>⚠ Novedades ({novedades.length})</Text>
          {novedades.map((n) => (
            <View key={n.id} style={rev.novedadItem}>
              <Text style={rev.novedadMeta}>
                {ROL_LABEL[n.revisor_rol] || n.revisor_rol} · {n.revisor_nombre || ''} · {formatFecha(n.created_at)}
              </Text>
              <Text style={rev.novedadTexto}>{n.comentario}</Text>
            </View>
          ))}
        </View>
      )}
      {novedades.length === 0 && revisiones.length === 0 && (
        <Text style={rev.sinRevisiones}>Aún no hay revisiones para este formulario.</Text>
      )}

      {/* Acciones (solo roles superiores) — botones independientes.
          El detalle por sección de la encuesta trae su propio control de
          Novedad/Aprobado (ver SeccionMiniRevision); estos dos botones
          quedan como aprobación/novedad GLOBAL del formulario, útiles
          también para formularios que no tienen secciones clonadas
          (ej. visita técnica). */}
      {esRevisor && (
        <View style={rev.botonesRow}>
          <TouchableOpacity style={[rev.boton, rev.botonNovedad]} onPress={() => setModalNovedad(true)} disabled={enviando}>
            <Text style={rev.botonTexto}>📝 Novedad general</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[rev.boton, yaAprobePorMiRol ? rev.botonDeshabilitado : rev.botonOk]}
            onPress={handleTodoOK}
            disabled={enviando || yaAprobePorMiRol}
          >
            <Text style={rev.botonTexto}>
              {yaAprobePorMiRol ? '✔ Ya aprobado por ti' : '✅ Todo OK'}
            </Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Modal: registrar novedad */}
      <Modal visible={modalNovedad} transparent animationType="fade" onRequestClose={() => setModalNovedad(false)}>
        <View style={rev.modalFondo}>
          <View style={rev.modalCard}>
            <Text style={rev.modalTitulo}>📝 Registrar Novedad</Text>
            <Text style={rev.modalSub}>Describe la observación o corrección que el técnico debe atender:</Text>
            <TextInput
              style={rev.inputMultiline}
              multiline
              numberOfLines={4}
              value={novedadTexto}
              onChangeText={setNovedadTexto}
              placeholder="Ej: Falta la foto del lote norte…"
              placeholderTextColor={COLORS.textLight}
            />
            <View style={rev.modalBotones}>
              <TouchableOpacity style={[rev.boton, rev.botonCancelar]} onPress={() => setModalNovedad(false)}>
                <Text style={rev.botonTextoOscuro}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[rev.boton, rev.botonNovedad]} onPress={enviarNovedad} disabled={enviando}>
                <Text style={rev.botonTexto}>{enviando ? 'Enviando…' : 'Registrar'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
};

// ============================================================
// Control de Novedad/Aprobado POR SECCIÓN — reemplaza los antiguos
// checklists genéricos "Formulario en línea"/"Formulario en campo".
// Se renderiza debajo de cada sección de la encuesta clonada.
// ============================================================

const SeccionMiniRevision: React.FC<{
  formularioId: string;
  seccionTitulo: string;
  revisiones: Revision[];
  rol: string;
  esRevisor: boolean;
  recargar: () => Promise<void>;
}> = ({ formularioId, seccionTitulo, revisiones, rol, esRevisor, recargar }) => {
  const [enviando, setEnviando] = useState(false);
  const [mostrarInput, setMostrarInput] = useState(false);
  const [texto, setTexto] = useState('');

  const deEstaSeccion = revisiones.filter((r) => r.seccion === seccionTitulo);
  const estadoDeRol = (r: string): 'ok' | 'novedades' | null => {
    const propias = deEstaSeccion
      .filter((x) => x.revisor_rol === r)
      .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    if (!propias[0]) return null;
    return propias[0].tipo === 'visto_bueno' ? 'ok' : 'novedades';
  };
  const miEstado = estadoDeRol(rol);

  const marcarAprobado = async () => {
    setEnviando(true);
    try {
      await registrarRevision(formularioId, 'visto_bueno', undefined, undefined, seccionTitulo);
      await recargar();
    } catch (error) {
      Alert.alert('No se pudo aprobar', error instanceof Error ? error.message : String(error));
    } finally {
      setEnviando(false);
    }
  };

  const enviarNovedadSeccion = async () => {
    if (!texto.trim()) {
      Alert.alert('Novedad vacía', 'Escribe la observación de esta sección.');
      return;
    }
    setEnviando(true);
    try {
      await registrarRevision(formularioId, 'novedad', texto.trim(), undefined, seccionTitulo);
      setTexto('');
      setMostrarInput(false);
      await recargar();
    } catch (error) {
      Alert.alert('No se pudo registrar', error instanceof Error ? error.message : String(error));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <View style={mini.container}>
      {(['supervisor', 'interventor'] as const).map((r) => {
        const est = estadoDeRol(r);
        if (!est) return null;
        return (
          <View key={r} style={[mini.chip, est === 'ok' ? mini.chipOk : mini.chipNov]}>
            <Text style={mini.chipText}>
              {ROL_LABEL[r]}: {est === 'ok' ? '✔ Aprobado' : '⚠ Novedad'}
            </Text>
          </View>
        );
      })}

      {deEstaSeccion.filter((r) => r.tipo === 'novedad').map((n) => (
        <Text key={n.id} style={mini.novedadTexto}>
          ⚠ {ROL_LABEL[n.revisor_rol] || n.revisor_rol}: {n.comentario}
        </Text>
      ))}

      {esRevisor && (
        <View style={mini.accionesRow}>
          <TouchableOpacity
            style={[mini.btn, mini.btnNovedad]}
            onPress={() => setMostrarInput((v) => !v)}
            disabled={enviando}
          >
            <Text style={mini.btnText}>📝 Novedad</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[mini.btn, miEstado === 'ok' ? mini.btnDeshabilitado : mini.btnOk]}
            onPress={marcarAprobado}
            disabled={enviando || miEstado === 'ok'}
          >
            <Text style={mini.btnText}>{miEstado === 'ok' ? '✔ Aprobado' : '✅ Aprobado'}</Text>
          </TouchableOpacity>
        </View>
      )}

      {mostrarInput && (
        <View style={mini.inputRow}>
          <TextInput
            style={mini.input}
            multiline
            value={texto}
            onChangeText={setTexto}
            placeholder="Describe la novedad de esta sección..."
            placeholderTextColor={COLORS.textLight}
          />
          <TouchableOpacity style={[mini.btn, mini.btnNovedad]} onPress={enviarNovedadSeccion} disabled={enviando}>
            <Text style={mini.btnText}>{enviando ? '...' : 'Enviar'}</Text>
          </TouchableOpacity>
        </View>
      )}
    </View>
  );
};

const mini = StyleSheet.create({
  container: { marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.divider },
  chip: { alignSelf: 'flex-start', paddingHorizontal: SPACING.sm, paddingVertical: 2, borderRadius: BORDER_RADIUS.full, marginBottom: 4 },
  chipOk: { backgroundColor: COLORS.success + '22' },
  chipNov: { backgroundColor: COLORS.warning + '22' },
  chipText: { fontSize: FONTS.sizes.xs, color: COLORS.textPrimary },
  novedadTexto: { fontSize: FONTS.sizes.xs, color: COLORS.error, marginBottom: 2 },
  accionesRow: { flexDirection: 'row', gap: SPACING.xs, marginTop: 4 },
  btn: { paddingHorizontal: SPACING.sm, paddingVertical: 6, borderRadius: BORDER_RADIUS.sm },
  btnNovedad: { backgroundColor: COLORS.info },
  btnOk: { backgroundColor: COLORS.success },
  btnDeshabilitado: { backgroundColor: COLORS.textLight },
  btnText: { color: '#fff', fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold },
  inputRow: { marginTop: SPACING.xs, gap: SPACING.xs },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.sm,
    padding: SPACING.sm, minHeight: 44, textAlignVertical: 'top',
    fontSize: FONTS.sizes.sm, color: COLORS.textPrimary, backgroundColor: COLORS.background,
  },
});

// ============================================================
// Sección final del revisor — evidencia propia (fotos), firma dual
// (beneficiario + revisor) y georeferencia puntual (captura única, NO
// tracking en vivo). Guardar registra también el visto bueno GLOBAL del
// rol sobre el formulario.
// ============================================================

/** Foto/video propio del revisor, en tránsito hacia MinIO o ya subido. */
type EvidenciaLocal = {
  id: string;
  uri: string;
  archivoId?: string;
  subiendo: boolean;
  error?: boolean;
};

/** Documento/anexo propio del revisor, subido directo a MinIO (asociado al formulario). */
type DocumentoLocal = {
  id: string;
  nombre: string;
  /** Copia local (cache) del archivo — permite abrirlo de inmediato sin re-descargarlo del servidor. */
  uri: string;
  mimetype?: string;
  /** id del archivo en MinIO una vez subido — evita duplicarlo con la lista ya persistida. */
  archivoId?: string;
  subiendo: boolean;
  error?: boolean;
};

/** Firma propia del revisor: vista previa local + referencia a MinIO una vez subida. */
type FirmaLocal = {
  preview: string;
  archivoId?: string;
  subiendo: boolean;
  error?: boolean;
};

const SeccionFinalRevisor: React.FC<{ formulario: Formulario; revisiones: Revision[]; recargarRevisiones: () => Promise<void> }> = ({ formulario, revisiones, recargarRevisiones }) => {
  const { user } = useAuth();
  const rol = user?.rol || 'tecnico';
  const esRevisor = ['supervisor', 'interventor', 'gerente', 'admin'].includes(rol);
  const nombreRol = ROL_LABEL[rol] || 'Revisor';
  const yaAprobadoPorMiRol = revisiones.some((r) => r.revisor_rol === rol && r.tipo === 'visto_bueno');

  const [evidencias, setEvidencias] = useState<EvidenciaRevisor[]>([]);
  const [documentosRevision, setDocumentosRevision] = useState<DocumentoDeFormulario[]>([]);
  const [fotos, setFotos] = useState<EvidenciaLocal[]>([]);
  const [videos, setVideos] = useState<EvidenciaLocal[]>([]);
  const [documentos, setDocumentos] = useState<DocumentoLocal[]>([]);
  const [firmaBeneficiario, setFirmaBeneficiario] = useState<FirmaLocal | null>(null);
  const [firmaRevisor, setFirmaRevisor] = useState<FirmaLocal | null>(null);
  const [geoPoint, setGeoPoint] = useState<{ lat: number; lon: number } | null>(null);
  const [observaciones, setObservaciones] = useState('');
  const [padActivo, setPadActivo] = useState<'beneficiario' | 'revisor' | null>(null);
  const [guardandoEvidencia, setGuardandoEvidencia] = useState(false);
  const [aprobando, setAprobando] = useState(false);
  const [obteniendoUbicacion, setObteniendoUbicacion] = useState(false);
  const [headersArchivo, setHeadersArchivo] = useState<Record<string, string>>({});
  const [videoPreview, setVideoPreview] = useState<{ uri: string; headers: Record<string, string> } | null>(null);
  /** Foto o firma abierta en el visor ampliado (null = cerrado). */
  const [imagenAmpliada, setImagenAmpliada] = useState<{ uri: string; headers?: Record<string, string>; titulo: string } | null>(null);
  const [abriendoDocumentoId, setAbriendoDocumentoId] = useState<string | null>(null);
  const { getCurrentPosition } = useLocation();
  const insets = useSafeAreaInsets();

  const cargarEvidencias = useCallback(async () => {
    const [evid, docs] = await Promise.all([
      fetchEvidenciasRevisor(formulario.id),
      fetchDocumentosDeFormulario(formulario.id),
    ]);
    setEvidencias(evid);
    setDocumentosRevision(docs.filter((d) => d.categoria === 'revision'));
  }, [formulario.id]);

  useEffect(() => {
    cargarEvidencias();
    cabecerasDeArchivo().then(setHeadersArchivo);
  }, [cargarEvidencias]);

  const miEvidencia = evidencias.find((e) => e.revisor_rol === rol);
  const otrasEvidencias = evidencias.filter((e) => e.revisor_rol !== rol);
  /** Documentos de este rol ya persistidos — se excluyen los que ya están en la lista local para no duplicarlos. */
  const documentosPropiosGuardados = documentosRevision.filter(
    (d) => d.descripcion?.includes(nombreRol) && !documentos.some((ld) => ld.archivoId === d.id)
  );

  const urlDeArchivoId = (archivoId: string) => `${API_CONFIG.BASE_URL}/api/archivos/${archivoId}/contenido`;

  /** Registros viejos guardaban la firma como base64 crudo; los nuevos guardan el id del archivo en MinIO. */
  const resolverFirmaValor = (valor: string | null): { uri: string; headers: Record<string, string> } | null => {
    if (!valor) return null;
    if (valor.startsWith('data:')) return { uri: valor, headers: {} };
    return { uri: urlDeArchivoId(valor), headers: headersArchivo };
  };

  /** Fuente de imagen que agrega las cabeceras de auth solo cuando la uri viene del servidor (evidencia ya guardada). */
  const fuenteArchivoLocal = (uri: string): { uri: string; headers?: Record<string, string> } =>
    uri.startsWith('http') ? { uri, headers: headersArchivo } : { uri };

  /**
   * Si este rol ya había guardado evidencia antes, la trae al formulario
   * editable en cuanto se conocen las cabeceras de auth — antes se perdía
   * de vista al salir y volver a entrar, aunque siguiera guardada en el
   * servidor (solo se veía mezclada en "otrasEvidencias" de otros roles,
   * nunca la propia).
   */
  const hidratadoRef = useRef(false);
  useEffect(() => {
    if (hidratadoRef.current || !miEvidencia || !Object.keys(headersArchivo).length) return;
    hidratadoRef.current = true;
    setFotos(
      (miEvidencia.fotos_json || []).map((f, i) => ({
        id: f.archivo_id || `foto-guardada-${i}`,
        uri: f.archivo_id ? urlDeArchivoId(f.archivo_id) : f.uri || '',
        archivoId: f.archivo_id,
        subiendo: false,
      }))
    );
    setVideos(
      (miEvidencia.videos_json || []).map((v, i) => ({
        id: v.archivo_id || `video-guardada-${i}`,
        uri: v.archivo_id ? urlDeArchivoId(v.archivo_id) : v.uri || '',
        archivoId: v.archivo_id,
        subiendo: false,
      }))
    );
    const benef = resolverFirmaValor(miEvidencia.firma_beneficiario);
    if (benef) setFirmaBeneficiario({ preview: benef.uri, archivoId: miEvidencia.firma_beneficiario || undefined, subiendo: false });
    const revF = resolverFirmaValor(miEvidencia.firma_revisor);
    if (revF) setFirmaRevisor({ preview: revF.uri, archivoId: miEvidencia.firma_revisor || undefined, subiendo: false });
    if (miEvidencia.geo_latitud != null && miEvidencia.geo_longitud != null) {
      setGeoPoint({ lat: Number(miEvidencia.geo_latitud), lon: Number(miEvidencia.geo_longitud) });
    }
    if (miEvidencia.observaciones) setObservaciones(miEvidencia.observaciones);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [miEvidencia, headersArchivo]);

  const tomarFoto = async () => {
    const permiso = await ImagePicker.requestCameraPermissionsAsync();
    if (!permiso.granted) {
      Alert.alert('Permiso requerido', 'Se necesita acceso a la cámara para tomar la foto.');
      return;
    }
    const resultado = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (resultado.canceled || !resultado.assets?.[0]?.uri) return;

    const uri = resultado.assets[0].uri;
    const localId = `foto-${Date.now()}`;
    setFotos((prev) => [...prev, { id: localId, uri, subiendo: true }]);

    // Sin formularioId: esta evidencia es propia del revisor y no debe
    // mezclarse con la galería de fotos del técnico (formulario.fotos).
    // Queda organizada en MinIO bajo la carpeta del propio revisor:
    // {rol}s/{usuario}/{item}_{nombre}/Formulario_{1|2}/fotos/...
    const subida = await uploadPhoto(
      uri,
      undefined,
      undefined,
      undefined,
      `Revisión ${nombreRol} — Formulario ${formulario.id}`,
      undefined,
      formulario.beneficiario?.cedula,
      formulario.beneficiario?.nombre,
      new Date().toISOString(),
      formulario.tipo
    );
    setFotos((prev) => prev.map((f) => (f.id === localId ? { ...f, subiendo: false, archivoId: subida?.id, error: !subida } : f)));
  };

  const grabarVideo = async () => {
    const permiso = await ImagePicker.requestCameraPermissionsAsync();
    if (!permiso.granted) {
      Alert.alert('Permiso requerido', 'Se necesita acceso a la cámara para grabar el video.');
      return;
    }
    const resultado = await ImagePicker.launchCameraAsync({ mediaTypes: ['videos'], videoMaxDuration: 30 });
    if (resultado.canceled || !resultado.assets?.[0]?.uri) return;

    const uri = resultado.assets[0].uri;
    const localId = `video-${Date.now()}`;
    setVideos((prev) => [...prev, { id: localId, uri, subiendo: true }]);

    const subida = await uploadVideo(
      uri,
      undefined,
      undefined,
      `Revisión ${nombreRol} — Formulario ${formulario.id}`,
      formulario.beneficiario?.cedula,
      formulario.beneficiario?.nombre,
      formulario.tipo
    );
    setVideos((prev) => prev.map((v) => (v.id === localId ? { ...v, subiendo: false, archivoId: subida?.id, error: !subida } : v)));
  };

  const agregarDocumento = async () => {
    try {
      const resultado = await DocumentPicker.getDocumentAsync({
        type: ['application/pdf', 'image/*'],
        copyToCacheDirectory: true,
      });
      if (resultado.canceled || !resultado.assets?.[0]) return;

      const asset = resultado.assets[0];
      const nombre = asset.name || `documento_${Date.now()}`;
      const localId = `doc-${Date.now()}`;
      const esPdf = nombre.toLowerCase().endsWith('.pdf');
      const mimetype = esPdf ? 'application/pdf' : asset.mimeType || 'image/jpeg';
      setDocumentos((prev) => [...prev, { id: localId, nombre, uri: asset.uri, mimetype, subiendo: true }]);

      // Este sí lleva formularioId — los documentos del formulario son
      // compartidos entre todos los roles (misma lista de "Documentos de
      // la finca" que ya se muestra más abajo en esta pantalla).
      const subida = await subirDocumento(
        asset.uri,
        `Evidencia de revisión — ${nombreRol}`,
        'revision',
        nombre,
        formulario.beneficiario?.cedula,
        formulario.beneficiario?.nombre,
        formulario.tipo,
        mimetype,
        formulario.id
      );
      setDocumentos((prev) => prev.map((d) => (d.id === localId ? { ...d, subiendo: false, archivoId: subida?.id, error: !subida } : d)));
      if (!subida) Alert.alert('No se pudo subir', 'El documento no se pudo subir — verifica tu conexión.');
      else await cargarEvidencias();
    } catch (error) {
      console.error('[Revisor] Error agregando documento:', error);
      Alert.alert('Error', 'No se pudo agregar el documento.');
    }
  };

  /** Abre el documento usando la copia local en cache — no requiere re-descargarlo del servidor. */
  const abrirDocumentoLocal = async (doc: DocumentoLocal) => {
    setAbriendoDocumentoId(doc.id);
    try {
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(doc.uri, { mimeType: doc.mimetype });
      } else {
        Alert.alert('Documento', `Guardado en: ${doc.uri}`);
      }
    } catch (error) {
      console.error('[Revisor] No se pudo abrir el documento:', doc.id, error);
      Alert.alert('Error', 'No se pudo abrir el documento.');
    } finally {
      setAbriendoDocumentoId(null);
    }
  };

  /** Abre un documento ya guardado en sesiones anteriores — hay que descargarlo, no hay copia local en cache. */
  const abrirDocumentoRemoto = async (doc: DocumentoDeFormulario) => {
    setAbriendoDocumentoId(doc.id);
    try {
      const url = doc.url.startsWith('http') ? doc.url : `${API_CONFIG.BASE_URL}${doc.url}`;
      const extension = doc.nombre.includes('.') ? doc.nombre.split('.').pop() : 'dat';
      const destino = `${FileSystem.cacheDirectory}doc_revision_${doc.id}.${extension}`;
      const { uri } = await FileSystem.downloadAsync(url, destino, { headers: headersArchivo });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: doc.mimetype });
      } else {
        Alert.alert('Documento descargado', `Guardado en: ${uri}`);
      }
    } catch (error) {
      console.error('[Revisor] No se pudo abrir el documento remoto:', doc.id, error);
      Alert.alert('Error', 'No se pudo abrir el documento. Verifica tu conexión.');
    } finally {
      setAbriendoDocumentoId(null);
    }
  };

  const capturarFirma = async (tipo: 'beneficiario' | 'revisor', sig: string) => {
    setPadActivo(null);
    const setFirma = tipo === 'beneficiario' ? setFirmaBeneficiario : setFirmaRevisor;
    setFirma({ preview: sig, subiendo: true });
    const subida = await subirFirma(
      tipo,
      sig,
      formulario.beneficiario?.cedula,
      formulario.beneficiario?.nombre,
      formulario.tipo
    );
    setFirma({ preview: sig, subiendo: false, archivoId: subida?.id, error: !subida });
  };

  const usarUbicacionActual = async () => {
    setObteniendoUbicacion(true);
    try {
      const pos = await getCurrentPosition();
      if (pos) setGeoPoint({ lat: pos.latitud, lon: pos.longitud });
      else Alert.alert('Sin ubicación', 'No se pudo obtener el GPS. Verifica el permiso de ubicación.');
    } finally {
      setObteniendoUbicacion(false);
    }
  };

  /**
   * Guarda las evidencias (fotos, videos, firmas, geo, observaciones) del
   * rol — se hace UNA sola vez por formulario y luego se puede actualizar.
   * Separado de la aprobación: antes un solo botón hacía ambas cosas, lo
   * que obligaba a re-aprobar cada vez que solo se quería completar
   * evidencia.
   */
  const guardarEvidencias = async () => {
    if (fotos.some((f) => f.subiendo) || videos.some((v) => v.subiendo) || documentos.some((d) => d.subiendo) || firmaBeneficiario?.subiendo || firmaRevisor?.subiendo) {
      Alert.alert('Espera un momento', 'Todavía se están subiendo evidencias — inténtalo de nuevo en unos segundos.');
      return;
    }
    const pendientes = fotos.filter((f) => !f.archivoId).length + videos.filter((v) => !v.archivoId).length;
    if (pendientes > 0) {
      Alert.alert(
        'Evidencias sin subir',
        `${pendientes} evidencia(s) no se pudieron subir (sin conexión). Quítalas con ✕ o vuelve a intentarlo antes de guardar.`
      );
      return;
    }

    setGuardandoEvidencia(true);
    try {
      await guardarEvidenciaRevisor(formulario.id, {
        fotos: fotos.filter((f): f is EvidenciaLocal & { archivoId: string } => !!f.archivoId).map((f) => ({ archivo_id: f.archivoId, uri: f.uri })),
        videos: videos.filter((v): v is EvidenciaLocal & { archivoId: string } => !!v.archivoId).map((v) => ({ archivo_id: v.archivoId, uri: v.uri })),
        firma_beneficiario: firmaBeneficiario?.archivoId,
        firma_revisor: firmaRevisor?.archivoId,
        geo_latitud: geoPoint?.lat,
        geo_longitud: geoPoint?.lon,
        observaciones: observaciones.trim() || undefined,
      });
      await cargarEvidencias();
      Alert.alert('✅ Evidencias guardadas', `Las evidencias de ${nombreRol} quedaron registradas para este formulario.`);
    } catch (error) {
      Alert.alert('No se pudo guardar', error instanceof Error ? error.message : String(error));
    } finally {
      setGuardandoEvidencia(false);
    }
  };

  const aprobarFormulario = () => {
    Alert.alert('Aprobar formulario', `¿Confirmas que este formulario está correcto como ${nombreRol}?`, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Aprobar',
        onPress: async () => {
          setAprobando(true);
          try {
            await registrarRevision(formulario.id, 'visto_bueno');
            await recargarRevisiones();
            Alert.alert('✅ Formulario aprobado');
          } catch (error) {
            Alert.alert('No se pudo aprobar', error instanceof Error ? error.message : String(error));
          } finally {
            setAprobando(false);
          }
        },
      },
    ]);
  };

  if (!esRevisor && evidencias.length === 0) return null;

  const centroMapa = geoPoint
    ? { latitud: geoPoint.lat, longitud: geoPoint.lon }
    : formulario.coordenadas || { latitud: 1.914, longitud: -75.145 };

  const estadoDe = (item: { subiendo: boolean; error?: boolean; archivoId?: string }) =>
    item.subiendo ? '⏳ Subiendo…' : item.error ? '⚠️ No se subió' : '✅ En MinIO';

  return (
    <View style={finalStyles.section}>
      <Text style={finalStyles.title}>🖊️ Sección del {nombreRol}</Text>

      {esRevisor && (
        <>
          {/* Evidencias — mismo estilo de tarjetas que usa el técnico en
              su propio formulario (icono, título, descripción, check verde),
              subidas a MinIO igual que las del técnico. */}
          <TouchableOpacity
            style={[finalStyles.evidenciaCard, fotos.some((f) => f.archivoId) && finalStyles.evidenciaCardOk]}
            onPress={tomarFoto}
            activeOpacity={0.7}
          >
            <View style={finalStyles.evidenciaIcon}>
              <Text style={finalStyles.evidenciaIconText}>📷</Text>
            </View>
            <View style={finalStyles.evidenciaContent}>
              <Text style={finalStyles.evidenciaCardTitle}>Fotos de la revisión</Text>
              <Text style={finalStyles.evidenciaCardDesc}>
                {fotos.length > 0 ? `${fotos.length} foto(s) capturada(s) — toca para agregar otra` : 'Toca para tomar una foto'}
              </Text>
            </View>
            <Text style={finalStyles.evidenciaArrow}>›</Text>
          </TouchableOpacity>
          {fotos.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={finalStyles.fotosRow}>
              {fotos.map((f) => (
                <View key={f.id} style={finalStyles.fotoThumb}>
                  <TouchableOpacity
                    onPress={() => setImagenAmpliada({ ...fuenteArchivoLocal(f.uri), titulo: `Foto de la revisión — ${nombreRol}` })}
                    activeOpacity={0.8}
                  >
                    <Image source={fuenteArchivoLocal(f.uri)} style={finalStyles.fotoImg} />
                    {f.subiendo && (
                      <View style={finalStyles.fotoOverlay}>
                        <ActivityIndicator size="small" color="#fff" />
                      </View>
                    )}
                    {f.error && (
                      <View style={[finalStyles.fotoOverlay, finalStyles.fotoOverlayError]}>
                        <Text style={finalStyles.fotoOverlayText}>⚠️</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                  <TouchableOpacity style={finalStyles.fotoRemove} onPress={() => setFotos((prev) => prev.filter((x) => x.id !== f.id))}>
                    <Text style={finalStyles.fotoRemoveText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}

          <TouchableOpacity
            style={[finalStyles.evidenciaCard, videos.some((v) => v.archivoId) && finalStyles.evidenciaCardOk]}
            onPress={grabarVideo}
            activeOpacity={0.7}
          >
            <View style={finalStyles.evidenciaIcon}>
              <Text style={finalStyles.evidenciaIconText}>🎥</Text>
            </View>
            <View style={finalStyles.evidenciaContent}>
              <Text style={finalStyles.evidenciaCardTitle}>Video de la revisión</Text>
              <Text style={finalStyles.evidenciaCardDesc}>
                {videos.length > 0 ? `${videos.length} video(s) grabado(s) — toca para agregar otro (máx. 30s)` : 'Toca para grabar un video (máx. 30s)'}
              </Text>
            </View>
            <Text style={finalStyles.evidenciaArrow}>›</Text>
          </TouchableOpacity>
          {videos.length > 0 && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={finalStyles.fotosRow}>
              {videos.map((v, idx) => (
                <View key={v.id} style={finalStyles.videoThumbWrap}>
                  <TouchableOpacity
                    style={finalStyles.videoThumb}
                    onPress={() => setVideoPreview({ uri: v.uri, headers: v.uri.startsWith('http') ? headersArchivo : {} })}
                    disabled={v.subiendo}
                    activeOpacity={0.8}
                  >
                    {v.subiendo ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : v.error ? (
                      <Text style={finalStyles.videoThumbIcon}>⚠️</Text>
                    ) : (
                      <Text style={finalStyles.videoThumbIcon}>▶️</Text>
                    )}
                  </TouchableOpacity>
                  <Text style={finalStyles.videoThumbLabel} numberOfLines={1}>
                    Video {idx + 1} {v.subiendo ? '· subiendo…' : v.error ? '· no subió' : '· toca para ver'}
                  </Text>
                  <TouchableOpacity style={finalStyles.fotoRemove} onPress={() => setVideos((prev) => prev.filter((x) => x.id !== v.id))}>
                    <Text style={finalStyles.fotoRemoveText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          )}

          <TouchableOpacity
            style={[finalStyles.evidenciaCard, (documentos.some((d) => !d.subiendo && !d.error) || documentosPropiosGuardados.length > 0) && finalStyles.evidenciaCardOk]}
            onPress={agregarDocumento}
            activeOpacity={0.7}
          >
            <View style={finalStyles.evidenciaIcon}>
              <Text style={finalStyles.evidenciaIconText}>📄</Text>
            </View>
            <View style={finalStyles.evidenciaContent}>
              <Text style={finalStyles.evidenciaCardTitle}>Documentos / anexos</Text>
              <Text style={finalStyles.evidenciaCardDesc}>
                {documentos.length + documentosPropiosGuardados.length > 0
                  ? `${documentos.length + documentosPropiosGuardados.length} documento(s) adjunto(s) — toca para agregar otro`
                  : 'Toca para adjuntar un PDF o imagen'}
              </Text>
            </View>
            <Text style={finalStyles.evidenciaArrow}>›</Text>
          </TouchableOpacity>
          {(documentos.length > 0 || documentosPropiosGuardados.length > 0) && (
            <View style={finalStyles.chipsWrap}>
              {documentos.map((d) => (
                <TouchableOpacity
                  key={d.id}
                  style={finalStyles.chip}
                  onPress={() => abrirDocumentoLocal(d)}
                  disabled={d.subiendo || abriendoDocumentoId === d.id}
                >
                  <Text style={finalStyles.chipText} numberOfLines={1}>
                    📄 {d.nombre} — {abriendoDocumentoId === d.id ? 'abriendo…' : d.subiendo ? '⏳' : d.error ? '⚠️' : '✅ toca para abrir'}
                  </Text>
                </TouchableOpacity>
              ))}
              {documentosPropiosGuardados.map((d) => (
                <TouchableOpacity
                  key={d.id}
                  style={finalStyles.chip}
                  onPress={() => abrirDocumentoRemoto(d)}
                  disabled={abriendoDocumentoId === d.id}
                >
                  <Text style={finalStyles.chipText} numberOfLines={1}>
                    📄 {d.nombre} — {abriendoDocumentoId === d.id ? 'abriendo…' : '✅ toca para abrir'}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          <TouchableOpacity
            style={[finalStyles.evidenciaCard, !!firmaBeneficiario?.archivoId && finalStyles.evidenciaCardOk]}
            onPress={() => setPadActivo('beneficiario')}
            activeOpacity={0.7}
          >
            <View style={finalStyles.evidenciaIcon}>
              <Text style={finalStyles.evidenciaIconText}>✍️</Text>
            </View>
            <View style={finalStyles.evidenciaContent}>
              <Text style={finalStyles.evidenciaCardTitle}>Firma del Beneficiario</Text>
              <Text style={finalStyles.evidenciaCardDesc}>
                {firmaBeneficiario
                  ? `${estadoDe(firmaBeneficiario)} — toca para rehacer`
                  : 'Capturar firma del beneficiario'}
              </Text>
            </View>
            <Text style={finalStyles.evidenciaArrow}>›</Text>
          </TouchableOpacity>
          {!!firmaBeneficiario && (
            <TouchableOpacity
              style={finalStyles.firmaPreviewRow}
              onPress={() => setImagenAmpliada({ ...fuenteArchivoLocal(firmaBeneficiario.preview), titulo: 'Firma del Beneficiario' })}
              activeOpacity={0.8}
            >
              <Image source={fuenteArchivoLocal(firmaBeneficiario.preview)} style={finalStyles.firmaImg} />
              <Text style={finalStyles.tapHint}>Toca la firma para verla en grande</Text>
            </TouchableOpacity>
          )}

          <TouchableOpacity
            style={[finalStyles.evidenciaCard, !!firmaRevisor?.archivoId && finalStyles.evidenciaCardOk]}
            onPress={() => setPadActivo('revisor')}
            activeOpacity={0.7}
          >
            <View style={finalStyles.evidenciaIcon}>
              <Text style={finalStyles.evidenciaIconText}>🖊️</Text>
            </View>
            <View style={finalStyles.evidenciaContent}>
              <Text style={finalStyles.evidenciaCardTitle}>Firma del {nombreRol}</Text>
              <Text style={finalStyles.evidenciaCardDesc}>
                {firmaRevisor ? `${estadoDe(firmaRevisor)} — toca para rehacer` : 'Capturar tu firma'}
              </Text>
            </View>
            <Text style={finalStyles.evidenciaArrow}>›</Text>
          </TouchableOpacity>
          {!!firmaRevisor && (
            <TouchableOpacity
              style={finalStyles.firmaPreviewRow}
              onPress={() => setImagenAmpliada({ ...fuenteArchivoLocal(firmaRevisor.preview), titulo: `Firma del ${nombreRol}` })}
              activeOpacity={0.8}
            >
              <Image source={fuenteArchivoLocal(firmaRevisor.preview)} style={finalStyles.firmaImg} />
              <Text style={finalStyles.tapHint}>Toca la firma para verla en grande</Text>
            </TouchableOpacity>
          )}

          <Text style={finalStyles.label}>Georeferencia puntual (captura única)</Text>
          <Text style={finalStyles.hint}>
            Toca el mapa para ubicar el punto o usa tu ubicación GPS actual — esto NO inicia un seguimiento en vivo.
          </Text>
          <MapViewOffline
            center={centroMapa}
            zoom={15}
            height={200}
            markers={geoPoint ? [{ id: 'geo-revisor', latitud: geoPoint.lat, longitud: geoPoint.lon, title: 'Punto capturado', tipoIcono: 'pin', color: COLORS.error }] : []}
            mapStyle="relieve"
            showUserLocation={false}
            onMapPress={(lat, lon) => setGeoPoint({ lat, lon })}
          />
          <TouchableOpacity style={finalStyles.btnSecundario} onPress={usarUbicacionActual} disabled={obteniendoUbicacion}>
            <Text style={finalStyles.btnSecundarioText}>{obteniendoUbicacion ? 'Obteniendo…' : '📍 Usar mi ubicación actual'}</Text>
          </TouchableOpacity>
          {geoPoint && (
            <Text style={finalStyles.hint}>Lat: {geoPoint.lat.toFixed(6)}  Lon: {geoPoint.lon.toFixed(6)}</Text>
          )}

          <Text style={finalStyles.label}>Observaciones finales</Text>
          <TextInput
            style={finalStyles.input}
            multiline
            numberOfLines={3}
            value={observaciones}
            onChangeText={setObservaciones}
            placeholder="Observaciones de cierre de la revisión..."
            placeholderTextColor={COLORS.textLight}
          />

          <TouchableOpacity style={finalStyles.btnPrincipal} onPress={guardarEvidencias} disabled={guardandoEvidencia}>
            <Text style={finalStyles.btnPrincipalText}>
              {guardandoEvidencia ? 'Guardando…' : miEvidencia ? `💾 Actualizar evidencias de ${nombreRol}` : `💾 Guardar evidencias de ${nombreRol}`}
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[finalStyles.btnPrincipal, finalStyles.btnAprobar, yaAprobadoPorMiRol && finalStyles.btnDeshabilitado]}
            onPress={aprobarFormulario}
            disabled={aprobando || yaAprobadoPorMiRol}
          >
            <Text style={finalStyles.btnPrincipalText}>
              {aprobando ? 'Aprobando…' : yaAprobadoPorMiRol ? '✔ Formulario aprobado' : '✅ Aprobar formulario'}
            </Text>
          </TouchableOpacity>
        </>
      )}

      {otrasEvidencias.map((e) => {
        const firmaBenefResuelta = resolverFirmaValor(e.firma_beneficiario);
        const firmaRevResuelta = resolverFirmaValor(e.firma_revisor);
        const nombreRolOtro = ROL_LABEL[e.revisor_rol] || e.revisor_rol;
        const documentosDeEsteRol = documentosRevision.filter((d) => d.descripcion?.includes(nombreRolOtro));
        return (
          <View key={e.id} style={finalStyles.otraEvidencia}>
            <Text style={finalStyles.label}>Evidencia de {ROL_LABEL[e.revisor_rol] || e.revisor_rol} ({e.revisor_nombre})</Text>
            {!!e.fotos_json?.length && (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={finalStyles.fotosRow}>
                {e.fotos_json.map((f, idx) => {
                  const fuente = f.archivo_id ? { uri: urlDeArchivoId(f.archivo_id), headers: headersArchivo } : { uri: f.uri || '' };
                  return (
                    <TouchableOpacity
                      key={idx}
                      onPress={() => setImagenAmpliada({ ...fuente, titulo: `Foto de ${ROL_LABEL[e.revisor_rol] || e.revisor_rol}` })}
                      activeOpacity={0.8}
                    >
                      <Image source={fuente} style={finalStyles.fotoImg} />
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
            {!!e.videos_json?.length && (
              <View style={finalStyles.chipsWrap}>
                {e.videos_json.map((v, idx) => (
                  <TouchableOpacity
                    key={idx}
                    style={finalStyles.chip}
                    onPress={() =>
                      setVideoPreview(
                        v.archivo_id
                          ? { uri: urlDeArchivoId(v.archivo_id), headers: headersArchivo }
                          : { uri: v.uri || '', headers: {} }
                      )
                    }
                  >
                    <Text style={finalStyles.chipText}>▶ Video {idx + 1}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            <View style={finalStyles.firmasRow}>
              {firmaBenefResuelta && (
                <TouchableOpacity
                  onPress={() => setImagenAmpliada({ ...firmaBenefResuelta, titulo: `Firma del Beneficiario — evidencia de ${ROL_LABEL[e.revisor_rol] || e.revisor_rol}` })}
                  activeOpacity={0.8}
                >
                  <Image source={firmaBenefResuelta} style={finalStyles.firmaImg} />
                </TouchableOpacity>
              )}
              {firmaRevResuelta && (
                <TouchableOpacity
                  onPress={() => setImagenAmpliada({ ...firmaRevResuelta, titulo: `Firma de ${ROL_LABEL[e.revisor_rol] || e.revisor_rol}` })}
                  activeOpacity={0.8}
                >
                  <Image source={firmaRevResuelta} style={finalStyles.firmaImg} />
                </TouchableOpacity>
              )}
            </View>
            {documentosDeEsteRol.length > 0 && (
              <View style={finalStyles.chipsWrap}>
                {documentosDeEsteRol.map((d) => (
                  <TouchableOpacity
                    key={d.id}
                    style={finalStyles.chip}
                    onPress={() => abrirDocumentoRemoto(d)}
                    disabled={abriendoDocumentoId === d.id}
                  >
                    <Text style={finalStyles.chipText} numberOfLines={1}>
                      📄 {d.nombre} — {abriendoDocumentoId === d.id ? 'abriendo…' : '✅ toca para abrir'}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            )}
            {e.geo_latitud != null && e.geo_longitud != null && (
              <Text style={finalStyles.hint}>📍 Lat: {Number(e.geo_latitud).toFixed(6)}  Lon: {Number(e.geo_longitud).toFixed(6)}</Text>
            )}
            {!!e.observaciones && <Text style={finalStyles.hint}>{e.observaciones}</Text>}
          </View>
        );
      })}

      <VideoPlayerModal
        uri={videoPreview?.uri ?? null}
        visible={!!videoPreview}
        onClose={() => setVideoPreview(null)}
        headers={videoPreview?.headers}
      />

      {/* 📸 Visor ampliado de foto/firma propia o de otro rol */}
      <Modal
        visible={!!imagenAmpliada}
        transparent
        animationType="fade"
        onRequestClose={() => setImagenAmpliada(null)}
      >
        <Pressable style={styles.fotoModalOverlay} onPress={() => setImagenAmpliada(null)}>
          {imagenAmpliada && (
            <>
              <Image
                source={{ uri: imagenAmpliada.uri, headers: imagenAmpliada.headers }}
                style={[styles.fotoModalImage, { backgroundColor: '#fff' }]}
                resizeMode="contain"
              />
              <Text style={styles.fotoModalInfo}>{imagenAmpliada.titulo}</Text>
              <Text style={styles.fotoModalHint}>Toca para cerrar</Text>
            </>
          )}
        </Pressable>
      </Modal>

      {/* ✍️ Pantalla dedicada para firmar — fuera del ScrollView del detalle,
          así el gesto de dibujar no se confunde con el scroll de la pantalla. */}
      <Modal
        visible={padActivo !== null}
        animationType="slide"
        onRequestClose={() => setPadActivo(null)}
      >
        <View style={[finalStyles.firmaModalContainer, { paddingTop: insets.top + SPACING.sm }]}>
          <View style={finalStyles.firmaModalHeader}>
            <Text style={finalStyles.firmaModalTitle}>
              ✍️ {padActivo === 'beneficiario' ? 'Firma del Beneficiario' : `Firma del ${nombreRol}`}
            </Text>
            <TouchableOpacity onPress={() => setPadActivo(null)}>
              <Text style={finalStyles.firmaModalClose}>✕ Cerrar</Text>
            </TouchableOpacity>
          </View>
          <Text style={finalStyles.hint}>Dibuja la firma con el dedo dentro del recuadro blanco.</Text>
          {padActivo && (
            <SignaturePad
              key={padActivo}
              onOK={(sig) => capturarFirma(padActivo, sig)}
              description={padActivo === 'beneficiario' ? 'Firma del beneficiario' : `Firma del ${nombreRol}`}
              containerStyle={finalStyles.firmaModalPadContainer}
              height={Dimensions.get('window').height * 0.45}
            />
          )}
        </View>
      </Modal>
    </View>
  );
};

const finalStyles = StyleSheet.create({
  section: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.secondary || '#F9A825',
    ...SHADOWS.sm,
  },
  title: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  label: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary, marginTop: SPACING.sm, marginBottom: 4 },
  hint: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginBottom: 4 },
  // Tarjetas de evidencia — mismo estilo que EVIDENCIAS del técnico
  // (FormularioCaracterizacionScreen.tsx) para mantener consistencia visual.
  evidenciaCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.sm,
    borderWidth: 2,
    borderColor: COLORS.border,
    ...SHADOWS.sm,
  },
  evidenciaCardOk: {
    borderColor: COLORS.success,
    backgroundColor: COLORS.success + '08',
  },
  evidenciaIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.surfaceAlt,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  evidenciaIconText: { fontSize: 24 },
  evidenciaContent: { flex: 1 },
  evidenciaCardTitle: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary, marginBottom: 2 },
  evidenciaCardDesc: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },
  evidenciaArrow: { fontSize: 28, color: '#b2bec3', fontWeight: '300', marginLeft: SPACING.sm },
  fotosRow: { flexDirection: 'row', marginBottom: SPACING.sm },
  fotoThumb: { marginRight: SPACING.sm, position: 'relative' },
  fotoImg: { width: 70, height: 70, borderRadius: BORDER_RADIUS.sm, marginRight: SPACING.sm },
  fotoAdd: { width: 70, height: 70, borderRadius: BORDER_RADIUS.sm, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed' },
  fotoAddText: { fontSize: 24 },
  fotoRemove: { position: 'absolute', top: -6, right: 2, backgroundColor: COLORS.error, borderRadius: 10, width: 20, height: 20, justifyContent: 'center', alignItems: 'center' },
  fotoRemoveText: { color: '#fff', fontSize: 12, fontWeight: FONTS.weights.bold },
  fotoOverlay: {
    position: 'absolute', top: 0, left: 0, right: SPACING.sm, bottom: 0,
    backgroundColor: 'rgba(0,0,0,0.35)', borderRadius: BORDER_RADIUS.sm,
    justifyContent: 'center', alignItems: 'center',
  },
  fotoOverlayError: { backgroundColor: 'rgba(211,47,47,0.45)' },
  fotoOverlayText: { fontSize: 20 },
  chipsWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.xs, marginBottom: SPACING.sm },
  chip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: COLORS.surfaceAlt, borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.sm, paddingVertical: 6, maxWidth: '100%',
  },
  chipText: { fontSize: FONTS.sizes.xs, color: COLORS.textPrimary },
  chipRemove: { fontSize: 12, color: COLORS.error, fontWeight: FONTS.weights.bold, marginLeft: 4 },
  firmaOk: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  firmaImg: { width: 100, height: 60, borderRadius: BORDER_RADIUS.sm, backgroundColor: COLORS.background, marginRight: SPACING.sm },
  link: { color: COLORS.info, fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.medium },
  btnSecundario: { backgroundColor: COLORS.background, borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, paddingVertical: SPACING.sm, alignItems: 'center', marginTop: 4 },
  btnSecundarioText: { color: COLORS.textPrimary, fontWeight: FONTS.weights.medium, fontSize: FONTS.sizes.sm },
  input: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm, minHeight: 60, textAlignVertical: 'top',
    fontSize: FONTS.sizes.sm, color: COLORS.textPrimary,
  },
  btnPrincipal: { backgroundColor: COLORS.success, borderRadius: BORDER_RADIUS.md, paddingVertical: SPACING.sm, alignItems: 'center', marginTop: SPACING.md },
  btnPrincipalText: { color: '#fff', fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.md },
  btnAprobar: { backgroundColor: COLORS.info },
  btnDeshabilitado: { backgroundColor: COLORS.textLight },
  otraEvidencia: { marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.divider },
  firmasRow: { flexDirection: 'row', gap: SPACING.sm },
  // Miniatura de video — mismo lenguaje visual que las miniaturas de foto,
  // para que quede claro que también se puede tocar (antes era solo texto).
  videoThumbWrap: { marginRight: SPACING.sm, width: 80, position: 'relative' },
  videoThumb: {
    width: 80, height: 70, borderRadius: BORDER_RADIUS.sm,
    backgroundColor: '#1a1a2e', justifyContent: 'center', alignItems: 'center',
  },
  videoThumbIcon: { fontSize: 28 },
  videoThumbLabel: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 2, textAlign: 'center' },
  firmaPreviewRow: { marginBottom: SPACING.sm },
  tapHint: { fontSize: FONTS.sizes.xs, color: COLORS.info, marginTop: 2 },
  // Pantalla dedicada de firma (Modal) — así el gesto de dibujar no
  // compite con el scroll del detalle del formulario.
  firmaModalContainer: { flex: 1, backgroundColor: COLORS.background, padding: SPACING.md },
  firmaModalHeader: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  firmaModalTitle: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  firmaModalClose: { fontSize: FONTS.sizes.md, color: COLORS.error, fontWeight: FONTS.weights.medium },
  firmaModalPadContainer: { flex: 1, marginVertical: SPACING.sm },
});

const rev = StyleSheet.create({
  section: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    marginBottom: SPACING.md,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.info,
    ...SHADOWS.sm,
  },
  title: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  chipsRow: { flexDirection: 'row', gap: SPACING.sm, flexWrap: 'wrap', marginBottom: SPACING.sm },
  chip: { paddingHorizontal: SPACING.sm, paddingVertical: 4, borderRadius: BORDER_RADIUS.full },
  chipOk: { backgroundColor: COLORS.success + '22' },
  chipNov: { backgroundColor: COLORS.warning + '22' },
  chipPend: { backgroundColor: COLORS.divider },
  chipText: { fontSize: FONTS.sizes.sm, color: COLORS.textPrimary },
  novedadesBox: { marginBottom: SPACING.sm },
  novedadesTitle: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.error, marginBottom: 4 },
  novedadItem: { borderLeftWidth: 3, borderLeftColor: COLORS.error, paddingLeft: SPACING.sm, marginBottom: SPACING.xs },
  novedadMeta: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary },
  novedadTexto: { fontSize: FONTS.sizes.md, color: COLORS.textPrimary },
  sinRevisiones: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginBottom: SPACING.sm },
  botonesRow: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.xs },
  boton: { flex: 1, paddingVertical: SPACING.sm, borderRadius: BORDER_RADIUS.md, alignItems: 'center', paddingHorizontal: SPACING.sm },
  botonNovedad: { backgroundColor: COLORS.info },
  botonOk: { backgroundColor: COLORS.success },
  botonCancelar: { backgroundColor: COLORS.divider },
  botonDeshabilitado: { backgroundColor: COLORS.textLight },
  botonTexto: { color: '#fff', fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.sm, textAlign: 'center' },
  botonTextoOscuro: { color: COLORS.textPrimary, fontWeight: FONTS.weights.medium, fontSize: FONTS.sizes.sm },
  modalFondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: SPACING.lg },
  modalScroll: { flexGrow: 1, justifyContent: 'center' },
  modalCard: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.lg },
  modalTitulo: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, marginBottom: SPACING.xs },
  modalSub: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginBottom: SPACING.sm },
  inputMultiline: {
    borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm, minHeight: 70, textAlignVertical: 'top',
    fontSize: FONTS.sizes.md, color: COLORS.textPrimary, marginBottom: SPACING.sm,
  },
  modalBotones: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.xs },
});

const FormularioDetailScreen: React.FC<FormularioDetailScreenProps> = ({ route, navigation: _navigation }) => {
  const { formulario, modo } = route.params;
  const insets = useSafeAreaInsets();
  const { user: usuarioActual } = useAuth();
  const rolActual = usuarioActual?.rol || 'tecnico';
  const esRevisorActual = ['supervisor', 'interventor', 'gerente', 'admin'].includes(rolActual);
  /**
   * Modo de la pantalla: 'online' y 'campo' habilitan los controles de
   * Novedad/Aprobado por sección (revisión); solo 'campo' añade además la
   * Sección del Administrador (evidencia propia del revisor) al final.
   * Sin modo (entrada normal desde "Ver"/"PDF") se ve el formulario tal
   * cual lo diligenció el técnico, sin nada de revisión.
   */
  const mostrarRevision = modo === 'online' || modo === 'campo';
  const mostrarSeccionFinalRevisor = modo === 'campo';
  const { revisiones, cargando: cargandoRevisiones, recargar: recargarRevisiones } = useRevisiones(formulario.id);
  const [generatingPdf, setGeneratingPdf] = useState(false);
  const [pdfUri, setPdfUri] = useState<string | null>(null);
  const [showPdf, setShowPdf] = useState(false);
  /** Evidencia abierta en visor ampliado (null = cerrado) */
  const [fotoPreview, setFotoPreview] = useState<FotoGeotag | null>(null);
  const [videoPreview, setVideoPreview] = useState<FotoGeotag | null>(null);
  /** Firma abierta en visor ampliado (null = cerrado) */
  const [firmaPreview, setFirmaPreview] = useState<{ uri: string; headers: Record<string, string>; titulo: string } | null>(null);
  /**
   * Evidencias recuperadas del servidor cuando los archivos locales no
   * existen (formulario abierto desde otro teléfono). null = usar las
   * del formulario, que están en este dispositivo.
   */
  const [evidenciasRemotas, setEvidenciasRemotas] = useState<FotoGeotag[] | null>(null);
  /** Cabeceras de autenticación para descargar evidencias de la API */
  const [authHeaders, setAuthHeaders] = useState<Record<string, string>>({});
  /** Documentos de finca vinculados a este formulario — visibles para todos los roles */
  const [documentos, setDocumentos] = useState<DocumentoDeFormulario[]>([]);
  const [abriendoDocumentoId, setAbriendoDocumentoId] = useState<string | null>(null);
  /**
   * Firmas listas para <Image>: URI + cabeceras si hace falta autenticación.
   * null = no registrada; undefined (estado inicial) = aún resolviendo.
   */
  const [firmasResueltas, setFirmasResueltas] = useState<{
    beneficiario: FirmaResuelta | null;
    tecnico: FirmaResuelta | null;
  } | null>(null);

  // Las evidencias mostradas: locales si están, remotas si no
  const evidencias = evidenciasRemotas ?? formulario.fotos ?? [];
  /** Una evidencia servida por la API necesita la cabecera Authorization */
  const fuenteEvidencia = useCallback(
    (uri: string) =>
      uri.startsWith('http') ? { uri, headers: authHeaders } : { uri },
    [authHeaders]
  );

  useEffect(() => {
    let cancelado = false;
    (async () => {
      try {
        const [headers, remotas, docs, firmas] = await Promise.all([
          cabecerasDeArchivo(),
          resolverEvidenciasRemotas(formulario.id, formulario.fotos),
          fetchDocumentosDeFormulario(formulario.id),
          resolverFirmasRemotas(formulario.id, formulario.firma_beneficiario, formulario.firma_tecnico),
        ]);
        if (cancelado) return;
        setAuthHeaders(headers);
        if (remotas) setEvidenciasRemotas(remotas);
        setDocumentos(docs);
        setFirmasResueltas(firmas);
      } catch (e) {
        console.warn('[Detalle] No se pudieron resolver las evidencias:', e);
      }
    })();
    return () => {
      cancelado = true;
    };
  }, [formulario.id, formulario.fotos]);

  /**
   * Abrir un documento de finca: se descarga (con autenticación) a un
   * archivo temporal y se ofrece con el selector nativo "Abrir con…", ya
   * que un documento puede ser PDF, imagen, Word, Excel, etc. — no tiene
   * sentido construir un visor propio por cada formato posible.
   */
  const abrirDocumento = async (doc: DocumentoDeFormulario) => {
    setAbriendoDocumentoId(doc.id);
    try {
      const headers = await cabecerasDeArchivo();
      const url = doc.url.startsWith('http') ? doc.url : `${API_CONFIG.BASE_URL}${doc.url}`;
      const extension = doc.nombre.includes('.') ? doc.nombre.split('.').pop() : 'dat';
      const destino = `${FileSystem.cacheDirectory}doc_${doc.id}.${extension}`;
      const { uri } = await FileSystem.downloadAsync(url, destino, { headers });

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: doc.mimetype });
      } else {
        Alert.alert('Documento descargado', `Guardado en: ${uri}`);
      }
    } catch (e) {
      console.warn('[Detalle] No se pudo abrir el documento:', doc.id, e);
      Alert.alert('Error', 'No se pudo abrir el documento. Verifica tu conexión.');
    } finally {
      setAbriendoDocumentoId(null);
    }
  };
  const { height: SCREEN_HEIGHT } = Dimensions.get('window');
  const PDF_HEIGHT = SCREEN_HEIGHT * 0.55;

  const generarHtml = async (): Promise<string> => {
    const f = formulario;

    // Convertir fotos con redimensionamiento (async)
    const fotosHtml = await convertirFotosAHTML(f.fotos || []);

    // Firmas (ya están en base64 data URIs)
    const firmaBenefHtml = f.firma_beneficiario
      ? `<div class="firma-item"><p class="evidencia-label">✍️ Firma del Beneficiario — <strong>${escapeHtml(f.beneficiario.nombre)}</strong> (C.C. ${escapeHtml(f.beneficiario.cedula || '—')})</p><img src="${f.firma_beneficiario}" alt="Firma del beneficiario" class="firma-img" /></div>`
      : `<div class="firma-item"><p class="evidencia-label">✍️ Firma del Beneficiario</p><p class="no-data">No registrada</p></div>`;

    const firmaTecHtml = f.firma_tecnico
      ? `<div class="firma-item"><p class="evidencia-label">🖊️ Firma del Técnico — <strong>${escapeHtml(f.tecnico.nombre)}</strong> (C.C. ${escapeHtml(f.tecnico.cedula || '—')})</p><img src="${f.firma_tecnico}" alt="Firma del técnico" class="firma-img" /></div>`
      : `<div class="firma-item"><p class="evidencia-label">🖊️ Firma del Técnico</p><p class="no-data">No registrada</p></div>`;

    // Sello biométrico con gráfico de huella SVG (async-safe)
    const huellaHtml = f.huella_beneficiario
      ? generarSelloBiometrico(f.beneficiario.nombre)
      : `<div class="evidencia-item"><p class="evidencia-label">🖐️ Huella Biométrica</p><p class="no-data">No registrada</p></div>`;

    const c = (f as any).caracterizacion_nueva as DatosCaracterizacionNueva | undefined;

    const valOr = (v: string | undefined | null): string => v || '—';

    const row2 = (label: string, val: string | undefined | null) =>
      val ? `<div class="row"><span class="label">${label}:</span><span class="value">${escapeHtml(val)}</span></div>` : '';

    const section2 = (title: string, icon: string, rows: string) =>
      rows ? `<div class="section"><h2>${icon} ${title}</h2>${rows}</div>` : '';

    // Caracterización sections (if applicable)
    let caracterizacionHtml = '';
    if (c) {
      const cs = c.componente_social;
      const cp = c.componente_productivo;
      const ca = c.componente_agroambiental;
      const as = c.analisis_suelo;
      const rec = c.recomendaciones;

      const datosGenerales = `
        <div class="row"><span class="label">Municipio:</span><span class="value">${escapeHtml(valOr(c.municipio))}</span></div>
        <div class="row"><span class="label">Fecha:</span><span class="value">${escapeHtml(valOr(c.fecha))}</span></div>
        <div class="row"><span class="label">Vereda:</span><span class="value">${escapeHtml(valOr(c.vereda))}</span></div>
        <div class="row"><span class="label">N° Encuesta:</span><span class="value">${escapeHtml(valOr(c.encuesta_numero))}</span></div>
        <div class="row"><span class="label">Productor:</span><span class="value">${escapeHtml(valOr(c.productor_nombre))}</span></div>
        <div class="row"><span class="label">Documento:</span><span class="value">${escapeHtml(valOr(c.documento))}</span></div>
        <div class="row"><span class="label">Teléfono:</span><span class="value">${escapeHtml(valOr(c.telefono))}</span></div>
        <div class="row"><span class="label">Técnico:</span><span class="value">${escapeHtml(valOr(c.tecnico_responsable))}</span></div>
        <div class="row"><span class="label">Finca / Predio:</span><span class="value">${escapeHtml(valOr(c.finca))}</span></div>
      `;
      const socialRows = [
        row2('1. Nivel educativo del productor', cs?.nivel_educativo),
        row2('2. Personas del núcleo familiar', cs?.personas_nucleo),
        row2('3. Principal fuente de ingresos', cs?.fuente_ingresos),
        row2('4. Participa en organización o asociación', cs?.participa_organizacion),
        row2('5. Acceso a servicios públicos básicos', cs?.servicios_publicos),
        row2('6. Mano de obra utilizada', cs?.mano_obra),
      ].join('');
      const prodRows = [
        row2('7. Principal actividad productiva', cp?.actividad_productiva),
        row2('8. Acceso permanente al agua', cp?.acceso_agua),
        row2('9. Dispone de sistemas de riego', cp?.sistemas_riego),
        row2('10. Ha recibido asistencia técnica', cp?.asistencia_tecnica),
      ].join('');
      const agroRows = [
        row2('11. Procesos de erosión', ca?.procesos_erosion),
        row2('12. Fuentes hídricas', ca?.fuentes_hidricas),
        row2('13. Áreas de conservación o protección', ca?.areas_conservacion),
        row2('14. Prácticas de conservación del suelo', ca?.practicas_conservacion),
        row2('15. Manejo de residuos de agroquímicos', ca?.manejo_residuos),
      ].join('');
      const sueloRows = [
        row2('16. Observación del suelo', as?.observacion_suelo),
        row2('17. Textura predominante', as?.textura),
        row2('18. Color predominante', as?.color),
        row2('19. Drenaje del suelo', as?.drenaje),
        row2('20. Uso de la tierra', (as as any)?.uso_tierra),
        row2('21. Presencia de piedras', as?.piedras),
        row2('22. Compactación del suelo', as?.compactacion),
        row2('23. Cobertura del suelo', as?.cobertura),
        row2('24. Evidencia de erosión', as?.evidencia_erosion),
      ].join('');
      const recomHtml = (rec?.recomendaciones_tecnicas || rec?.recomendaciones_ambientales) ? `
        <div class="section"><h2>📝 Recomendaciones del Técnico</h2>
        ${rec?.recomendaciones_tecnicas ? `<div class="row" style="margin-bottom:4px;"><span class="label">25. Recomendaciones técnicas:</span></div><div class="desc-detallada">${escapeHtml(rec.recomendaciones_tecnicas)}</div>` : ''}
        ${rec?.recomendaciones_ambientales ? `<div class="row" style="margin-top:12px;margin-bottom:4px;"><span class="label">26. Recomendaciones ambientales:</span></div><div class="desc-detallada">${escapeHtml(rec.recomendaciones_ambientales)}</div>` : ''}
        </div>` : '';

      caracterizacionHtml = `
        <div class="section"><h2>📋 Datos Generales</h2>${datosGenerales}</div>
        ${section2('Componente Social', '👥', socialRows)}
        ${section2('Componente Productivo', '🌱', prodRows)}
        ${section2('Componente Agroambiental', '🌿', agroRows)}
        ${section2('Análisis de Suelo', '🔬', sueloRows)}
        ${recomHtml}
      `;
    }

    return `<!DOCTYPE html>
<html lang="es">
<head><meta charset="utf-8"><title>Formulario ${f.id}</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Helvetica Neue', Arial, sans-serif; margin: 40px; color: #2d3436; line-height: 1.6; }
  .header { text-align: center; border-bottom: 3px solid #1B5E20; padding-bottom: 16px; margin-bottom: 24px; }
  .header h1 { color: #1B5E20; font-size: 24px; margin-bottom: 4px; }
  .header p { color: #636e72; font-size: 13px; }
  .section { margin: 20px 0; padding: 16px 20px; background: #f8f9fa; border-radius: 8px; border-left: 4px solid #1B5E20; }
  .section h2 { color: #1B5E20; font-size: 16px; margin-bottom: 12px; border-bottom: 1px solid #e0e0e0; padding-bottom: 6px; }
  .row { display: flex; margin: 3px 0; font-size: 13px; }
  .label { font-weight: bold; color: #555; min-width: 160px; }
  .value { flex: 1; color: #2d3436; }
  .foto-item { margin: 16px 0; padding: 12px; background: #fff; border-radius: 6px; border: 1px solid #e0e0e0; page-break-inside: avoid; }
  .foto-img { width: 100%; max-width: 350px; max-height: 240px; height: auto; border-radius: 4px; margin: 8px auto; display: block; object-fit: cover; }
  .foto-coords { font-size: 11px; color: #636e72; font-family: monospace; }
  .foto-heading { font-size: 11px; color: #0984e3; font-family: monospace; }
  .firma-item { display: inline-block; vertical-align: top; margin: 8px; padding: 12px; background: #fff; border-radius: 6px; border: 1px solid #e0e0e0; page-break-inside: avoid; width: calc(50% - 16px); min-width: 200px; }
  .firmas-contiguo { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; }
  .evidencia-item { margin: 12px 0; padding: 12px; background: #fff; border-radius: 6px; border: 1px solid #e0e0e0; page-break-inside: avoid; }
  .evidencia-label { font-size: 13px; color: #2d3436; margin-bottom: 8px; }
  .firma-img { max-width: 100%; max-height: 100px; border: 1px dashed #b2bec3; border-radius: 4px; padding: 8px; background: #fff; }
  .desc-detallada { font-size: 13px; color: #2d3436; background: #fff; padding: 10px; border-radius: 4px; border: 1px solid #e0e0e0; margin-top: 6px; line-height: 1.5; }
  /* --- Sello de verificación biométrica --- */
  .huella-sello { margin: 16px 0; page-break-inside: avoid; }
  .huella-sello-inner { background: linear-gradient(135deg, #f0fdf4 0%, #dcfce7 100%); border: 2px solid #1B5E20; border-radius: 12px; padding: 20px; box-shadow: 0 2px 8px rgba(27,94,32,0.15); }
  .huella-sello-header { display: flex; align-items: center; gap: 16px; border-bottom: 1px solid #bbf7d0; padding-bottom: 14px; margin-bottom: 14px; }
  .huella-sello-img { width: 64px; height: 64px; flex-shrink: 0; }
  .huella-sello-titles { flex: 1; }
  .huella-sello-verificado { font-size: 20px; font-weight: bold; color: #15803d; }
  .huella-sello-label { font-size: 13px; color: #16a34a; }
  .huella-sello-body { margin-bottom: 14px; }
  .huella-sello-table { width: 100%; border-collapse: collapse; }
  .huella-sello-table td { padding: 4px 8px; font-size: 13px; }
  .huella-sello-label-cell { color: #555; font-weight: bold; width: 120px; }
  .huella-sello-value-cell { color: #2d3436; }
  .huella-sello-exitoso { display: inline-block; background: #15803d; color: #fff; font-size: 12px; font-weight: bold; padding: 2px 12px; border-radius: 10px; }
  .huella-sello-footer { text-align: center; border-top: 1px solid #bbf7d0; padding-top: 12px; }
  .huella-sello-stamp { display: inline-block; font-size: 14px; font-weight: bold; color: #15803d; letter-spacing: 1px; border: 2px solid #15803d; border-radius: 6px; padding: 4px 16px; transform: rotate(-2deg); }
  /* --- Fin sello biométrico --- */
  .no-data { font-size: 12px; color: #b2bec3; font-style: italic; padding: 8px 0; }
  .desc-detallada { font-size: 13px; color: #2d3436; background: #fff; padding: 10px; border-radius: 4px; border: 1px solid #e0e0e0; margin-top: 6px; line-height: 1.5; }
  .footer { margin-top: 40px; padding-top: 16px; border-top: 1px solid #e0e0e0; text-align: center; font-size: 11px; color: #b2bec3; }
  @media print { .foto-img { max-width: 100%; } .section { break-inside: avoid; } }
</style></head>
<body>
  <div class="header">
    <h1>🌱 GEODAILY — ${c || f.tipo === 'caracterizacion' ? 'Caracterización Sociodemográfica' : 'Formulario de Campo'}</h1>
    <p><strong>ID:</strong> ${escapeHtml(f.id)} | <strong>Tipo:</strong> ${c || f.tipo === 'caracterizacion' ? 'Caracterización Sociodemográfica' : 'Visita Técnica'} | <strong>Fecha:</strong> ${c?.fecha || formatFecha(f.created_at)}</p>
  </div>

  ${caracterizacionHtml}

  <div class="section">
    <h2>👤 Datos del Técnico</h2>
    <div class="row"><span class="label">Nombre:</span><span class="value">${escapeHtml(f.tecnico.nombre)}</span></div>
    <div class="row"><span class="label">Cédula:</span><span class="value">${escapeHtml(f.tecnico.cedula)}</span></div>
    <div class="row"><span class="label">Teléfono:</span><span class="value">${escapeHtml(f.tecnico.telefono || '—')}</span></div>
    <div class="row"><span class="label">Email:</span><span class="value">${escapeHtml(f.tecnico.email || '—')}</span></div>
  </div>

  <div class="section">
    <h2>👥 Datos del Beneficiario</h2>
    <div class="row"><span class="label">Nombre:</span><span class="value">${escapeHtml(f.beneficiario.nombre)}</span></div>
    <div class="row"><span class="label">Cédula:</span><span class="value">${escapeHtml(f.beneficiario.cedula || '—')}</span></div>
    <div class="row"><span class="label">Teléfono:</span><span class="value">${escapeHtml(f.beneficiario.telefono || '—')}</span></div>
    <div class="row"><span class="label">Departamento:</span><span class="value">${escapeHtml(f.beneficiario.departamento || '—')}</span></div>
    <div class="row"><span class="label">Municipio:</span><span class="value">${escapeHtml(f.beneficiario.municipio || '—')}</span></div>
    <div class="row"><span class="label">Vereda:</span><span class="value">${escapeHtml(f.beneficiario.vereda || '—')}</span></div>
    <div class="row"><span class="label">Finca:</span><span class="value">${escapeHtml(f.beneficiario.finca || '—')}</span></div>
  </div>

  <div class="section">
    <h2>📋 Actividad Realizada</h2>
    <div class="row"><span class="label">Tipo:</span><span class="value">${escapeHtml(f.actividad.descripcion || '—')}</span></div>
    ${f.actividad.descripcion_detallada ? `<div class="row"><span class="label">Descripción detallada:</span></div><div class="desc-detallada">${escapeHtml(f.actividad.descripcion_detallada)}</div>` : ''}
    <div class="row" style="margin-top:8px;"><span class="label">Observaciones:</span><span class="value">${escapeHtml(f.actividad.observaciones || '—')}</span></div>
    <div class="row"><span class="label">Recomendaciones:</span><span class="value">${escapeHtml(f.actividad.recomendaciones || '—')}</span></div>
  </div>

  <div class="section">
    <h2>📍 Ubicación Geográfica</h2>
    <div class="row"><span class="label">Latitud:</span><span class="value">${f.coordenadas?.latitud?.toFixed(6) || '—'}</span></div>
    <div class="row"><span class="label">Longitud:</span><span class="value">${f.coordenadas?.longitud?.toFixed(6) || '—'}</span></div>
    ${f.coordenadas?.altitud ? `<div class="row"><span class="label">Altitud:</span><span class="value">${f.coordenadas.altitud.toFixed(1)} m</span></div>` : ''}
    ${f.coordenadas?.precision_gps ? `<div class="row"><span class="label">Precisión:</span><span class="value">±${f.coordenadas.precision_gps} m</span></div>` : ''}
  </div>

  ${f.clima?.actual ? `
  <div class="section">
    <h2>🌤 Condiciones Ambientales</h2>
    <div class="row"><span class="label">Ubicación:</span><span class="value">${escapeHtml(f.clima.actual.ubicacion?.nombre || f.clima.ubicacion?.latitud?.toFixed(4) + ', ' + f.clima.ubicacion?.longitud?.toFixed(4) || '—')}</span></div>
    <div class="row"><span class="label">Temperatura:</span><span class="value">${f.clima.actual.temperatura?.actual != null ? Math.round(f.clima.actual.temperatura.actual) + '°C' : '—'}</span></div>
    <div class="row"><span class="label">Sensación térmica:</span><span class="value">${f.clima.actual.temperatura?.sensacion_termica != null ? Math.round(f.clima.actual.temperatura.sensacion_termica) + '°C' : '—'}</span></div>
    <div class="row"><span class="label">Humedad:</span><span class="value">${f.clima.actual.humedad != null ? f.clima.actual.humedad + '%' : '—'}</span></div>
    <div class="row"><span class="label">Viento:</span><span class="value">${f.clima.actual.viento?.velocidad != null ? Math.round(f.clima.actual.viento.velocidad) + ' m/s' : '—'}</span></div>
    <div class="row"><span class="label">Nubosidad:</span><span class="value">${f.clima.actual.nubosidad != null ? f.clima.actual.nubosidad + '%' : '—'}</span></div>
    <div class="row"><span class="label">Presión:</span><span class="value">${f.clima.actual.presion != null ? f.clima.actual.presion + ' hPa' : '—'}</span></div>
    <div class="row"><span class="label">Visibilidad:</span><span class="value">${f.clima.actual.visibilidad != null ? f.clima.actual.visibilidad + ' km' : '—'}</span></div>
  </div>
  ` : ''}

  <!-- EVIDENCIAS AL FINAL (como documentos oficiales) -->
  <div class="section">
    <h2>📸 Evidencias de Campo</h2>

    <h3 style="color:#0984e3;font-size:14px;margin:12px 0 4px;">Fotografías</h3>
    ${fotosHtml}

    <h3 style="color:#0984e3;font-size:14px;margin:16px 0 4px;">Firmas</h3>
    <div class="firmas-contiguo">
      ${firmaBenefHtml}
      ${firmaTecHtml}
    </div>

    <h3 style="color:#0984e3;font-size:14px;margin:16px 0 4px;">Registro Biométrico</h3>
    ${huellaHtml}
  </div>

  <div class="footer">
    <p>Documento generado por GEODAILY — ${new Date().toISOString()}</p>
    <p>Este es un documento digital válido como evidencia de campo.</p>
  </div>
</body></html>`;
  };

  // Helper escapeHtml
  function escapeHtml(text: string): string {
    if (!text) return '';
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#039;');
  }

  // Generar el PDF local SIEMPRE con el generador canónico del servicio,
  // sea cual sea el tipo de formulario. Es el único que aplica el membrete
  // oficial de ACPR (encabezado y pie repetidos en todas las páginas,
  // tamaño Carta) además de las 52 preguntas, clima, GPS y anexo de videos.
  //
  // Antes solo la Encuesta Social AgroAmbiental pasaba por él: las visitas
  // técnicas caían al generador de esta pantalla, que no lleva membrete —
  // por eso el formato institucional no salía en el PDF generado.
  const generarPdfUri = async (): Promise<string | null> => {
    try {
      const { generarPDFLocal } = await import('../../services/pdfLocal.service');
      // 'evidencias' ya está resuelto (local si existe en este dispositivo,
      // o URL del servidor si no) — antes se pasaba 'formulario' a secas y
      // el generador leía formulario.fotos directo, con rutas file:// que
      // solo existen en el teléfono que capturó la visita. Generar el PDF
      // desde cualquier otro rol/dispositivo daba un documento sin fotos.
      const uri = await generarPDFLocal(formulario, undefined, evidencias);
      if (uri) return uri;
      console.warn('[PDF] El generador canónico falló, usando el de respaldo');
    } catch (e) {
      console.warn('[PDF] Error en el generador canónico, usando el de respaldo:', e);
    }
    // Respaldo: generador propio de la pantalla (sin membrete)
    const html = await generarHtml();
    const { uri } = await Print.printToFileAsync({ html });
    return uri;
  };

  /**
   * Mostrar un PDF ya existente en disco.
   *
   * El WebView de Android NO tiene visor de PDF nativo: al cargar un
   * file://…/x.pdf mostraba una pantalla en blanco — por eso "Ver PDF"
   * parecía no hacer nada. En Android se abre con el visor del sistema
   * mediante un content:// URI; en iOS el WKWebView sí renderiza PDFs,
   * así que allí se mantiene la vista previa embebida.
   */
  const mostrarPdf = async (uri: string) => {
    if (Platform.OS !== 'android') {
      setPdfUri(uri);
      setShowPdf(true);
      return;
    }

    try {
      // Android exige content:// — un file:// lanza FileUriExposedException
      const contentUri = await FileSystem.getContentUriAsync(uri);
      await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
        data: contentUri,
        flags: 1, // FLAG_GRANT_READ_URI_PERMISSION
        type: 'application/pdf',
      });
    } catch (e) {
      console.warn('[PDF] Sin visor de PDF instalado, ofreciendo compartir:', e);
      // Sin app lectora de PDF: ofrecer abrir/guardar por otra vía
      try {
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri, {
            mimeType: 'application/pdf',
            UTI: 'com.adobe.pdf',
          });
        } else {
          Alert.alert(
            'No se puede abrir el PDF',
            'No hay un lector de PDF instalado en este dispositivo. Usa "Descargar PDF" para guardarlo.'
          );
        }
      } catch {
        Alert.alert('Error', 'No se pudo abrir el PDF');
      }
    }
  };

  const handleViewPDF = async () => {
    setGeneratingPdf(true);
    try {
      // 1. Regenerar el PDF a partir de los datos del formulario.
      //    Es una operación local (funciona sin conexión) y garantiza que
      //    el documento salga siempre con el membrete vigente: los PDF
      //    guardados en pdf_url antes de implementarlo conservan el
      //    formato antiguo, y reutilizarlos hacía que "Ver PDF" mostrara
      //    un documento sin encabezado ni pie institucional.
      const generado = await generarPdfUri();
      if (generado) {
        await mostrarPdf(generado);
        return;
      }

      // 2. Si no se pudo generar y hay una copia en este dispositivo, usarla
      if (formulario.pdf_url?.startsWith('file://')) {
        const info = await FileSystem.getInfoAsync(formulario.pdf_url);
        if (info.exists) {
          await mostrarPdf(formulario.pdf_url);
          return;
        }
        console.warn('[PDF] El PDF local ya no existe');
      }

      // 3. Último recurso: descargar el PDF del servidor
      if (formulario.pdf_url && !formulario.pdf_url.startsWith('file://')) {
        const url = formulario.pdf_url.startsWith('http')
          ? formulario.pdf_url
          : `${API_CONFIG.BASE_URL}${formulario.pdf_url}`;
        try {
          if (!FileSystem.documentDirectory) {
            throw new Error('documentDirectory no disponible');
          }
          const { uri: localUri } = await FileSystem.downloadAsync(
            url,
            FileSystem.documentDirectory + 'pdf_preview.pdf'
          );
          await mostrarPdf(localUri);
          return;
        } catch {
          console.warn('[PDF] No se pudo descargar el remoto');
        }
      }

      throw new Error('sin uri');
    } catch (e) {
      Alert.alert('Error', 'No se pudo generar el PDF');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const handleClosePdf = () => {
    setShowPdf(false);
    setPdfUri(null);
  };

  const handleSharePDF = async () => {
    if (!pdfUri) {
      // Si no hay pdfUri, generar primero
      setGeneratingPdf(true);
      try {
        const uri = await generarPdfUri();
        if (!uri) throw new Error('sin uri');
        if (await Sharing.isAvailableAsync()) {
          await Sharing.shareAsync(uri);
        } else {
          Alert.alert('Compartir no disponible', 'El dispositivo no soporta compartir archivos');
        }
      } catch {
        Alert.alert('Error', 'No se pudo generar el PDF');
      } finally {
        setGeneratingPdf(false);
      }
      return;
    }
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(pdfUri);
    } else {
      Alert.alert('Compartir no disponible', 'El dispositivo no soporta compartir archivos');
    }
  };

  const handleDownloadPDF = async () => {
    setGeneratingPdf(true);
    try {
      const uri = await generarPdfUri();
      if (!uri) throw new Error('sin uri');

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri);
      } else {
        Alert.alert('PDF generado', `PDF disponible en: ${uri}`);
      }
    } catch (e) {
      Alert.alert('Error', 'No se pudo descargar el PDF');
    } finally {
      setGeneratingPdf(false);
    }
  };

  const evidenciaCount = [
    ...evidencias,
    ...(formulario.firma_beneficiario ? [true] : []),
    ...(formulario.firma_tecnico ? [true] : []),
    ...(formulario.huella_beneficiario ? [true] : []),
  ].length;

  /** Control de Novedad/Aprobado al pie de cada sección, solo en modo revisión. */
  const renderMiniRevision = (seccionTitulo: string) =>
    mostrarRevision ? (
      <SeccionMiniRevision
        formularioId={formulario.id}
        seccionTitulo={seccionTitulo}
        revisiones={revisiones}
        rol={rolActual}
        esRevisor={esRevisorActual}
        recargar={recargarRevisiones}
      />
    ) : null;

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SPACING.xxl }]}>
        {/* Estado del formulario */}
        <View style={styles.statusBar}>
          <Text style={styles.statusTipo}>
            {(formulario as any).caracterizacion_nueva || formulario.tipo === 'caracterizacion'
              ? 'Caracterización Sociodemográfica'
              : formulario.tipo === 'visita_tecnica'
              ? 'Visita Técnica'
              : 'Plantación'}
          </Text>
          <Text style={[styles.statusSync, formulario.sincronizado && styles.statusSyncOk]}>
            {formulario.sincronizado ? '✓ Sincronizado' : '⏳ Pendiente'}
          </Text>
        </View>

        {/* Revisión jerárquica: novedades y vistos buenos — solo en modo
            "Revisión en línea"/"Revisión en campo", nunca en el formulario
            normal que ve el técnico. */}
        {mostrarRevision && (
          <SeccionRevision
            formulario={formulario}
            revisiones={revisiones}
            cargando={cargandoRevisiones}
            recargar={recargarRevisiones}
          />
        )}

        {/* Encuesta Social AgroAmbiental — resumen COMPLETO (53 preguntas).
            Las secciones vienen del esquema canónico compartido con el
            generador de PDF, así el detalle y el documento siempre coinciden.
            Cada sección trae su propio control de Novedad/Aprobado. */}
        {esEncuestaSocial(formulario) &&
          construirSeccionesEncuesta(
            (formulario as any).caracterizacion_nueva,
            formulario
          ).map((seccion) => (
            <View key={seccion.titulo} style={styles.section}>
              <Text style={styles.sectionTitle}>{seccion.titulo}</Text>
              {seccion.preguntas.map((pregunta) => (
                <View key={`${seccion.titulo}-${pregunta.numero}-${pregunta.texto}`} style={styles.pregunta}>
                  <Text style={styles.preguntaTexto}>
                    {pregunta.numero === '\u2022' ? '' : `${pregunta.numero}. `}
                    {pregunta.texto}
                  </Text>
                  <Text
                    style={[
                      styles.preguntaValor,
                      !pregunta.valor && styles.preguntaValorVacio,
                    ]}
                  >
                    {pregunta.valor || 'Sin responder'}
                  </Text>
                  {!!pregunta.observacion && (
                    <Text style={styles.preguntaObs}>Obs: {pregunta.observacion}</Text>
                  )}
                </View>
              ))}
              {mostrarRevision && (
                <SeccionMiniRevision
                  formularioId={formulario.id}
                  seccionTitulo={seccion.titulo}
                  revisiones={revisiones}
                  rol={rolActual}
                  esRevisor={esRevisorActual}
                  recargar={recargarRevisiones}
                />
              )}
            </View>
          ))}

        {/* Resumen de evidencias */}
        <View style={styles.evidenciasSummary}>
          <Text style={styles.evidenciasSummaryTitle}>📸 Evidencias ({evidenciaCount})</Text>
          <Text style={styles.evidenciasSummaryItem}>
            • {evidencias.filter(f => f.tipo !== 'video').length} foto(s)
          </Text>
          <Text style={styles.evidenciasSummaryItem}>
            • {evidencias.filter(f => f.tipo === 'video').length} video(s)
          </Text>
          <Text style={styles.evidenciasSummaryItem}>
            • Firma beneficiario: {formulario.firma_beneficiario ? '✓' : '✗'}
          </Text>
          <Text style={styles.evidenciasSummaryItem}>
            • Firma técnico: {formulario.firma_tecnico ? '✓' : '✗'}
          </Text>
          <Text style={styles.evidenciasSummaryItem}>
            • Huella biométrica: {formulario.huella_beneficiario ? '✓' : '✗'}
          </Text>
        </View>

        {/* Fotos/Videos en miniatura */}
        {evidencias.length > 0 && (
          <View style={styles.fotosSection}>
            <Text style={styles.sectionTitle}>
              Evidencias capturadas ({evidencias.length})
              {evidenciasRemotas ? ' · desde el servidor' : ''}
            </Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}>
              {evidencias.map((foto) => (
                <TouchableOpacity
                  key={foto.id}
                  style={styles.fotoThumbContainer}
                  // Los videos abren el reproductor; las fotos, el visor ampliado
                  onPress={() =>
                    foto.tipo === 'video'
                      ? setVideoPreview(foto)
                      : setFotoPreview(foto)
                  }
                  activeOpacity={0.8}
                >
                  {foto.tipo === 'video' ? (
                    <View style={styles.videoThumb}>
                      <Text style={styles.videoThumbIcon}>▶️</Text>
                    </View>
                  ) : (
                    <Image
                      source={fuenteEvidencia(foto.uri)}
                      style={styles.fotoThumb}
                    />
                  )}
                  {foto.tipo === 'video' && (
                    <Text style={styles.videoThumbLabel}>🎥</Text>
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
        {renderMiniRevision('Evidencias')}

        {/* Firmas recolectadas — antes solo se contaban (✓/✗) en el resumen
            de arriba, pero no había forma de VERLAS en la pantalla; solo
            aparecían dentro del PDF. Los roles de supervisión necesitan
            poder revisarlas aquí mismo, sin generar el documento completo. */}
        {(formulario.firma_beneficiario || formulario.firma_tecnico) && (
          <View style={styles.fotosSection}>
            <Text style={styles.sectionTitle}>✍️ Firmas</Text>
            <View style={styles.firmasRow}>
              <View style={styles.firmaCard}>
                <Text style={styles.firmaCardLabel}>
                  Beneficiario{formulario.beneficiario?.nombre ? ` — ${formulario.beneficiario.nombre}` : ''}
                </Text>
                {!formulario.firma_beneficiario ? (
                  <View style={[styles.firmaImg, styles.firmaImgVacia]}>
                    <Text style={styles.firmaVaciaTexto}>No registrada</Text>
                  </View>
                ) : !firmasResueltas ? (
                  <View style={[styles.firmaImg, styles.firmaImgVacia]}>
                    <ActivityIndicator size="small" color={COLORS.textSecondary} />
                  </View>
                ) : firmasResueltas.beneficiario ? (
                  <TouchableOpacity
                    onPress={() =>
                      setFirmaPreview({
                        uri: firmasResueltas.beneficiario!.uri,
                        headers: firmasResueltas.beneficiario!.headers,
                        titulo: `✍️ Firma del Beneficiario — ${formulario.beneficiario?.nombre || '—'}`,
                      })
                    }
                    activeOpacity={0.8}
                  >
                    <Image
                      source={{ uri: firmasResueltas.beneficiario.uri, headers: firmasResueltas.beneficiario.headers }}
                      style={styles.firmaImg}
                      resizeMode="contain"
                    />
                  </TouchableOpacity>
                ) : (
                  <View style={[styles.firmaImg, styles.firmaImgVacia]}>
                    <Text style={styles.firmaVaciaTexto}>No se pudo cargar</Text>
                  </View>
                )}
              </View>
              <View style={styles.firmaCard}>
                <Text style={styles.firmaCardLabel}>
                  Técnico{formulario.tecnico?.nombre ? ` — ${formulario.tecnico.nombre}` : ''}
                </Text>
                {!formulario.firma_tecnico ? (
                  <View style={[styles.firmaImg, styles.firmaImgVacia]}>
                    <Text style={styles.firmaVaciaTexto}>No registrada</Text>
                  </View>
                ) : !firmasResueltas ? (
                  <View style={[styles.firmaImg, styles.firmaImgVacia]}>
                    <ActivityIndicator size="small" color={COLORS.textSecondary} />
                  </View>
                ) : firmasResueltas.tecnico ? (
                  <TouchableOpacity
                    onPress={() =>
                      setFirmaPreview({
                        uri: firmasResueltas.tecnico!.uri,
                        headers: firmasResueltas.tecnico!.headers,
                        titulo: `🖊️ Firma del Técnico — ${formulario.tecnico?.nombre || '—'}`,
                      })
                    }
                    activeOpacity={0.8}
                  >
                    <Image
                      source={{ uri: firmasResueltas.tecnico.uri, headers: firmasResueltas.tecnico.headers }}
                      style={styles.firmaImg}
                      resizeMode="contain"
                    />
                  </TouchableOpacity>
                ) : (
                  <View style={[styles.firmaImg, styles.firmaImgVacia]}>
                    <Text style={styles.firmaVaciaTexto}>No se pudo cargar</Text>
                  </View>
                )}
              </View>
            </View>
            {renderMiniRevision('Firmas')}
          </View>
        )}

        {/* Documentos de la finca — visible para todos los roles, no solo
            el técnico que los subió. Antes no existía ninguna forma de que
            supervisión revisara los documentos de una visita. */}
        {documentos.length > 0 && (
          <View style={styles.fotosSection}>
            <Text style={styles.sectionTitle}>📎 Documentos de la finca ({documentos.length})</Text>
            {documentos.map((doc) => (
              <TouchableOpacity
                key={doc.id}
                style={styles.documentoItem}
                onPress={() => abrirDocumento(doc)}
                disabled={abriendoDocumentoId === doc.id}
                activeOpacity={0.7}
              >
                <Text style={styles.documentoIcon}>
                  {doc.mimetype?.includes('pdf') ? '📕' : doc.mimetype?.includes('image') ? '🖼️' : '📄'}
                </Text>
                <View style={styles.documentoInfo}>
                  <Text style={styles.documentoNombre} numberOfLines={1}>{doc.nombre}</Text>
                  <Text style={styles.documentoMeta}>
                    {formatFecha(doc.created_at)}
                    {doc.descripcion ? ` · ${doc.descripcion}` : ''}
                  </Text>
                </View>
                <Text style={styles.documentoAccion}>
                  {abriendoDocumentoId === doc.id ? '…' : '⬇️'}
                </Text>
              </TouchableOpacity>
            ))}
            {renderMiniRevision('Documentos')}
          </View>
        )}

        {/* Datos del Técnico */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>👤 Datos del Técnico</Text>
          <View style={styles.row}><Text style={styles.label}>Nombre:</Text><Text style={styles.value}>{formulario.tecnico?.nombre || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Cédula:</Text><Text style={styles.value}>{formulario.tecnico.cedula}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Teléfono:</Text><Text style={styles.value}>{formulario.tecnico.telefono || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Email:</Text><Text style={styles.value}>{formulario.tecnico.email || '—'}</Text></View>
          {renderMiniRevision('Datos del Técnico')}
        </View>

        {/* Datos del Beneficiario */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>👥 Datos del Beneficiario</Text>
          <View style={styles.row}><Text style={styles.label}>Nombre:</Text><Text style={styles.value}>{formulario.beneficiario?.nombre || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Cédula:</Text><Text style={styles.value}>{formulario.beneficiario.cedula || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Teléfono:</Text><Text style={styles.value}>{formulario.beneficiario.telefono || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Depto:</Text><Text style={styles.value}>{formulario.beneficiario.departamento || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Municipio:</Text><Text style={styles.value}>{formulario.beneficiario.municipio || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Vereda:</Text><Text style={styles.value}>{formulario.beneficiario.vereda || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Finca:</Text><Text style={styles.value}>{formulario.beneficiario.finca || '—'}</Text></View>
          {renderMiniRevision('Datos del Beneficiario')}
        </View>

        {/* Actividad (solo para formularios tradicionales) */}
        {!(formulario as any).caracterizacion_nueva && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📋 Actividad Realizada</Text>
            <View style={styles.row}><Text style={styles.label}>Descripción:</Text><Text style={styles.value}>{formulario.actividad.descripcion || '—'}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Observaciones:</Text><Text style={styles.value}>{formulario.actividad.observaciones || '—'}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Recomendaciones:</Text><Text style={styles.value}>{formulario.actividad.recomendaciones || '—'}</Text></View>
            {renderMiniRevision('Actividad Realizada')}
          </View>
        )}

        {/* Coordenadas */}
        {formulario.coordenadas && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📍 Ubicación</Text>
            {(formulario.coordenadas.lugar || formulario.clima?.actual?.ubicacion?.nombre) && (
              <View style={styles.row}>
                <Text style={styles.label}>Lugar:</Text>
                <Text style={styles.value}>
                  {formulario.coordenadas.lugar || formulario.clima?.actual?.ubicacion?.nombre}
                </Text>
              </View>
            )}
            <View style={styles.row}><Text style={styles.label}>Latitud:</Text><Text style={styles.value}>{formulario.coordenadas?.latitud?.toFixed(6) ?? '—'}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Longitud:</Text><Text style={styles.value}>{formulario.coordenadas?.longitud?.toFixed(6) ?? '—'}</Text></View>
            {formulario.coordenadas.altitud && (
              <View style={styles.row}><Text style={styles.label}>Altitud:</Text><Text style={styles.value}>{formulario.coordenadas?.altitud?.toFixed(1) ?? '—'} m</Text></View>
            )}
            {renderMiniRevision('Ubicación')}
          </View>
        )}

        {/* Fecha */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>⏱️ Fechas</Text>
          <View style={styles.row}><Text style={styles.label}>Creado:</Text><Text style={styles.value}>{formatFecha(formulario.created_at)}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Actualizado:</Text><Text style={styles.value}>{formatFecha(formulario.updated_at)}</Text></View>
          {renderMiniRevision('Fechas')}
        </View>

        {/* Sección final del revisor: evidencia propia, firma dual y
            georeferencia puntual — cierra la revisión con visto bueno global.
            Solo en modo "Revisión en campo"; va al final de todo el detalle,
            después de Fechas. */}
        {mostrarSeccionFinalRevisor && (
          <SeccionFinalRevisor formulario={formulario} revisiones={revisiones} recargarRevisiones={recargarRevisiones} />
        )}
      </ScrollView>

      {/* 📄 Visor PDF embebido */}
      {showPdf && pdfUri && (
        <View style={[styles.pdfEmbedContainer, { height: PDF_HEIGHT }]}>
          <View style={styles.pdfEmbedHeader}>
            <Text style={styles.pdfEmbedTitle}>📄 Vista previa del PDF</Text>
            <View style={styles.pdfEmbedActions}>
              <TouchableOpacity onPress={handleSharePDF} style={styles.pdfEmbedActionBtn}>
                <Text style={styles.pdfEmbedActionText}>Compartir</Text>
              </TouchableOpacity>
              <TouchableOpacity onPress={handleClosePdf} style={styles.pdfEmbedCloseBtn}>
                <Text style={styles.pdfEmbedCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
          </View>
          <WebView
            source={{ uri: pdfUri }}
            style={styles.webview}
            originWhitelist={['file://', 'http://', 'https://']}
            allowFileAccess={true}
            javaScriptEnabled={false}
            scalesPageToFit={Platform.OS === 'android'}
          />
        </View>
      )}

      {/* 🎥 Reproductor de video de evidencia */}
      <VideoPlayerModal
        uri={videoPreview?.uri ?? null}
        visible={!!videoPreview}
        onClose={() => setVideoPreview(null)}
        headers={authHeaders}
        subtitulo={
          videoPreview
            ? `📅 ${formatFecha(videoPreview.timestamp)}${
                videoPreview.coordenadas
                  ? `  ·  📍 ${videoPreview.coordenadas.latitud?.toFixed(6)}, ${videoPreview.coordenadas.longitud?.toFixed(6)}`
                  : ''
              }${
                formulario.coordenadas?.lugar || formulario.clima?.actual?.ubicacion?.nombre
                  ? `  ·  🏙️ ${formulario.coordenadas?.lugar || formulario.clima?.actual?.ubicacion?.nombre}`
                  : ''
              }`
            : undefined
        }
      />

      {/* 📸 Visor de foto ampliada */}
      <Modal
        visible={!!fotoPreview}
        transparent
        animationType="fade"
        onRequestClose={() => setFotoPreview(null)}
      >
        <Pressable style={styles.fotoModalOverlay} onPress={() => setFotoPreview(null)}>
          {fotoPreview && (
            <>
              <Image
                source={fuenteEvidencia(fotoPreview.uri)}
                style={styles.fotoModalImage}
                resizeMode="contain"
              />
              <Text style={styles.fotoModalInfo}>
                📅 {formatFecha(fotoPreview.timestamp)}
                {fotoPreview.coordenadas
                  ? `  ·  📍 ${fotoPreview.coordenadas.latitud?.toFixed(6)}, ${fotoPreview.coordenadas.longitud?.toFixed(6)}`
                  : ''}
                {/* Municipio de la visita — todas las evidencias de una
                    misma visita están a metros de distancia, comparten lugar */}
                {(formulario.coordenadas?.lugar || formulario.clima?.actual?.ubicacion?.nombre)
                  ? `  ·  🏙️ ${formulario.coordenadas?.lugar || formulario.clima?.actual?.ubicacion?.nombre}`
                  : ''}
              </Text>
              <Text style={styles.fotoModalHint}>Toca para cerrar</Text>
            </>
          )}
        </Pressable>
      </Modal>

      {/* ✍️ Visor de firma ampliada */}
      <Modal
        visible={!!firmaPreview}
        transparent
        animationType="fade"
        onRequestClose={() => setFirmaPreview(null)}
      >
        <Pressable style={styles.fotoModalOverlay} onPress={() => setFirmaPreview(null)}>
          {firmaPreview && (
            <>
              <Image
                source={{ uri: firmaPreview.uri, headers: firmaPreview.headers }}
                style={[styles.fotoModalImage, { backgroundColor: '#fff' }]}
                resizeMode="contain"
              />
              <Text style={styles.fotoModalInfo}>{firmaPreview.titulo}</Text>
              <Text style={styles.fotoModalHint}>Toca para cerrar</Text>
            </>
          )}
        </Pressable>
      </Modal>

      {/* Botones inferiores */}
      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + SPACING.sm }]}>
        <TouchableOpacity
          style={styles.pdfButton}
          onPress={showPdf ? handleClosePdf : handleViewPDF}
          disabled={generatingPdf}
        >
          <Text style={styles.pdfButtonText}>
            {generatingPdf ? 'Generando...' : showPdf ? '✕ Cerrar PDF' : '📄 Ver PDF'}
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.downloadButton}
          onPress={handleDownloadPDF}
          disabled={generatingPdf}
        >
          <Text style={styles.downloadButtonText}>
            {generatingPdf ? 'Generando...' : '⬇️ Descargar PDF'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.md,
  },
  statusBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  statusTipo: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    color: COLORS.primary,
    backgroundColor: COLORS.surfaceAlt,
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.sm,
  },
  statusSync: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.warning,
  },
  statusSyncOk: {
    color: COLORS.success,
  },
  evidenciasSummary: {
    backgroundColor: COLORS.info + '12',
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.md,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.info,
  },
  evidenciasSummaryTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.info,
    marginBottom: SPACING.xs,
  },
  evidenciasSummaryItem: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    marginLeft: SPACING.sm,
  },
  fotosSection: {
    marginBottom: SPACING.md,
  },
  sectionTitle: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    color: COLORS.primary,
    marginBottom: SPACING.xs,
    textTransform: 'uppercase',
  },
  // --- Preguntas de la encuesta (resumen completo) ---
  pregunta: {
    paddingVertical: SPACING.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.border,
  },
  preguntaTexto: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
  preguntaValor: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  preguntaValorVacio: {
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    fontWeight: FONTS.weights.regular,
  },
  preguntaObs: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    fontStyle: 'italic',
    marginTop: 2,
  },
  fotoThumb: {
    width: 100,
    height: 100,
    borderRadius: BORDER_RADIUS.sm,
    marginRight: SPACING.sm,
    backgroundColor: COLORS.surfaceAlt,
  },
  fotoThumbContainer: {
    position: 'relative',
    marginRight: SPACING.sm,
  },
  fotoModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.92)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: SPACING.md,
  },
  fotoModalImage: {
    width: '100%',
    height: '75%',
  },
  fotoModalInfo: {
    color: COLORS.surface,
    fontSize: FONTS.sizes.sm,
    textAlign: 'center',
    marginTop: SPACING.md,
  },
  fotoModalHint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: FONTS.sizes.xs,
    marginTop: SPACING.xs,
  },
  videoThumb: {
    width: 100,
    height: 100,
    borderRadius: BORDER_RADIUS.sm,
    backgroundColor: '#1a1a2e',
    justifyContent: 'center',
    alignItems: 'center',
  },
  videoThumbIcon: {
    fontSize: 32,
  },
  videoThumbLabel: {
    position: 'absolute',
    bottom: 2,
    right: 2,
    fontSize: 16,
  },
  documentoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.background,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.sm,
    marginTop: SPACING.xs,
  },
  documentoIcon: {
    fontSize: 24,
    marginRight: SPACING.sm,
  },
  documentoInfo: {
    flex: 1,
  },
  documentoNombre: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  documentoMeta: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  documentoAccion: {
    fontSize: 18,
    marginLeft: SPACING.sm,
  },
  firmasRow: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  firmaCard: {
    flex: 1,
  },
  firmaCardLabel: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  firmaImg: {
    width: '100%',
    height: 90,
    backgroundColor: '#fff',
    borderRadius: BORDER_RADIUS.md,
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  firmaImgVacia: {
    justifyContent: 'center',
    alignItems: 'center',
    borderStyle: 'dashed',
  },
  firmaVaciaTexto: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
    fontStyle: 'italic',
  },
  section: {
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.sm,
    ...SHADOWS.sm,
  },
  row: {
    flexDirection: 'row',
    paddingVertical: 3,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  label: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.medium,
    width: 110,
  },
  value: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    flex: 1,
    textAlign: 'right',
  },
  bottomBar: {
    flexDirection: 'row',
    padding: SPACING.md,
    gap: SPACING.sm,
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
  },
  pdfButton: {
    flex: 1,
    backgroundColor: COLORS.primary,
    paddingVertical: SPACING.sm + 4,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  pdfButtonText: {
    color: COLORS.textOnPrimary,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
  },
  downloadButton: {
    flex: 1,
    paddingVertical: SPACING.sm + 4,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    borderWidth: 2,
    borderColor: COLORS.primary,
    backgroundColor: COLORS.surface,
  },
  downloadButtonText: {
    color: COLORS.primary,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
  },
  // ---- Visor PDF embebido ----
  pdfEmbedContainer: {
    backgroundColor: COLORS.surface,
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
  },
  pdfEmbedHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  pdfEmbedTitle: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  pdfEmbedActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
  },
  pdfEmbedActionBtn: {
    paddingHorizontal: SPACING.sm,
    paddingVertical: SPACING.xs,
    backgroundColor: COLORS.primary + '20',
    borderRadius: BORDER_RADIUS.sm,
  },
  pdfEmbedActionText: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.primary,
  },
  pdfEmbedCloseBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.error + '20',
    justifyContent: 'center',
    alignItems: 'center',
  },
  pdfEmbedCloseText: {
    fontSize: 14,
    fontWeight: FONTS.weights.bold,
    color: COLORS.error,
  },
  webview: {
    flex: 1,
    backgroundColor: '#f0f0f0',
  },
});

export default FormularioDetailScreen;
