// ============================================================
// GEODAILY — Análisis de Suelos Completos por Predio
// ============================================================
// Una sola pantalla con dos vistas según quién entra:
//   · técnico (modo 'ejecutar')  → tabla de SUS beneficiarios: subir / ver /
//     quitar el PDF de laboratorio + informe PDF (historial).
//   · superior (modo 'revisar')  → torta de realizados vs. faltantes y TODOS
//     los beneficiarios que ya tienen el PDF (sin filtro por técnico). Admin
//     e interventor marcan cada uno con "OK" → "Revisado por interventoría".
// ============================================================

import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Svg, { Circle, Path, Rect } from 'react-native-svg';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useAuth } from '../../store/AuthContext';
import { avisar, confirmar } from '../../utils/dialogos';
import { abrirDetalleFormulario } from '../../utils/abrirDetalleFormulario';
import PdfViewer from '../../components/PdfViewer';
import TortaResumen, { COLOR_FALTA, COLOR_HECHO } from '../../components/actividades/TortaResumen';
import { BotonOkInterventoria, ESTILO_CARD_REVISADA, EtiquetaRevisado } from '../../components/actividades/RevisionInterventoria';
import { useRevisionInterventoria } from '../../hooks/useRevisionInterventoria';
import {
  BeneficiarioSuelos,
  descargarMatrizExcelSuelos,
  descargarPdfSuelos,
  eliminarInformeSuelos,
  InformeHistorialSuelos,
  listarBeneficiariosConAnalisis,
  listarInformesSuelos,
  listarMisBeneficiariosSuelos,
  quitarPdfSuelos,
  subirPdfSuelos,
} from '../../services/analisisSuelos.service';
import { abrirInformeSuelosGuardado, generarYAbrirInformeSuelos } from '../../services/analisisSuelosPdf.service';

const ACTIVIDAD_ID = 'analisis_suelos';

const mensajeError = (e: any, porDefecto: string) =>
  e?.response?.data?.mensaje || (e?.message?.includes('Network') ? 'Sin conexión. Verifica tu internet.' : porDefecto);

/** Icono de Excel (hoja verde con la X blanca), dibujado en SVG. */
const IconoExcel: React.FC<{ size?: number }> = ({ size = 22 }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24">
    <Rect x="7" y="2" width="15" height="20" rx="2" fill="#21A366" />
    <Path d="M14 2h6a2 2 0 0 1 2 2v4h-8z" fill="#33C481" />
    <Path d="M14 16h8v4a2 2 0 0 1-2 2h-6z" fill="#185C37" />
    <Rect x="2" y="6" width="12" height="12" rx="1.5" fill="#107C41" />
    <Path d="M5 8.5h2.1l1.4 2.4 1.4-2.4H12l-2.4 3.5 2.4 3.5H9.9l-1.4-2.4-1.4 2.4H5l2.4-3.5z" fill="#fff" />
  </Svg>
);

/** Icono de historial (reloj con flecha de regreso), dibujado en SVG. */
const IconoHistorial: React.FC<{ size?: number; color?: string }> = ({ size = 24, color = COLORS.primary }) => (
  <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
    <Path d="M3.5 12a8.5 8.5 0 1 0 2.5-6" stroke={color} strokeWidth={2} strokeLinecap="round" />
    <Path d="M3 3.5v4.2h4.2" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    <Path d="M12 7.5V12l3 2" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
    <Circle cx={12} cy={12} r={0.6} fill={color} />
  </Svg>
);

const fechaInforme = (iso: string) =>
  new Date(iso).toLocaleString('es-CO', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'America/Bogota' });

const AnalisisSuelosScreen: React.FC<any> = ({ navigation, route }) => {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const modo: 'ejecutar' | 'revisar' = route?.params?.modo === 'revisar' ? 'revisar' : 'ejecutar';
  const revisar = modo === 'revisar';
  const puedeEscribir = modo === 'ejecutar';
  const esAdmin = user?.rol === 'admin';
  const revision = useRevisionInterventoria(ACTIVIDAD_ID);

  const [beneficiarios, setBeneficiarios] = useState<BeneficiarioSuelos[]>([]);
  const [meta, setMeta] = useState(300);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [abriendoVisita, setAbriendoVisita] = useState<number | null>(null);
  const [generando, setGenerando] = useState(false);
  const [visor, setVisor] = useState<{ uri: string; titulo: string; key: string } | null>(null);
  const [bajandoMatriz, setBajandoMatriz] = useState(false);

  // Matriz consolidada de resultados (Excel). Web: descarga directa del
  // navegador. Nativo: se baja a caché y se abre el menú de compartir/abrir.
  const descargarMatriz = useCallback(async () => {
    if (bajandoMatriz) return;
    setBajandoMatriz(true);
    try {
      const uri = await descargarMatrizExcelSuelos();
      if (Platform.OS === 'web') {
        const a = document.createElement('a');
        a.href = uri;
        a.download = 'Matriz resultados estudio de suelos.xlsx';
        document.body.appendChild(a);
        a.click();
        a.remove();
        return;
      }
      await Sharing.shareAsync(uri, {
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        UTI: 'org.openxmlformats.spreadsheetml.sheet',
        dialogTitle: 'Matriz resultado de estudio de suelos',
      });
    } catch (e) {
      avisar('No se pudo descargar', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setBajandoMatriz(false);
    }
  }, [bajandoMatriz]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: revisar ? 'Revisar Análisis de Suelos' : 'Análisis de Suelos',
      headerRight: revisar
        ? () => (
            <TouchableOpacity
              style={[styles.btnExcel, bajandoMatriz && { opacity: 0.6 }]}
              onPress={descargarMatriz}
              disabled={bajandoMatriz}
              activeOpacity={0.8}
              accessibilityLabel="Descargar matriz resultado de estudio de suelos"
            >
              {bajandoMatriz ? <ActivityIndicator size="small" color="#107C41" /> : <IconoExcel />}
              <Text style={styles.btnExcelTxt} numberOfLines={2}>Matriz resultado de estudio de suelos</Text>
            </TouchableOpacity>
          )
        : undefined,
    });
  }, [navigation, revisar, bajandoMatriz, descargarMatriz]);

  const cargar = useCallback(async (esRefresh = false) => {
    try {
      if (esRefresh) setRefrescando(true);
      if (revisar) {
        const r = await listarBeneficiariosConAnalisis();
        setMeta(r.meta);
        setBeneficiarios(r.beneficiarios);
        revision.recargar();
      } else {
        setBeneficiarios(await listarMisBeneficiariosSuelos());
      }
    } catch (e) {
      avisar('No se pudo cargar', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [revisar]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  // Solo el técnico (modo 'ejecutar') llega a la Visita 1 tocando al
  // beneficiario; en la revisión la tarjeta no navega. Si aún no la hizo, no pasa nada.
  const abrirVisita1 = async (b: BeneficiarioSuelos) => {
    if (!puedeEscribir || !b.formularioId || abriendoVisita !== null) return;
    setAbriendoVisita(b.item);
    try {
      await abrirDetalleFormulario(navigation, user?.rol, b.formularioId);
    } finally {
      setAbriendoVisita(null);
    }
  };

  const subir = async (b: BeneficiarioSuelos) => {
    const r = await DocumentPicker.getDocumentAsync({ type: 'application/pdf', copyToCacheDirectory: true });
    if (r.canceled || !r.assets?.[0]) return;
    const a = r.assets[0];
    setOcupado(b.item);
    try {
      await subirPdfSuelos(b.item, { uri: a.uri, nombre: a.name, mimeType: a.mimeType });
      await cargar();
    } catch (e) {
      avisar('No se pudo subir', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setOcupado(null);
    }
  };

  const ver = async (b: BeneficiarioSuelos) => {
    // En web el visor interno (WebView) no existe: el navegador ya muestra el
    // PDF, así que se abre en una pestaña nueva. La pestaña se abre ANTES del
    // await para que el bloqueador de ventanas emergentes no la impida.
    const ventana = Platform.OS === 'web' ? window.open('', '_blank') : null;
    setOcupado(b.item);
    try {
      const uri = await descargarPdfSuelos(b.item);
      if (Platform.OS === 'web') {
        if (ventana) ventana.location.href = uri;
        else window.location.href = uri;
        return;
      }
      setVisor({ uri, titulo: b.nombre, key: `suelos_${b.item}_${Date.now()}` });
    } catch (e) {
      ventana?.close();
      avisar('No se pudo abrir el PDF', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setOcupado(null);
    }
  };

  const quitar = async (b: BeneficiarioSuelos) => {
    const acepto = await confirmar('Quitar PDF', `¿Quitar el análisis de ${b.nombre}? Podrás subir otro después.`, 'Quitar', true);
    if (!acepto) return;
    setOcupado(b.item);
    try {
      await quitarPdfSuelos(b.item);
      await cargar();
    } catch (e) {
      avisar('No se pudo quitar', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setOcupado(null);
    }
  };

  const generarInforme = async () => {
    setGenerando(true);
    // El técnico no manda nada: el servidor usa su propia identidad. El
    // informe queda guardado en el historial del servidor.
    await generarYAbrirInformeSuelos({ tecnico: undefined });
    setGenerando(false);
  };

  // ─── Historial de informes generados ───
  const [historialVisible, setHistorialVisible] = useState(false);
  const [historial, setHistorial] = useState<InformeHistorialSuelos[]>([]);
  const [cargandoHistorial, setCargandoHistorial] = useState(false);
  const [abriendoInforme, setAbriendoInforme] = useState<number | null>(null);

  const abrirHistorial = async () => {
    setHistorialVisible(true);
    setCargandoHistorial(true);
    try {
      setHistorial(await listarInformesSuelos());
    } catch (e) {
      avisar('No se pudo cargar el historial', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setCargandoHistorial(false);
    }
  };

  const abrirGuardado = async (id: number) => {
    if (abriendoInforme !== null) return;
    setAbriendoInforme(id);
    await abrirInformeSuelosGuardado(id);
    setAbriendoInforme(null);
    if (Platform.OS !== 'web') setHistorialVisible(false);
  };

  const [eliminandoInforme, setEliminandoInforme] = useState<number | null>(null);
  const eliminarGuardado = async (h: InformeHistorialSuelos) => {
    if (!esAdmin || eliminandoInforme !== null) return;
    const acepto = await confirmar(
      'Eliminar informe',
      `¿Eliminar el Informe N.º ${h.id} del historial? Esta acción no se puede deshacer.`,
      'Eliminar',
      true,
    );
    if (!acepto) return;
    setEliminandoInforme(h.id);
    try {
      await eliminarInformeSuelos(h.id);
      setHistorial((prev) => prev.filter((x) => x.id !== h.id));
    } catch (e) {
      avisar('No se pudo eliminar', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setEliminandoInforme(null);
    }
  };

  const subidos = useMemo(() => beneficiarios.filter((b) => b.tieneArchivo).length, [beneficiarios]);

  // Búsqueda rápida por nombre o cédula (sin tildes ni mayúsculas).
  const [busqueda, setBusqueda] = useState('');
  const normalizar = (t: string) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const filtrados = useMemo(() => {
    const q = normalizar(busqueda.trim());
    if (!q) return beneficiarios;
    const qDigitos = q.replace(/\D/g, '');
    return beneficiarios.filter((b) =>
      normalizar(b.nombre).includes(q) ||
      (qDigitos.length > 0 && String(b.cedula || '').replace(/\D/g, '').includes(qDigitos)),
    );
  }, [beneficiarios, busqueda]);

  const cajaBusqueda = (
    <TextInput
      style={styles.busqueda}
      value={busqueda}
      onChangeText={setBusqueda}
      placeholder="🔍 Buscar por nombre o cédula"
      placeholderTextColor={COLORS.textSecondary}
      autoCorrect={false}
      autoCapitalize="none"
      clearButtonMode="while-editing"
    />
  );

  const botonInforme = (texto: string) => (
    <View style={styles.filaInforme}>
      <TouchableOpacity style={[styles.btnInforme, { flex: 1 }]} onPress={generarInforme} disabled={generando} activeOpacity={0.8}>
        {generando ? (
          <><ActivityIndicator size="small" color="#fff" /><Text style={styles.btnInformeTxt}>  Generando informe…</Text></>
        ) : (
          <Text style={styles.btnInformeTxt}>📄 {texto}</Text>
        )}
      </TouchableOpacity>
      <TouchableOpacity
        style={styles.btnHistorial}
        onPress={abrirHistorial}
        activeOpacity={0.8}
        accessibilityLabel="Historial de informes generados"
      >
        <IconoHistorial />
      </TouchableOpacity>
    </View>
  );

  // ─── Beneficiarios (técnico: los suyos · superior: todos los que tienen PDF) ──
  return (
    <View style={styles.container}>
      {cargando ? (
        <ActivityIndicator style={{ marginTop: SPACING.xl }} size="large" color={COLORS.primary} />
      ) : (
        <FlatList
          data={filtrados}
          keyExtractor={(b) => String(b.item)}
          contentContainerStyle={[styles.lista, { paddingBottom: insets.bottom + SPACING.xl }]}
          refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => cargar(true)} colors={[COLORS.primary]} />}
          ListHeaderComponent={
            revisar ? (
              <View>
                <TortaResumen
                  titulo={`Realizados vs. faltantes (meta ${meta})`}
                  datos={[
                    { etiqueta: 'Realizados', valor: beneficiarios.length, color: COLOR_HECHO },
                    { etiqueta: 'Faltan', valor: Math.max(meta - beneficiarios.length, 0), color: COLOR_FALTA },
                  ]}
                />
                {botonInforme('Informe de análisis de suelos · todos los predios')}
                <View style={styles.filaSeccion}>
                  <Text style={[styles.seccion, { flexShrink: 1 }]}>
                    Beneficiarios con análisis · {beneficiarios.length} · revisados {beneficiarios.filter((b) => revision.estaRevisado(b.item)).length}
                  </Text>
                  {cajaBusqueda}
                </View>
              </View>
            ) : (
              <View>
                {botonInforme('Informe de análisis de suelos')}
                <View style={styles.filaSeccion}>
                  <Text style={[styles.seccion, { flexShrink: 1 }]}>Beneficiarios · {subidos}/{beneficiarios.length} con análisis</Text>
                  {cajaBusqueda}
                </View>
              </View>
            )
          }
          ListEmptyComponent={<Text style={styles.vacio}>{busqueda.trim() ? 'Ningún beneficiario coincide con la búsqueda.' : revisar ? 'Aún no hay análisis subidos.' : 'No hay beneficiarios asignados.'}</Text>}
          renderItem={({ item: b }) => {
            const trabajando = ocupado === b.item;
            const revisado = b.tieneArchivo && revision.estaRevisado(b.item);
            return (
              <TouchableOpacity
                style={[styles.card, { borderLeftColor: b.tieneArchivo ? COLOR_HECHO : COLOR_FALTA }, revisado && ESTILO_CARD_REVISADA]}
                activeOpacity={puedeEscribir && b.formularioId ? 0.7 : 1}
                onPress={() => abrirVisita1(b)}
                disabled={!puedeEscribir || !b.formularioId}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.nombre}>{b.nombre}</Text>
                  <Text style={styles.dato}>C.C. {b.cedula}</Text>
                  <Text style={styles.dato}>{b.corregimiento} · {b.vereda}</Text>
                  {b.tieneArchivo && <EtiquetaRevisado revisado={revisado} pendiente={revisar} />}
                  {puedeEscribir && b.formularioId && (
                    <Text style={styles.visita1}>
                      {abriendoVisita === b.item ? 'Abriendo…' : '✓ Visita 1 · toca para ver'}
                    </Text>
                  )}
                </View>
                <View style={styles.acciones}>
                  {trabajando ? (
                    <ActivityIndicator color={COLORS.primary} />
                  ) : (
                    <>
                      {puedeEscribir && (
                        <TouchableOpacity style={[styles.btn, styles.btnPrimario]} onPress={() => subir(b)}>
                          <Text style={styles.btnPrimarioTxt}>{b.tieneArchivo ? 'Reemplazar' : 'Subir PDF'}</Text>
                        </TouchableOpacity>
                      )}
                      {b.tieneArchivo && (
                        <TouchableOpacity style={[styles.btn, styles.btnSecundario]} onPress={() => ver(b)}>
                          <Text style={styles.btnSecundarioTxt}>Ver</Text>
                        </TouchableOpacity>
                      )}
                      {b.tieneArchivo && (puedeEscribir || esAdmin) && (
                        <TouchableOpacity style={[styles.btn, styles.btnPeligro]} onPress={() => quitar(b)}>
                          <Text style={styles.btnPeligroTxt}>Quitar</Text>
                        </TouchableOpacity>
                      )}
                      {!b.tieneArchivo && !puedeEscribir && <Text style={styles.pendiente}>Pendiente</Text>}
                    </>
                  )}
                </View>
                {revisar && revision.puedeRevisar && b.tieneArchivo && (
                  <BotonOkInterventoria
                    style={styles.btnOk}
                    revisado={revisado}
                    ocupado={revision.ocupado === String(b.item)}
                    onPress={() => revision.alternar(b.item)}
                  />
                )}
              </TouchableOpacity>
            );
          }}
        />
      )}

      <Modal visible={historialVisible} transparent animationType="fade" onRequestClose={() => setHistorialVisible(false)}>
        <View style={styles.fondoModal}>
          <View style={[styles.cajaHistorial, { marginBottom: insets.bottom + SPACING.md }]}>
            <View style={styles.cabeceraHistorial}>
              <IconoHistorial size={22} />
              <Text style={styles.tituloHistorial}>Historial de informes</Text>
              <TouchableOpacity onPress={() => setHistorialVisible(false)} accessibilityLabel="Cerrar historial">
                <Text style={styles.cerrarHistorial}>✕</Text>
              </TouchableOpacity>
            </View>
            <Text style={styles.notaHistorial}>
              Cada informe queda guardado tal como se generó. Tócalo para abrirlo de nuevo.
            </Text>
            {cargandoHistorial ? (
              <ActivityIndicator style={{ marginVertical: SPACING.lg }} color={COLORS.primary} />
            ) : (
              <FlatList
                data={historial}
                keyExtractor={(h) => String(h.id)}
                style={{ maxHeight: 420 }}
                ListEmptyComponent={<Text style={styles.vacio}>Aún no se ha generado ningún informe.</Text>}
                renderItem={({ item: h }) => (
                  <TouchableOpacity style={styles.filaHistorial} onPress={() => abrirGuardado(h.id)} activeOpacity={0.7}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.nombre}>
                        Informe N.º {h.id} · {h.alcance === 'tecnicos' ? 'Todos los predios' : h.tecnicoNombre}
                      </Text>
                      <Text style={styles.dato}>{fechaInforme(h.creadoEn)}</Text>
                      <Text style={styles.dato}>
                        Por {h.generadoPor} · {h.beneficiariosConAnalisis} predios{h.conIa ? '' : ' · sin análisis global'}
                      </Text>
                    </View>
                    {abriendoInforme === h.id ? (
                      <ActivityIndicator color={COLORS.primary} />
                    ) : (
                      <Text style={styles.abrirHistorial}>Abrir</Text>
                    )}
                    {esAdmin && (
                      eliminandoInforme === h.id ? (
                        <ActivityIndicator color={COLORS.error} />
                      ) : (
                        <TouchableOpacity
                          style={styles.btnEliminarHistorial}
                          onPress={() => eliminarGuardado(h)}
                          accessibilityLabel={`Eliminar informe ${h.id}`}
                        >
                          <Text style={styles.eliminarHistorial}>Eliminar</Text>
                        </TouchableOpacity>
                      )
                    )}
                  </TouchableOpacity>
                )}
              />
            )}
          </View>
        </View>
      </Modal>

      <Modal visible={visor !== null} animationType="slide" onRequestClose={() => setVisor(null)}>
        {visor && (
          <PdfViewer
            archivo={visor.uri}
            titulo={visor.titulo}
            cacheKey={visor.key}
            onClose={() => setVisor(null)}
            onFallback={async () => {
              if (await Sharing.isAvailableAsync()) await Sharing.shareAsync(visor.uri, { mimeType: 'application/pdf', UTI: 'com.adobe.pdf' });
            }}
          />
        )}
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  lista: { padding: SPACING.md },
  seccion: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, marginTop: SPACING.md, marginBottom: SPACING.sm },
  filaSeccion: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SPACING.sm },
  busqueda: { flexGrow: 1, flexBasis: 220, marginLeft: 'auto', maxWidth: 420, borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, backgroundColor: COLORS.surface, paddingHorizontal: SPACING.md, paddingVertical: Platform.OS === 'web' ? SPACING.sm : 6, fontSize: FONTS.sizes.sm, color: COLORS.textPrimary, marginTop: SPACING.md, marginBottom: SPACING.sm },
  vacio: { textAlign: 'center', color: COLORS.textSecondary, padding: SPACING.md },
  btnExcel: { flexDirection: 'row', alignItems: 'center', gap: 6, marginRight: SPACING.md, paddingVertical: 6, paddingHorizontal: SPACING.sm, borderRadius: BORDER_RADIUS.md, borderWidth: 1, borderColor: '#107C41', backgroundColor: '#E8F5EC', maxWidth: 230 },
  btnExcelTxt: { color: '#107C41', fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.sm, flexShrink: 1 },
  btnInforme: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.md, paddingVertical: SPACING.md, marginBottom: SPACING.xs },
  btnInformeTxt: { color: '#fff', fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.md },
  filaInforme: { flexDirection: 'row', alignItems: 'stretch', gap: SPACING.sm, marginBottom: SPACING.xs },
  btnHistorial: { width: 52, alignItems: 'center', justifyContent: 'center', borderRadius: BORDER_RADIUS.md, borderWidth: 1.5, borderColor: COLORS.primary, backgroundColor: COLORS.surface, marginBottom: SPACING.xs },
  fondoModal: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)', justifyContent: 'center', padding: SPACING.md },
  cajaHistorial: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, width: '100%', maxWidth: 560, alignSelf: 'center', ...SHADOWS.sm },
  cabeceraHistorial: { flexDirection: 'row', alignItems: 'center', gap: SPACING.sm },
  tituloHistorial: { flex: 1, fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  cerrarHistorial: { fontSize: 20, color: COLORS.textSecondary, paddingHorizontal: SPACING.sm },
  notaHistorial: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: SPACING.xs, marginBottom: SPACING.sm },
  filaHistorial: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm, borderBottomWidth: 1, borderBottomColor: COLORS.border, gap: SPACING.sm },
  btnEliminarHistorial: { borderWidth: 1, borderColor: COLORS.error, borderRadius: BORDER_RADIUS.md, paddingVertical: 4, paddingHorizontal: SPACING.sm, marginLeft: SPACING.xs },
  eliminarHistorial: { color: COLORS.error, fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.sm },
  abrirHistorial: { color: COLORS.primary, fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.sm },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm, borderLeftWidth: 4, ...SHADOWS.sm },
  nombre: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  dato: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 1 },
  btnOk: { marginLeft: SPACING.sm, alignSelf: 'center' },
  acciones: { marginLeft: SPACING.sm, alignItems: 'stretch', minWidth: 92, gap: 6 },
  btn: { borderRadius: BORDER_RADIUS.md, paddingVertical: 6, paddingHorizontal: SPACING.sm, alignItems: 'center', borderWidth: 1 },
  btnPrimario: { backgroundColor: COLORS.primary, borderColor: COLORS.primary },
  btnPrimarioTxt: { color: '#fff', fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.sm },
  btnSecundario: { backgroundColor: COLORS.surface, borderColor: COLORS.primary },
  btnSecundarioTxt: { color: COLORS.primary, fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.sm },
  btnPeligro: { backgroundColor: COLORS.surface, borderColor: COLORS.error },
  btnPeligroTxt: { color: COLORS.error, fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.sm },
  visita1: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold, color: COLOR_HECHO, marginTop: 3 },
  pendiente: { color: COLOR_FALTA, fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.semibold, textAlign: 'center' },
});

export default AnalisisSuelosScreen;
