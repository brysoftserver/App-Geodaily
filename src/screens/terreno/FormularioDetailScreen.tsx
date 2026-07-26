// ============================================================
// GEODAILY — Detalle de Formulario (Read-Only + PDF)
// ============================================================
// Muestra todos los datos de un formulario completado,
// con miniaturas de evidencias y opciones de PDF.
// ============================================================

import React, { useState, useEffect, useCallback } from 'react';
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
import SignaturePad from '../../components/SignaturePad';
import MapViewOffline from '../../components/MapViewOffline';

type FormularioDetailScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
  route: RouteProp<Record<string, any> & { params: { formulario: Formulario } }, 'params'>;
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

const SeccionFinalRevisor: React.FC<{ formulario: Formulario; recargarRevisiones: () => Promise<void> }> = ({ formulario, recargarRevisiones }) => {
  const { user } = useAuth();
  const rol = user?.rol || 'tecnico';
  const esRevisor = ['supervisor', 'interventor', 'gerente', 'admin'].includes(rol);

  const [evidencias, setEvidencias] = useState<EvidenciaRevisor[]>([]);
  const [fotos, setFotos] = useState<{ uri: string }[]>([]);
  const [firmaBeneficiario, setFirmaBeneficiario] = useState<string | null>(null);
  const [firmaRevisor, setFirmaRevisor] = useState<string | null>(null);
  const [geoPoint, setGeoPoint] = useState<{ lat: number; lon: number } | null>(null);
  const [observaciones, setObservaciones] = useState('');
  const [padActivo, setPadActivo] = useState<'beneficiario' | 'revisor' | null>(null);
  const [guardando, setGuardando] = useState(false);
  const [obteniendoUbicacion, setObteniendoUbicacion] = useState(false);
  const { getCurrentPosition } = useLocation();

  const cargarEvidencias = useCallback(async () => {
    setEvidencias(await fetchEvidenciasRevisor(formulario.id));
  }, [formulario.id]);

  useEffect(() => { cargarEvidencias(); }, [cargarEvidencias]);

  const miEvidencia = evidencias.find((e) => e.revisor_rol === rol);
  const otrasEvidencias = evidencias.filter((e) => e.revisor_rol !== rol);

  const tomarFoto = async () => {
    const permiso = await ImagePicker.requestCameraPermissionsAsync();
    if (!permiso.granted) {
      Alert.alert('Permiso requerido', 'Se necesita acceso a la cámara para tomar la foto.');
      return;
    }
    const resultado = await ImagePicker.launchCameraAsync({ quality: 0.6 });
    if (!resultado.canceled && resultado.assets?.[0]?.uri) {
      setFotos((prev) => [...prev, { uri: resultado.assets[0].uri }]);
    }
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

  const guardarYAprobar = async () => {
    setGuardando(true);
    try {
      await guardarEvidenciaRevisor(formulario.id, {
        fotos,
        firma_beneficiario: firmaBeneficiario || undefined,
        firma_revisor: firmaRevisor || undefined,
        geo_latitud: geoPoint?.lat,
        geo_longitud: geoPoint?.lon,
        observaciones: observaciones.trim() || undefined,
      });
      if (!miEvidencia) {
        // Solo registra el visto bueno global la primera vez — evita
        // duplicar el error 409 si el revisor solo está actualizando su
        // evidencia después de haber aprobado.
        try {
          await registrarRevision(formulario.id, 'visto_bueno');
        } catch {
          // Ya aprobado antes por este rol — no es un error real aquí.
        }
      }
      await Promise.all([cargarEvidencias(), recargarRevisiones()]);
      Alert.alert('✅ Guardado', 'Evidencia final registrada y formulario aprobado.');
    } catch (error) {
      Alert.alert('No se pudo guardar', error instanceof Error ? error.message : String(error));
    } finally {
      setGuardando(false);
    }
  };

  if (!esRevisor && evidencias.length === 0) return null;

  const centroMapa = geoPoint
    ? { latitud: geoPoint.lat, longitud: geoPoint.lon }
    : formulario.coordenadas || { latitud: 1.914, longitud: -75.145 };

  return (
    <View style={finalStyles.section}>
      <Text style={finalStyles.title}>🖊️ Sección del Revisor — Evidencia y Cierre</Text>

      {esRevisor && (
        <>
          <Text style={finalStyles.label}>Fotos propias de la revisión</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} style={finalStyles.fotosRow}>
            {fotos.map((f, idx) => (
              <View key={idx} style={finalStyles.fotoThumb}>
                <Image source={{ uri: f.uri }} style={finalStyles.fotoImg} />
                <TouchableOpacity style={finalStyles.fotoRemove} onPress={() => setFotos((prev) => prev.filter((_, i) => i !== idx))}>
                  <Text style={finalStyles.fotoRemoveText}>✕</Text>
                </TouchableOpacity>
              </View>
            ))}
            <TouchableOpacity style={finalStyles.fotoAdd} onPress={tomarFoto}>
              <Text style={finalStyles.fotoAddText}>📷</Text>
            </TouchableOpacity>
          </ScrollView>

          <Text style={finalStyles.label}>Firma del beneficiario</Text>
          {firmaBeneficiario ? (
            <View style={finalStyles.firmaOk}>
              <Image source={{ uri: firmaBeneficiario }} style={finalStyles.firmaImg} />
              <TouchableOpacity onPress={() => setPadActivo('beneficiario')}><Text style={finalStyles.link}>Rehacer</Text></TouchableOpacity>
            </View>
          ) : padActivo === 'beneficiario' ? (
            <SignaturePad onOK={(sig) => { setFirmaBeneficiario(sig); setPadActivo(null); }} description="Firma del beneficiario" />
          ) : (
            <TouchableOpacity style={finalStyles.btnSecundario} onPress={() => setPadActivo('beneficiario')}>
              <Text style={finalStyles.btnSecundarioText}>✍️ Capturar firma del beneficiario</Text>
            </TouchableOpacity>
          )}

          <Text style={finalStyles.label}>Firma del {ROL_LABEL[rol] || 'revisor'}</Text>
          {firmaRevisor ? (
            <View style={finalStyles.firmaOk}>
              <Image source={{ uri: firmaRevisor }} style={finalStyles.firmaImg} />
              <TouchableOpacity onPress={() => setPadActivo('revisor')}><Text style={finalStyles.link}>Rehacer</Text></TouchableOpacity>
            </View>
          ) : padActivo === 'revisor' ? (
            <SignaturePad onOK={(sig) => { setFirmaRevisor(sig); setPadActivo(null); }} description={`Firma del ${ROL_LABEL[rol] || 'revisor'}`} />
          ) : (
            <TouchableOpacity style={finalStyles.btnSecundario} onPress={() => setPadActivo('revisor')}>
              <Text style={finalStyles.btnSecundarioText}>✍️ Capturar tu firma</Text>
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

          <TouchableOpacity style={finalStyles.btnPrincipal} onPress={guardarYAprobar} disabled={guardando}>
            <Text style={finalStyles.btnPrincipalText}>
              {guardando ? 'Guardando…' : miEvidencia ? '💾 Actualizar evidencia' : '💾 Guardar y aprobar formulario'}
            </Text>
          </TouchableOpacity>
        </>
      )}

      {otrasEvidencias.map((e) => (
        <View key={e.id} style={finalStyles.otraEvidencia}>
          <Text style={finalStyles.label}>Evidencia de {ROL_LABEL[e.revisor_rol] || e.revisor_rol} ({e.revisor_nombre})</Text>
          {!!e.fotos_json?.length && (
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={finalStyles.fotosRow}>
              {e.fotos_json.map((f, idx) => (
                <Image key={idx} source={{ uri: f.uri }} style={finalStyles.fotoImg} />
              ))}
            </ScrollView>
          )}
          <View style={finalStyles.firmasRow}>
            {!!e.firma_beneficiario && <Image source={{ uri: e.firma_beneficiario }} style={finalStyles.firmaImg} />}
            {!!e.firma_revisor && <Image source={{ uri: e.firma_revisor }} style={finalStyles.firmaImg} />}
          </View>
          {e.geo_latitud != null && e.geo_longitud != null && (
            <Text style={finalStyles.hint}>📍 Lat: {Number(e.geo_latitud).toFixed(6)}  Lon: {Number(e.geo_longitud).toFixed(6)}</Text>
          )}
          {!!e.observaciones && <Text style={finalStyles.hint}>{e.observaciones}</Text>}
        </View>
      ))}
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
  fotosRow: { flexDirection: 'row' },
  fotoThumb: { marginRight: SPACING.sm, position: 'relative' },
  fotoImg: { width: 70, height: 70, borderRadius: BORDER_RADIUS.sm, marginRight: SPACING.sm },
  fotoAdd: { width: 70, height: 70, borderRadius: BORDER_RADIUS.sm, backgroundColor: COLORS.background, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: COLORS.border, borderStyle: 'dashed' },
  fotoAddText: { fontSize: 24 },
  fotoRemove: { position: 'absolute', top: -6, right: 2, backgroundColor: COLORS.error, borderRadius: 10, width: 20, height: 20, justifyContent: 'center', alignItems: 'center' },
  fotoRemoveText: { color: '#fff', fontSize: 12, fontWeight: FONTS.weights.bold },
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
  otraEvidencia: { marginTop: SPACING.sm, paddingTop: SPACING.sm, borderTopWidth: 1, borderTopColor: COLORS.divider },
  firmasRow: { flexDirection: 'row', gap: SPACING.sm },
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
  const { formulario } = route.params;
  const insets = useSafeAreaInsets();
  const { user: usuarioActual } = useAuth();
  const rolActual = usuarioActual?.rol || 'tecnico';
  const esRevisorActual = ['supervisor', 'interventor', 'gerente', 'admin'].includes(rolActual);
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

        {/* Revisión jerárquica: novedades y vistos buenos */}
        <SeccionRevision
          formulario={formulario}
          revisiones={revisiones}
          cargando={cargandoRevisiones}
          recargar={recargarRevisiones}
        />

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
              <SeccionMiniRevision
                formularioId={formulario.id}
                seccionTitulo={seccion.titulo}
                revisiones={revisiones}
                rol={rolActual}
                esRevisor={esRevisorActual}
                recargar={recargarRevisiones}
              />
            </View>
          ))}

        {/* Sección final del revisor: evidencia propia, firma dual y
            georeferencia puntual — cierra la revisión con visto bueno global. */}
        <SeccionFinalRevisor formulario={formulario} recargarRevisiones={recargarRevisiones} />

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
          </View>
        )}

        {/* Datos del Técnico */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>👤 Datos del Técnico</Text>
          <View style={styles.row}><Text style={styles.label}>Nombre:</Text><Text style={styles.value}>{formulario.tecnico?.nombre || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Cédula:</Text><Text style={styles.value}>{formulario.tecnico.cedula}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Teléfono:</Text><Text style={styles.value}>{formulario.tecnico.telefono || '—'}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Email:</Text><Text style={styles.value}>{formulario.tecnico.email || '—'}</Text></View>
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
        </View>

        {/* Actividad (solo para formularios tradicionales) */}
        {!(formulario as any).caracterizacion_nueva && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>📋 Actividad Realizada</Text>
            <View style={styles.row}><Text style={styles.label}>Descripción:</Text><Text style={styles.value}>{formulario.actividad.descripcion || '—'}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Observaciones:</Text><Text style={styles.value}>{formulario.actividad.observaciones || '—'}</Text></View>
            <View style={styles.row}><Text style={styles.label}>Recomendaciones:</Text><Text style={styles.value}>{formulario.actividad.recomendaciones || '—'}</Text></View>
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
          </View>
        )}

        {/* Fecha */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>⏱️ Fechas</Text>
          <View style={styles.row}><Text style={styles.label}>Creado:</Text><Text style={styles.value}>{formatFecha(formulario.created_at)}</Text></View>
          <View style={styles.row}><Text style={styles.label}>Actualizado:</Text><Text style={styles.value}>{formatFecha(formulario.updated_at)}</Text></View>
        </View>
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
