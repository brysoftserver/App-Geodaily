// ============================================================
// GEODAILY — Panel de un beneficiario dentro de una actividad
// ============================================================
// Cuatro segmentos:
//   1. Acta Individual de Entrega y Recibo (las diligenciadas en ESTA actividad)
//   2. Evidencia Fotográfica del Antes de la Actividad       (máx. 3 fotos)
//   3. Evidencia Fotográfica del Durante la Actividad        (máx. 3 fotos)
//   4. Evidencia Fotográfica del Después de la Actividad     (máx. 3 fotos)
//   5. (Solo Preparación del Terreno, en revisión) Captura de la medición:
//      polígono(s) de la Visita Técnica 2 del beneficiario, solo lectura.
// El técnico (modo 'ejecutar') diligencia y sube. En modo 'revisar' solo el
// admin puede subir, quitar o reemplazar fotos y actas (PDF); los demás roles
// ven lo que subió el técnico en solo lectura.
// ============================================================

import React, { useCallback, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  TextInput,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import * as DocumentPicker from 'expo-document-picker';
import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS, API_CONFIG } from '../../theme';
import { buscarActividad } from '../../data/actividades';
import { avisar, confirmar } from '../../utils/dialogos';
import PdfViewer from '../../components/PdfViewer';
import { useAuth } from '../../store/AuthContext';
import ActaEntregaRevision, { ActaARevisar } from '../../components/actividades/ActaEntregaRevision';
import { abrirVentanaDeCarga, imprimirHtmlEnVentana } from '../../utils/printWeb';
import { construirHtmlActaEntregaIndividual, generarPDFActaEntregaIndividual } from '../../services/pdfLocal.service';
import apiClient, { getApiAuthToken } from '../../services/api';
import {
  ActaDeActividad,
  EvidenciaBeneficiario,
  FotoEvidencia,
  MOMENTOS_EVIDENCIA,
  MomentoEvidencia,
  crearObservacionActa,
  eliminarActaAdmin,
  eliminarFotoEvidencia,
  fuenteFotoEvidencia,
  obtenerDatosActaServidor,
  obtenerEvidenciaBeneficiario,
  resolverObservacionActa,
  subirActaPdfAdmin,
  subirFotoEvidencia,
} from '../../services/actividadesEvidencias.service';
import { actasLocalesDeActividad } from '../../services/estadoActaLocal';
import { esFirmaDibujada, presentacionActa, TonoActa } from '../../utils/estadoActa';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';
import MedicionCaptura from '../../components/MedicionCaptura';

const COLOR_TONO: Record<TonoActa, string> = {
  gris: COLORS.textSecondary,
  amarillo: COLORS.warning,
  verde: COLORS.success,
};

/** Acta tal como se muestra: la del servidor, o una completada en el teléfono que aún no sube. */
type ActaVista = ActaDeActividad & {
  /** Hay una versión en el teléfono pendiente de subir. */
  pendienteSubir?: boolean;
  /** Solo en el teléfono (aún no está en el servidor): datos para armar el PDF. */
  datosLocales?: Record<string, any>;
};

const MAX_FOTOS = 3;

const mensajeError = (e: any, porDefecto: string) =>
  e?.response?.data?.mensaje || (e?.message?.includes('Network') ? 'Sin conexión. Verifica tu internet.' : porDefecto);

interface BeneficiarioParam {
  item: number;
  nombre: string;
  cedula: string;
  corregimiento?: string;
  vereda?: string;
}

/** Miniatura de una foto del servidor (resuelve la URL con su token). */
const Miniatura: React.FC<{ foto: FotoEvidencia; onPress: () => void }> = ({ foto, onPress }) => {
  const [fuente, setFuente] = useState<{ uri: string; headers?: Record<string, string> } | null>(null);
  React.useEffect(() => {
    let vivo = true;
    fuenteFotoEvidencia(foto.id).then((f) => vivo && setFuente(f));
    return () => { vivo = false; };
  }, [foto.id]);
  return (
    <TouchableOpacity style={styles.miniatura} onPress={onPress} activeOpacity={0.8}>
      {fuente ? <Image source={fuente} style={styles.miniaturaImg} resizeMode="cover" /> : <ActivityIndicator color={COLORS.primary} />}
    </TouchableOpacity>
  );
};

const ActividadBeneficiarioScreen: React.FC<any> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const actividadId: string = route?.params?.actividadId;
  const beneficiario: BeneficiarioParam = route?.params?.beneficiario;
  const modo: 'ejecutar' | 'revisar' = route?.params?.modo === 'revisar' ? 'revisar' : 'ejecutar';
  const { user, isInterventor } = useAuth();
  // El admin, desde la revisión, puede subir / quitar / reemplazar fotos y actas.
  const esAdminRevision = modo === 'revisar' && user?.rol === 'admin';
  const puedeEscribir = modo === 'ejecutar';
  const puedeGestionarFotos = puedeEscribir || esAdminRevision;
  const puedeObservar = modo === 'revisar' && ['coordinador', 'interventor', 'gerente', 'admin'].includes(user?.rol || '');
  const actividad = buscarActividad(actividadId);

  const [data, setData] = useState<EvidenciaBeneficiario | null>(null);
  // Actas completadas en este teléfono (el técnico las ve al instante, aunque no hayan subido).
  const [actasLocales, setActasLocales] = useState<{ soloLocales: ActaVista[]; pendientes: Set<string> }>({
    soloLocales: [],
    pendientes: new Set(),
  });
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [subiendo, setSubiendo] = useState<MomentoEvidencia | null>(null);
  const [abriendoActa, setAbriendoActa] = useState<string | null>(null);
  // Id del acta en proceso por el admin ('nueva' = subiendo una nueva).
  const [gestionandoActa, setGestionandoActa] = useState<string | null>(null);
  const [visorFoto, setVisorFoto] = useState<{ foto: FotoEvidencia; fuente: { uri: string; headers?: Record<string, string> } } | null>(null);
  // Observación que un rol superior está redactando sobre un acta.
  const [observando, setObservando] = useState<ActaDeActividad | null>(null);
  const [textoObservacion, setTextoObservacion] = useState('');
  const [enviandoObs, setEnviandoObs] = useState(false);
  const [visorPdf, setVisorPdf] = useState<{ uri: string; titulo: string; key: string } | null>(null);
  // Acta que el interventor está revisando para firmarla (mismo panel que en las entregas).
  const [actaAFirmar, setActaAFirmar] = useState<ActaARevisar | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({ title: beneficiario?.nombre ?? 'Beneficiario' });
  }, [navigation, beneficiario?.nombre]);

  const cargar = useCallback(async (esRefresh = false, silencioso = false) => {
    try {
      if (esRefresh) setRefrescando(true);
      const evidencia = await obtenerEvidenciaBeneficiario(actividadId, beneficiario.item);
      setData(evidencia);
      if (puedeEscribir && beneficiario?.cedula) {
        const enServidor = new Set((evidencia.actas ?? []).map((a) => a.id));
        const locales = await actasLocalesDeActividad(beneficiario.cedula, actividadId);
        setActasLocales({
          pendientes: new Set(locales.filter((f) => !f.sincronizado).map((f) => f.id)),
          soloLocales: locales
            .filter((f) => !enServidor.has(f.id))
            .map((f) => ({
              id: f.id,
              instancia: String(f.datos?.instancia ?? ''),
              fecha: String(f.datos?.fecha || f.updated_at),
              tienePdf: false,
              firmadaInterventoria: esFirmaDibujada(f.datos?.firmaInterventoria),
              resumen: (Array.isArray(f.datos?.actividades) ? f.datos.actividades : [])
                .map((x: any) => x?.descripcion)
                .filter(Boolean)
                .join(', '),
              faltantes: Array.isArray(f.datos?.faltantes) ? f.datos.faltantes : [],
              observaciones: [],
              pendienteSubir: !f.sincronizado,
              datosLocales: f.datos,
            })),
        });
      }
    } catch (e) {
      if (!silencioso) avisar('No se pudo cargar', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }, [actividadId, beneficiario?.item, beneficiario?.cedula, puedeEscribir]);

  // Recarga al volver del acta recién diligenciada.
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  // Recarga automática silenciosa (volver a la app/pestaña, red recuperada, periódica).
  useAutoRefresh(() => cargar(false, true));

  // ─── Acta ───────────────────────────────────────────────
  const diligenciarActa = () => {
    navigation.navigate('ActaEntregaIndividual', {
      actividadId,
      beneficiario: {
        nombre: beneficiario.nombre,
        cedula: beneficiario.cedula,
        vereda: beneficiario.vereda,
        corregimiento: beneficiario.corregimiento,
      },
    });
  };

  // Reabre el acta en el formulario para corregirla (solo el técnico).
  const editarActa = (a: ActaDeActividad) => {
    navigation.navigate('ActaEntregaIndividual', {
      actividadId,
      instancia: a.instancia,
      beneficiario: {
        nombre: beneficiario.nombre,
        cedula: beneficiario.cedula,
        vereda: beneficiario.vereda,
        corregimiento: beneficiario.corregimiento,
      },
    });
  };

  const abrirActa = async (a: ActaVista) => {
    if (abriendoActa) return;
    // Acta que aún no llega al servidor: el PDF se arma con los datos del teléfono.
    if (a.datosLocales) {
      setAbriendoActa(a.id);
      try {
        if (Platform.OS === 'web') {
          imprimirHtmlEnVentana(abrirVentanaDeCarga(), construirHtmlActaEntregaIndividual(a.datosLocales as any));
          return;
        }
        const uri = await generarPDFActaEntregaIndividual(a.datosLocales as any);
        if (!uri) throw new Error('No se pudo generar el PDF');
        setVisorPdf({ uri, titulo: 'Acta de Entrega y Recibo', key: `acta_${a.id}_${Date.now()}` });
      } catch (e) {
        avisar('No se pudo abrir el acta', mensajeError(e, 'Inténtalo de nuevo.'));
      } finally {
        setAbriendoActa(null);
      }
      return;
    }
    // En web la pestaña se abre ANTES de cualquier await para que no la bloquee el navegador.
    const esWeb = Platform.OS === 'web';
    const ventana = esWeb ? (a.tienePdf ? window.open('', '_blank') : abrirVentanaDeCarga()) : null;
    setAbriendoActa(a.id);
    try {
      if (a.tienePdf) {
        const url = `${API_CONFIG.BASE_URL}${API_CONFIG.ENDPOINTS.OTROS_FORMATOS}/${encodeURIComponent(a.id)}/pdf`;
        const token = await getApiAuthToken();
        const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
        if (esWeb) {
          const resp = await fetch(url, { headers });
          if (!resp.ok) throw new Error(`Descarga fallida (${resp.status})`);
          const blobUrl = URL.createObjectURL(await resp.blob());
          if (ventana) ventana.location.href = blobUrl;
          else window.location.href = blobUrl;
          return;
        }
        const destino = `${FileSystem.cacheDirectory}acta_${Date.now()}.pdf`;
        const { uri, status } = await FileSystem.downloadAsync(url, destino, { headers });
        if (status !== 200) throw new Error(`Descarga fallida (${status})`);
        setVisorPdf({ uri, titulo: 'Acta de Entrega y Recibo', key: `acta_${a.id}_${Date.now()}` });
        return;
      }
      // Acta completada sin PDF guardado: se arma al momento con los datos que tenga.
      const datos = await obtenerDatosActaServidor(a.id);
      if (esWeb) {
        imprimirHtmlEnVentana(ventana, construirHtmlActaEntregaIndividual(datos as any));
        return;
      }
      const uri = await generarPDFActaEntregaIndividual(datos as any);
      if (!uri) throw new Error('No se pudo generar el PDF');
      setVisorPdf({ uri, titulo: 'Acta de Entrega y Recibo', key: `acta_${a.id}_${Date.now()}` });
    } catch (e) {
      ventana?.close();
      avisar('No se pudo abrir el acta', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setAbriendoActa(null);
    }
  };

  // ─── Observaciones sobre el acta (roles superiores) ─────
  const enviarObservacion = async () => {
    if (!observando || !textoObservacion.trim() || enviandoObs) return;
    setEnviandoObs(true);
    try {
      await crearObservacionActa(observando.id, textoObservacion.trim());
      setObservando(null);
      setTextoObservacion('');
      await cargar();
      avisar('Observación enviada', 'El técnico recibió el aviso.');
    } catch (e) {
      avisar('No se pudo enviar', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setEnviandoObs(false);
    }
  };

  const resolverObservacion = async (id: number) => {
    try {
      await resolverObservacionActa(id);
      await cargar();
    } catch (e) {
      avisar('No se pudo marcar como resuelta', mensajeError(e, 'Inténtalo de nuevo.'));
    }
  };

  // ─── Actas (solo admin) ─────────────────────────────────
  const subirActaAdmin = async (a?: ActaDeActividad) => {
    if (gestionandoActa) return;
    const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    const doc = r.assets[0];
    setGestionandoActa(a?.id ?? 'nueva');
    try {
      await subirActaPdfAdmin(actividadId, beneficiario.item, { uri: doc.uri, nombre: doc.name || 'acta.pdf', mimeType: doc.mimeType }, a?.id);
      await cargar();
      avisar(a ? 'Acta reemplazada' : 'Acta subida', 'El PDF quedó guardado en la carpeta del beneficiario.');
    } catch (e) {
      avisar('No se pudo subir el acta', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setGestionandoActa(null);
    }
  };

  const eliminarActa = async (a: ActaDeActividad) => {
    if (gestionandoActa) return;
    if (!(await confirmar('Eliminar acta', '¿Eliminar esta acta y su PDF? Esta acción no se puede deshacer.', 'Eliminar', true))) return;
    setGestionandoActa(a.id);
    try {
      await eliminarActaAdmin(actividadId, beneficiario.item, a.id);
      await cargar();
    } catch (e) {
      avisar('No se pudo eliminar', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setGestionandoActa(null);
    }
  };

  // ─── Fotos ──────────────────────────────────────────────
  // Sube las fotos elegidas (galería) o tomadas (cámara) a un momento.
  const subirArchivos = async (momento: MomentoEvidencia, assets: ImagePicker.ImagePickerAsset[], faltan: number) => {
    const elegidas = assets.slice(0, faltan);
    if (!elegidas.length) return;
    setSubiendo(momento);
    let fallas = 0;
    let ultimoError: any = null;
    for (const [i, a] of elegidas.entries()) {
      try {
        await subirFotoEvidencia(actividadId, beneficiario.item, momento, {
          uri: a.uri,
          nombre: a.fileName || `foto_${Date.now()}_${i}.jpg`,
          mimeType: a.mimeType || 'image/jpeg',
        });
      } catch (e) {
        fallas++;
        ultimoError = e;
      }
    }
    setSubiendo(null);
    await cargar();
    if (fallas > 0) {
      avisar('Algunas fotos no se subieron', `${fallas} de ${elegidas.length}: ${mensajeError(ultimoError, 'Inténtalo de nuevo.')}`);
    }
  };

  const cupoFotos = (momento: MomentoEvidencia) => MAX_FOTOS - (data?.fotos[momento].length ?? 0);

  const agregarFotos = async (momento: MomentoEvidencia) => {
    const faltan = cupoFotos(momento);
    if (faltan <= 0 || subiendo) return;

    const r = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      selectionLimit: faltan,
      quality: 0.7,
    });
    if (r.canceled || !r.assets?.length) return;
    await subirArchivos(momento, r.assets, faltan);
  };

  // Una foto por toque: la cámara no toma varias de una vez.
  const tomarFoto = async (momento: MomentoEvidencia) => {
    const faltan = cupoFotos(momento);
    if (faltan <= 0 || subiendo) return;
    try {
      const permiso = await ImagePicker.requestCameraPermissionsAsync();
      if (!permiso.granted) {
        avisar('Permiso requerido', 'Se necesita acceso a la cámara para tomar la foto.');
        return;
      }
      const r = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 0.7 });
      if (r.canceled || !r.assets?.length) return;
      await subirArchivos(momento, r.assets, faltan);
    } catch (e) {
      avisar('No se pudo abrir la cámara', mensajeError(e, 'Inténtalo de nuevo.'));
    }
  };

  const abrirFoto = async (foto: FotoEvidencia) => {
    setVisorFoto({ foto, fuente: await fuenteFotoEvidencia(foto.id) });
  };

  const quitarFoto = async (foto: FotoEvidencia) => {
    if (!(await confirmar('Quitar foto', '¿Quitar esta foto? Podrás subir otra después.', 'Quitar', true))) return;
    try {
      await eliminarFotoEvidencia(foto.id);
      setVisorFoto(null);
      await cargar();
    } catch (e) {
      avisar('No se pudo quitar', mensajeError(e, 'Inténtalo de nuevo.'));
    }
  };

  // ─── Render ─────────────────────────────────────────────
  const seccion = (titulo: string, hijos: React.ReactNode, contador?: string) => (
    <View style={styles.segmento}>
      <View style={styles.segmentoCabecera}>
        <Text style={styles.segmentoTitulo}>{titulo}</Text>
        {contador ? <Text style={styles.contador}>{contador}</Text> : null}
      </View>
      {hijos}
    </View>
  );

  // Las del teléfono que aún no suben, primero; luego las del servidor.
  const listaActas: ActaVista[] = [
    ...actasLocales.soloLocales,
    ...(data?.actas ?? []).map((a) => ({ ...a, pendienteSubir: actasLocales.pendientes.has(a.id) })),
  ];

  const segmentoActa = seccion(
    'Acta Individual de Entrega y Recibo',
    <View>
      {listaActas.length === 0 && (
        <Text style={styles.vacio}>{puedeEscribir ? 'Aún no has diligenciado el acta de esta actividad.' : 'El técnico aún no ha diligenciado el acta.'}</Text>
      )}
      {listaActas.map((a) => {
        const pendientes = a.observaciones.filter((o) => !o.resuelta);
        const estado = presentacionActa(a.pendienteSubir ? 'pendiente_subir' : 'completada', a.faltantes, a.firmadaInterventoria);
        return (
          <View key={a.id} style={styles.acta}>
            <TouchableOpacity style={styles.actaCabecera} onPress={() => abrirActa(a)} activeOpacity={0.7}>
              <View style={{ flex: 1 }}>
                <Text style={styles.actaTitulo}>
                  {new Date(a.fecha).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' })}
                </Text>
                {a.resumen ? <Text style={styles.dato} numberOfLines={2}>{a.resumen}</Text> : null}
                <Text style={[styles.estado, { color: COLOR_TONO[estado.tonoTxt] }]}>{estado.txt}</Text>
                {estado.interventor ? (
                  <Text style={[styles.estado, { color: COLOR_TONO[estado.interventor.tono] }]}>{estado.interventor.txt}</Text>
                ) : null}
                {estado.sub ? <Text style={styles.estadoSub}>{estado.sub}</Text> : null}
              </View>
              {abriendoActa === a.id ? <ActivityIndicator color={COLORS.primary} /> : <Text style={styles.flecha}>›</Text>}
            </TouchableOpacity>

            {a.observaciones.map((o) => (
              <View key={o.id} style={[styles.observacion, o.resuelta && styles.observacionResuelta]}>
                <Text style={styles.observacionAutor}>
                  {o.resuelta ? '✓ Resuelta · ' : '⚠ '}{o.autor || o.rol} ({o.rol})
                </Text>
                <Text style={styles.observacionTexto}>{o.comentario}</Text>
                {o.puedeResolver && (
                  <TouchableOpacity onPress={() => resolverObservacion(o.id)}>
                    <Text style={styles.observacionAccion}>Marcar como resuelta</Text>
                  </TouchableOpacity>
                )}
              </View>
            ))}

            <View style={styles.accionesActa}>
              {puedeEscribir && (
                <TouchableOpacity style={[styles.btnSec, pendientes.length > 0 && styles.btnSecResalta]} onPress={() => editarActa(a)}>
                  <Text style={styles.btnSecTxt}>✏️ {pendientes.length > 0 ? 'Corregir acta' : 'Editar acta'}</Text>
                </TouchableOpacity>
              )}
              {modo === 'revisar' && isInterventor && !a.datosLocales && beneficiario?.cedula && (
                <TouchableOpacity
                  style={[styles.btnSec, !a.firmadaInterventoria && styles.btnFirmar]}
                  onPress={() =>
                    setActaAFirmar({
                      cedula: beneficiario.cedula,
                      instancia: a.instancia,
                      beneficiarioNombre: beneficiario.nombre,
                      titulo: `Acta · ${actividad?.nombre ?? 'Actividad'}`,
                    })
                  }
                >
                  <Text style={[styles.btnSecTxt, !a.firmadaInterventoria && { color: '#fff' }]}>
                    {a.firmadaInterventoria ? '✍️ Ver firma de interventoría' : '✍️ Firmar acta'}
                  </Text>
                </TouchableOpacity>
              )}
              {puedeObservar && (
                <TouchableOpacity style={styles.btnSec} onPress={() => { setTextoObservacion(''); setObservando(a); }}>
                  <Text style={styles.btnSecTxt}>⚠ Avisar dato errado o faltante</Text>
                </TouchableOpacity>
              )}
              {esAdminRevision && (
                gestionandoActa === a.id ? (
                  <ActivityIndicator color={COLORS.primary} />
                ) : (
                  <>
                    <TouchableOpacity style={styles.btnSec} onPress={() => subirActaAdmin(a)} disabled={gestionandoActa !== null}>
                      <Text style={styles.btnSecTxt}>📄 Reemplazar PDF</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={[styles.btnSec, styles.btnPeligro]} onPress={() => eliminarActa(a)} disabled={gestionandoActa !== null}>
                      <Text style={[styles.btnSecTxt, { color: COLORS.error }]}>🗑 Eliminar acta</Text>
                    </TouchableOpacity>
                  </>
                )
              )}
            </View>
          </View>
        );
      })}
      {puedeEscribir && (
        <TouchableOpacity style={styles.btnPrimario} onPress={diligenciarActa} activeOpacity={0.8}>
          <Text style={styles.btnPrimarioTxt}>{listaActas.length ? '＋ Diligenciar otra acta' : '📝 Diligenciar acta'}</Text>
        </TouchableOpacity>
      )}
      {esAdminRevision && (
        <TouchableOpacity
          style={[styles.btnPrimario, gestionandoActa !== null && styles.btnDeshabilitado]}
          onPress={() => subirActaAdmin()}
          disabled={gestionandoActa !== null}
          activeOpacity={0.8}
        >
          {gestionandoActa === 'nueva' ? (
            <><ActivityIndicator size="small" color="#fff" /><Text style={styles.btnPrimarioTxt}>  Subiendo…</Text></>
          ) : (
            <Text style={styles.btnPrimarioTxt}>📄 Subir acta (PDF) desde el dispositivo</Text>
          )}
        </TouchableOpacity>
      )}
    </View>
  );

  const segmentoFotos = (momento: MomentoEvidencia, titulo: string) => {
    const fotos = data?.fotos[momento] ?? [];
    const lleno = fotos.length >= MAX_FOTOS;
    return seccion(
      titulo,
      <View>
        {fotos.length === 0 ? (
          <Text style={styles.vacio}>{puedeEscribir ? 'Aún no has subido fotos.' : 'El técnico aún no ha subido fotos.'}</Text>
        ) : (
          <View style={styles.fila}>
            {fotos.map((f) => <Miniatura key={f.id} foto={f} onPress={() => abrirFoto(f)} />)}
          </View>
        )}
        {puedeGestionarFotos && (
          lleno ? (
            <View style={[styles.btnPrimario, styles.btnDeshabilitado]}>
              <Text style={styles.btnPrimarioTxt}>Máximo de 3 fotos alcanzado</Text>
            </View>
          ) : subiendo === momento ? (
            <View style={[styles.btnPrimario, styles.btnDeshabilitado]}>
              <ActivityIndicator size="small" color="#fff" /><Text style={styles.btnPrimarioTxt}>  Subiendo…</Text>
            </View>
          ) : (
            <View style={styles.filaBotones}>
              {/* En web la cámara del PC no aplica; el navegador del celular ya la ofrece desde Galería. */}
              {Platform.OS !== 'web' && (
                <TouchableOpacity
                  style={[styles.btnPrimario, styles.btnMitad, subiendo !== null && styles.btnDeshabilitado]}
                  onPress={() => tomarFoto(momento)}
                  disabled={subiendo !== null}
                  activeOpacity={0.8}
                >
                  <Text style={styles.btnPrimarioTxt}>📷 Tomar foto</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity
                style={[styles.btnPrimario, styles.btnMitad, subiendo !== null && styles.btnDeshabilitado]}
                onPress={() => agregarFotos(momento)}
                disabled={subiendo !== null}
                activeOpacity={0.8}
              >
                <Text style={styles.btnPrimarioTxt}>🖼️ Galería</Text>
              </TouchableOpacity>
            </View>
          )
        )}
      </View>,
      `${fotos.length}/${MAX_FOTOS}`
    );
  };

  // Polígonos de la Visita 2: solo en la revisión y si el servidor los envía.
  const visita2 = modo === 'revisar' ? data?.visita2 ?? null : null;
  const poligonosV2 = visita2?.poligonos ?? [];
  const totalHaV2 = Math.round(poligonosV2.reduce((acc, m) => acc + (Number(m.area_hectareas) || 0), 0) * 100) / 100;
  const segmentoPoligonosV2 = visita2
    ? seccion(
        'Captura de la medición',
        <View style={{ gap: SPACING.sm }}>
          {poligonosV2.length === 0 ? (
            <Text style={styles.vacio}>La Visita 2 de este beneficiario no tiene polígonos registrados.</Text>
          ) : (
            poligonosV2.map((m, idx) => (
              <View key={`poligono-v2-${idx}`}>
                {poligonosV2.length > 1 && <Text style={styles.subtituloPoligono}>Polígono {idx + 1}</Text>}
                <MedicionCaptura medicion={m} altura={200} mostrarAcciones />
              </View>
            ))
          )}
        </View>,
        poligonosV2.length > 1
          ? `${poligonosV2.length} polígonos · ${totalHaV2.toLocaleString('es-CO', { maximumFractionDigits: 2 })} ha`
          : 'Visita 2'
      )
    : null;

  return (
    <View style={styles.container}>
      {cargando ? (
        <ActivityIndicator style={{ marginTop: SPACING.xl }} size="large" color={COLORS.primary} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.contenido, { paddingBottom: insets.bottom + SPACING.xl }]}
          refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => cargar(true)} colors={[COLORS.primary]} />}
        >
          <View style={styles.cabecera}>
            <Text style={styles.actividad}>{actividad ? `${actividad.icon} ${actividad.nombre}` : 'Actividad'}</Text>
            <Text style={styles.dato}>C.C. {beneficiario?.cedula}</Text>
            <Text style={styles.dato}>{[beneficiario?.corregimiento, beneficiario?.vereda].filter(Boolean).join(' · ')}</Text>
          </View>
          {segmentoActa}
          {MOMENTOS_EVIDENCIA.map((m) => <React.Fragment key={m.id}>{segmentoFotos(m.id, m.titulo)}</React.Fragment>)}
          {segmentoPoligonosV2}
        </ScrollView>
      )}

      <Modal visible={visorFoto !== null} animationType="fade" transparent onRequestClose={() => setVisorFoto(null)}>
        {visorFoto && (
          <View style={styles.visorFondo}>
            <Image source={visorFoto.fuente} style={styles.visorImg} resizeMode="contain" />
            <View style={[styles.visorBarra, { paddingBottom: insets.bottom + SPACING.md }]}>
              {puedeGestionarFotos && (
                <TouchableOpacity style={[styles.visorBtn, styles.visorBtnPeligro]} onPress={() => quitarFoto(visorFoto.foto)}>
                  <Text style={styles.visorBtnTxt}>Quitar</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.visorBtn} onPress={() => setVisorFoto(null)}>
                <Text style={styles.visorBtnTxt}>Cerrar</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Modal>

      <Modal visible={observando !== null} animationType="fade" transparent onRequestClose={() => setObservando(null)}>
        <View style={styles.modalFondo}>
          <View style={styles.modalCaja}>
            <Text style={styles.segmentoTitulo}>Avisar al técnico</Text>
            <Text style={styles.dato}>Escribe el dato errado o faltante del acta de {beneficiario?.nombre}.</Text>
            <TextInput
              style={styles.modalInput}
              value={textoObservacion}
              onChangeText={setTextoObservacion}
              placeholder="Ej.: falta la firma del beneficiario / la cédula no coincide"
              placeholderTextColor={COLORS.textLight}
              multiline
              maxLength={2000}
              autoFocus
            />
            <View style={styles.modalBotones}>
              <TouchableOpacity style={styles.btnSec} onPress={() => setObservando(null)} disabled={enviandoObs}>
                <Text style={styles.btnSecTxt}>Cancelar</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.btnPrimario, { flex: 1, marginTop: 0 }, (!textoObservacion.trim() || enviandoObs) && styles.btnDeshabilitado]}
                onPress={enviarObservacion}
                disabled={!textoObservacion.trim() || enviandoObs}
              >
                {enviandoObs ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnPrimarioTxt}>Enviar</Text>}
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      <ActaEntregaRevision acta={actaAFirmar} onClose={() => setActaAFirmar(null)} onFirmada={() => { void cargar(); }} />

      <Modal visible={visorPdf !== null} animationType="slide" onRequestClose={() => setVisorPdf(null)}>
        {visorPdf && (
          <PdfViewer
            archivo={visorPdf.uri}
            titulo={visorPdf.titulo}
            cacheKey={visorPdf.key}
            onClose={() => setVisorPdf(null)}
            onFallback={async () => {
              if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(visorPdf.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
            }}
          />
        )}
      </Modal>
    </View>
  );
};

const TAM_MINIATURA = 96;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  contenido: { padding: SPACING.md, gap: SPACING.md },
  cabecera: { marginBottom: SPACING.xs },
  actividad: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, marginBottom: 2 },
  dato: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 1 },
  segmento: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, borderLeftWidth: 4, borderLeftColor: COLORS.primary, ...SHADOWS.sm },
  segmentoCabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm },
  segmentoTitulo: { flex: 1, fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  contador: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.semibold, color: COLORS.textSecondary, marginLeft: SPACING.sm },
  subtituloPoligono: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.semibold, color: COLORS.textSecondary, marginBottom: SPACING.xs },
  vacio: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginBottom: SPACING.sm },
  fila: { flexDirection: 'row', gap: SPACING.sm, marginBottom: SPACING.sm, flexWrap: 'wrap' },
  miniatura: { width: TAM_MINIATURA, height: TAM_MINIATURA, borderRadius: BORDER_RADIUS.md, backgroundColor: COLORS.background, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  miniaturaImg: { width: '100%', height: '100%' },
  acta: { paddingVertical: SPACING.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  actaCabecera: { flexDirection: 'row', alignItems: 'center' },
  accionesActa: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.sm },
  observacion: { backgroundColor: '#FFF4E5', borderRadius: BORDER_RADIUS.md, padding: SPACING.sm, marginTop: SPACING.sm },
  observacionResuelta: { backgroundColor: COLORS.background, opacity: 0.8 },
  observacionAutor: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  observacionTexto: { fontSize: FONTS.sizes.sm, color: COLORS.textPrimary, marginTop: 2 },
  observacionAccion: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.semibold, color: COLORS.primary, marginTop: 4 },
  btnSec: { borderWidth: 1, borderColor: COLORS.primary, borderRadius: BORDER_RADIUS.md, paddingVertical: 6, paddingHorizontal: SPACING.sm, alignItems: 'center', backgroundColor: COLORS.surface },
  btnPeligro: { borderColor: COLORS.error },
  btnSecResalta: { backgroundColor: '#FFF4E5', borderColor: COLORS.warning },
  btnFirmar: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  btnSecTxt: { color: COLORS.primary, fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.sm },
  modalFondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.5)', justifyContent: 'center', padding: SPACING.lg },
  modalCaja: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, gap: SPACING.sm },
  modalInput: { minHeight: 90, borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, padding: SPACING.sm, textAlignVertical: 'top', color: COLORS.textPrimary },
  modalBotones: { flexDirection: 'row', gap: SPACING.sm, marginTop: SPACING.xs },
  actaTitulo: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  estado: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold, marginTop: 2 },
  estadoSub: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 1 },
  flecha: { fontSize: 24, color: COLORS.textLight, marginLeft: SPACING.sm },
  btnPrimario: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.md, paddingVertical: SPACING.sm + 2, marginTop: SPACING.xs },
  btnDeshabilitado: { opacity: 0.5 },
  filaBotones: { flexDirection: 'row', gap: SPACING.sm },
  btnMitad: { flex: 1 },
  btnPrimarioTxt: { color: '#fff', fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.sm },
  visorFondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center' },
  visorImg: { flex: 1, width: '100%' },
  visorBarra: { flexDirection: 'row', justifyContent: 'center', gap: SPACING.md, paddingTop: SPACING.md },
  visorBtn: { backgroundColor: 'rgba(255,255,255,0.2)', paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg, borderRadius: BORDER_RADIUS.md },
  visorBtnPeligro: { backgroundColor: COLORS.error },
  visorBtnTxt: { color: '#fff', fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.md },
});

export default ActividadBeneficiarioScreen;
