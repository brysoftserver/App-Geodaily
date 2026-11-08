// ============================================================
// GEODAILY — Fortalecimiento de Capacidades en Cacao Sostenible
// ============================================================
// Árbol de navegación (todo dentro de la ruta ActividadDetalle, que existe en
// los navegadores de todos los roles; el nivel viaja en params.fort):
//   1. Componentes: ECAS · Cartillas · Folletos
//   2. ECAS → ECA 1 … ECA 7
//   3. ECA n → 7 grupos de veredas
//   4. Grupo → Protocolo (PDF) · Informes (PDF) ·
//              Listado de Asistencia (PDF o foto) · Registro Fotográfico (fotos)
// Técnicos y admin suben; todos los roles ven. Los archivos quedan en MinIO
// en carpetas por ECA / grupo / sección (ver backend/src/lib/fortalecimiento.js).
// ============================================================

import React, { useCallback, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Image,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import * as Sharing from 'expo-sharing';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { avisar, confirmar } from '../../utils/dialogos';
import PdfViewer from '../../components/PdfViewer';
import {
  COMPONENTES_FORTALECIMIENTO,
  GRUPOS_VEREDAS,
  NivelFortalecimiento,
  SECCIONES_ECA,
  SeccionEca,
  TOTAL_ECAS,
} from '../../data/fortalecimiento';
import {
  ArchivoFortalecimiento,
  ArchivosGrupoEca,
  descargarPdfFortalecimiento,
  eliminarArchivoFortalecimiento,
  fuenteArchivoFortalecimiento,
  obtenerArchivosGrupoEca,
  obtenerResumenEcas,
  subirArchivoEca,
} from '../../services/fortalecimiento.service';

type Fuente = { uri: string; headers?: Record<string, string> };

const mensajeError = (e: any, porDefecto: string) =>
  e?.response?.data?.mensaje || (e?.message?.includes('Network') ? 'Sin conexión. Verifica tu internet.' : porDefecto);

const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' });

/** Miniatura de una foto del servidor (resuelve la URL con su token). */
const Miniatura: React.FC<{ archivo: ArchivoFortalecimiento; onPress: () => void }> = ({ archivo, onPress }) => {
  const [fuente, setFuente] = useState<Fuente | null>(null);
  React.useEffect(() => {
    let vivo = true;
    fuenteArchivoFortalecimiento(archivo.id).then((f) => vivo && setFuente(f));
    return () => { vivo = false; };
  }, [archivo.id]);
  return (
    <TouchableOpacity style={styles.miniatura} onPress={onPress} activeOpacity={0.8}>
      {fuente ? <Image source={fuente} style={styles.miniaturaImg} resizeMode="cover" /> : <ActivityIndicator color={COLORS.primary} />}
    </TouchableOpacity>
  );
};

/** Tarjeta de menú (componente, ECA o grupo). */
const Opcion: React.FC<{ icon?: string; etiqueta?: string; titulo: string; detalle?: string; onPress: () => void }> = ({
  icon, etiqueta, titulo, detalle, onPress,
}) => (
  <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={onPress}>
    {icon ? <Text style={styles.icon}>{icon}</Text> : null}
    <View style={{ flex: 1 }}>
      {etiqueta ? <Text style={styles.etiqueta}>{etiqueta}</Text> : null}
      <Text style={styles.title}>{titulo}</Text>
    </View>
    {detalle ? <Text style={styles.detalle}>{detalle}</Text> : null}
    <Text style={styles.arrow}>›</Text>
  </TouchableOpacity>
);

const FortalecimientoScreen: React.FC<any> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const nivel: NivelFortalecimiento = route?.params?.fort ?? {};
  const { componente, eca, grupo } = nivel;

  const ir = (siguiente: NivelFortalecimiento) =>
    navigation.push('ActividadDetalle', { ...route.params, fort: siguiente });

  useLayoutEffect(() => {
    const titulo =
      eca && grupo ? `ECA ${eca} · Grupo ${grupo}`
        : eca ? `ECA ${eca}`
          : componente ? COMPONENTES_FORTALECIMIENTO.find((c) => c.id === componente)?.nombre ?? 'Fortalecimiento'
            : 'Fortalecimiento de Capacidades';
    navigation.setOptions({ title: titulo });
  }, [navigation, componente, eca, grupo]);

  // ─── Conteos (niveles ECA y grupo) ──────────────────────
  const [conteos, setConteos] = useState<Record<string, Record<string, number>> | null>(null);
  useFocusEffect(
    useCallback(() => {
      if (componente !== 'ecas' || grupo) return;
      obtenerResumenEcas().then(setConteos).catch(() => setConteos(null));
    }, [componente, grupo])
  );
  const totalEca = (n: number) => Object.values(conteos?.[n] ?? {}).reduce((s, x) => s + x, 0);
  const textoConteo = (n: number | undefined) => (conteos === null ? undefined : `${n ?? 0} archivo${n === 1 ? '' : 's'}`);

  const contenedor = (hijos: React.ReactNode) => (
    <ScrollView style={styles.container} contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SPACING.xl }]}>
      {hijos}
    </ScrollView>
  );

  // 1. Componentes
  if (!componente) {
    return contenedor(
      COMPONENTES_FORTALECIMIENTO.map((c) => (
        <Opcion key={c.id} icon={c.icon} titulo={c.nombre} onPress={() => ir({ componente: c.id })} />
      ))
    );
  }

  // Cartillas y Folletos: aún sin contenido definido.
  if (componente !== 'ecas') {
    const c = COMPONENTES_FORTALECIMIENTO.find((x) => x.id === componente);
    return (
      <View style={[styles.container, styles.centrado]}>
        <Text style={styles.iconGrande}>{c?.icon ?? '📋'}</Text>
        <Text style={styles.tituloGrande}>{c?.nombre ?? 'Componente'}</Text>
        <Text style={styles.subtitulo}>Pendiente de definir su contenido</Text>
      </View>
    );
  }

  // 2. ECA 1 … ECA 7
  if (!eca) {
    return contenedor(
      Array.from({ length: TOTAL_ECAS }, (_, i) => i + 1).map((n) => (
        <Opcion key={n} icon="🎓" titulo={`ECA ${n}`} detalle={textoConteo(totalEca(n))} onPress={() => ir({ componente, eca: n })} />
      ))
    );
  }

  // 3. Grupos de veredas
  if (!grupo) {
    return contenedor(
      GRUPOS_VEREDAS.map((veredas, i) => (
        <Opcion
          key={i}
          etiqueta={`Grupo ${i + 1}`}
          titulo={veredas}
          detalle={textoConteo(conteos?.[eca]?.[i + 1])}
          onPress={() => ir({ componente, eca, grupo: i + 1 })}
        />
      ))
    );
  }

  // 4. Secciones del grupo
  return <SeccionesGrupo eca={eca} grupo={grupo} />;
};

// ============================================================
// Nivel 4: Protocolo · Informes · Listado de Asistencia · Registro Fotográfico
// ============================================================

const SeccionesGrupo: React.FC<{ eca: number; grupo: number }> = ({ eca, grupo }) => {
  const insets = useSafeAreaInsets();
  const [data, setData] = useState<ArchivosGrupoEca | null>(null);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [subiendo, setSubiendo] = useState<SeccionEca | null>(null);
  const [abiertas, setAbiertas] = useState<Partial<Record<SeccionEca, boolean>>>({});
  const [abriendoPdf, setAbriendoPdf] = useState<number | null>(null);
  const [visorFoto, setVisorFoto] = useState<{ archivo: ArchivoFortalecimiento; fuente: Fuente } | null>(null);
  const [visorPdf, setVisorPdf] = useState<{ uri: string; titulo: string; key: string } | null>(null);

  const cargar = useCallback(async (esRefresh = false) => {
    try {
      if (esRefresh) setRefrescando(true);
      setData(await obtenerArchivosGrupoEca(eca, grupo));
    } catch (e) {
      avisar('No se pudo cargar', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }, [eca, grupo]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  // ─── Subir ──────────────────────────────────────────────
  const elegirArchivos = async (admite: 'pdf' | 'pdf_o_foto' | 'foto') => {
    if (admite === 'foto') {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.7 });
      if (r.canceled || !r.assets?.length) return [];
      return r.assets.map((a, i) => ({ uri: a.uri, nombre: a.fileName || `foto_${Date.now()}_${i}.jpg`, mimeType: a.mimeType || 'image/jpeg' }));
    }
    const r = await DocumentPicker.getDocumentAsync({
      type: admite === 'pdf' ? 'application/pdf' : ['application/pdf', 'image/*'],
      multiple: true,
      copyToCacheDirectory: true,
    });
    if (r.canceled || !r.assets?.length) return [];
    return r.assets.map((a) => ({ uri: a.uri, nombre: a.name, mimeType: a.mimeType }));
  };

  const subir = async (seccion: SeccionEca, admite: 'pdf' | 'pdf_o_foto' | 'foto') => {
    if (subiendo) return;
    const elegidos = await elegirArchivos(admite);
    if (!elegidos.length) return;
    setSubiendo(seccion);
    let fallas = 0;
    let ultimoError: any = null;
    for (const archivo of elegidos) {
      try {
        await subirArchivoEca(eca, grupo, seccion, archivo);
      } catch (e) {
        fallas++;
        ultimoError = e;
      }
    }
    setSubiendo(null);
    setAbiertas((a) => ({ ...a, [seccion]: true }));
    await cargar();
    if (fallas > 0) {
      avisar(
        elegidos.length === 1 ? 'No se pudo subir' : 'Algunos archivos no se subieron',
        `${elegidos.length === 1 ? '' : `${fallas} de ${elegidos.length}: `}${mensajeError(ultimoError, 'Inténtalo de nuevo.')}`
      );
    }
  };

  // ─── Ver ────────────────────────────────────────────────
  const abrir = async (archivo: ArchivoFortalecimiento) => {
    if (archivo.tipo === 'imagen') {
      setVisorFoto({ archivo, fuente: await fuenteArchivoFortalecimiento(archivo.id) });
      return;
    }
    if (abriendoPdf !== null) return;
    // En web la pestaña se abre ANTES del await para que no la bloquee el navegador.
    const ventana = Platform.OS === 'web' ? window.open('', '_blank') : null;
    setAbriendoPdf(archivo.id);
    try {
      const uri = await descargarPdfFortalecimiento(archivo.id);
      if (Platform.OS === 'web') {
        if (ventana) ventana.location.href = uri;
        else window.location.href = uri;
        return;
      }
      setVisorPdf({ uri, titulo: archivo.nombre || 'Documento', key: `fort_${archivo.id}_${Date.now()}` });
    } catch (e) {
      ventana?.close();
      avisar('No se pudo abrir el PDF', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setAbriendoPdf(null);
    }
  };

  const eliminar = async (archivo: ArchivoFortalecimiento) => {
    if (!(await confirmar('Eliminar archivo', `¿Eliminar "${archivo.nombre || 'archivo'}"? No se puede deshacer.`, 'Eliminar', true))) return;
    try {
      await eliminarArchivoFortalecimiento(archivo.id);
      setVisorFoto(null);
      await cargar();
    } catch (e) {
      avisar('No se pudo eliminar', mensajeError(e, 'Inténtalo de nuevo.'));
    }
  };

  // ─── Render ─────────────────────────────────────────────
  const textoSubir = (admite: 'pdf' | 'pdf_o_foto' | 'foto') =>
    admite === 'pdf' ? '⬆️ Subir PDF' : admite === 'foto' ? '⬆️ Subir fotos' : '⬆️ Subir PDF o fotos';

  const filaArchivo = (a: ArchivoFortalecimiento) => (
    <View key={a.id} style={styles.archivo}>
      <TouchableOpacity style={styles.archivoInfo} onPress={() => abrir(a)} activeOpacity={0.7}>
        {a.tipo === 'imagen' ? <Miniatura archivo={a} onPress={() => abrir(a)} /> : <Text style={styles.archivoIcono}>📄</Text>}
        <View style={{ flex: 1, marginLeft: SPACING.sm }}>
          <Text style={styles.archivoNombre} numberOfLines={2}>{a.nombre || 'Archivo'}</Text>
          <Text style={styles.archivoMeta}>{[a.subidoPor, fechaCorta(a.fecha)].filter(Boolean).join(' · ')}</Text>
        </View>
        {abriendoPdf === a.id ? <ActivityIndicator color={COLORS.primary} /> : null}
      </TouchableOpacity>
      {a.puedeEliminar && (
        <TouchableOpacity onPress={() => eliminar(a)} style={styles.btnQuitar} hitSlop={8}>
          <Text style={styles.btnQuitarTxt}>✕</Text>
        </TouchableOpacity>
      )}
    </View>
  );

  return (
    <View style={styles.container}>
      {cargando ? (
        <ActivityIndicator style={{ marginTop: SPACING.xl }} size="large" color={COLORS.primary} />
      ) : (
        <ScrollView
          contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SPACING.xl }]}
          refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => cargar(true)} colors={[COLORS.primary]} />}
        >
          <View style={styles.cabecera}>
            <Text style={styles.etiqueta}>{`ECA ${eca} · Grupo ${grupo}`}</Text>
            <Text style={styles.veredas}>{GRUPOS_VEREDAS[grupo - 1]}</Text>
          </View>

          {SECCIONES_ECA.map((s) => {
            const archivos = data?.secciones?.[s.id] ?? [];
            const abierta = !!abiertas[s.id];
            const esFotos = s.id === 'registro_fotografico';
            return (
              <View key={s.id} style={styles.segmento}>
                <View style={styles.segmentoCabecera}>
                  <Text style={styles.segmentoTitulo}>{`${s.icon} ${s.titulo}`}</Text>
                  <Text style={styles.contador}>{archivos.length}</Text>
                </View>

                <View style={styles.botones}>
                  {data?.puedeSubir && (
                    <TouchableOpacity
                      style={[styles.btnPrimario, subiendo !== null && styles.btnDeshabilitado]}
                      onPress={() => subir(s.id, s.admite)}
                      disabled={subiendo !== null}
                      activeOpacity={0.8}
                    >
                      {subiendo === s.id ? (
                        <><ActivityIndicator size="small" color="#fff" /><Text style={styles.btnPrimarioTxt}>  Subiendo…</Text></>
                      ) : (
                        <Text style={styles.btnPrimarioTxt}>{textoSubir(s.admite)}</Text>
                      )}
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity
                    style={[styles.btnSec, archivos.length === 0 && styles.btnDeshabilitado]}
                    onPress={() => setAbiertas((a) => ({ ...a, [s.id]: !abierta }))}
                    disabled={archivos.length === 0}
                    activeOpacity={0.8}
                  >
                    <Text style={styles.btnSecTxt}>
                      {archivos.length === 0 ? 'Sin archivos' : `${abierta ? '▲ Ocultar' : '👁️ Ver'} ${esFotos ? 'fotos' : 'documentos'} (${archivos.length})`}
                    </Text>
                  </TouchableOpacity>
                </View>

                {abierta && archivos.length > 0 && (
                  esFotos ? (
                    <View style={styles.grilla}>
                      {archivos.map((a) => <Miniatura key={a.id} archivo={a} onPress={() => abrir(a)} />)}
                    </View>
                  ) : (
                    <View style={styles.lista}>{archivos.map(filaArchivo)}</View>
                  )
                )}
              </View>
            );
          })}
        </ScrollView>
      )}

      <Modal visible={visorFoto !== null} animationType="fade" transparent onRequestClose={() => setVisorFoto(null)}>
        {visorFoto && (
          <View style={styles.visorFondo}>
            <Image source={visorFoto.fuente} style={styles.visorImg} resizeMode="contain" />
            <View style={[styles.visorBarra, { paddingBottom: insets.bottom + SPACING.md }]}>
              {visorFoto.archivo.puedeEliminar && (
                <TouchableOpacity style={[styles.visorBtn, styles.visorBtnPeligro]} onPress={() => eliminar(visorFoto.archivo)}>
                  <Text style={styles.visorBtnTxt}>Eliminar</Text>
                </TouchableOpacity>
              )}
              <TouchableOpacity style={styles.visorBtn} onPress={() => setVisorFoto(null)}>
                <Text style={styles.visorBtnTxt}>Cerrar</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Modal>

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
  content: { padding: SPACING.md, gap: SPACING.sm },
  centrado: { alignItems: 'center', justifyContent: 'center', padding: SPACING.lg },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.primary,
    ...SHADOWS.sm,
  },
  icon: { fontSize: 28, marginRight: SPACING.md },
  etiqueta: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold, color: COLORS.primary, marginBottom: 2 },
  title: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  detalle: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.semibold, color: COLORS.textSecondary, marginLeft: SPACING.sm },
  arrow: { fontSize: 24, color: COLORS.textLight, marginLeft: SPACING.sm },
  iconGrande: { fontSize: 56, marginBottom: SPACING.md },
  tituloGrande: { fontSize: FONTS.sizes.xl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, textAlign: 'center' },
  subtitulo: { fontSize: FONTS.sizes.md, color: COLORS.textSecondary, marginTop: SPACING.sm, textAlign: 'center' },
  cabecera: { marginBottom: SPACING.xs },
  veredas: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },
  segmento: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, borderLeftWidth: 4, borderLeftColor: COLORS.primary, ...SHADOWS.sm },
  segmentoCabecera: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: SPACING.sm },
  segmentoTitulo: { flex: 1, fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  contador: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.semibold, color: COLORS.textSecondary, marginLeft: SPACING.sm },
  botones: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  btnPrimario: { flexGrow: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.md, paddingVertical: SPACING.sm + 2, paddingHorizontal: SPACING.md },
  btnPrimarioTxt: { color: '#fff', fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.sm },
  btnSec: { flexGrow: 1, borderWidth: 1, borderColor: COLORS.primary, borderRadius: BORDER_RADIUS.md, paddingVertical: SPACING.sm + 2, paddingHorizontal: SPACING.md, alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.surface },
  btnSecTxt: { color: COLORS.primary, fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.sm },
  btnDeshabilitado: { opacity: 0.5 },
  lista: { marginTop: SPACING.sm },
  grilla: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.sm },
  archivo: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm, borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: COLORS.border },
  archivoInfo: { flex: 1, flexDirection: 'row', alignItems: 'center' },
  archivoIcono: { fontSize: 28, width: 40, textAlign: 'center' },
  archivoNombre: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  archivoMeta: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 2 },
  btnQuitar: { paddingHorizontal: SPACING.sm, paddingVertical: 4 },
  btnQuitarTxt: { fontSize: FONTS.sizes.md, color: COLORS.error, fontWeight: FONTS.weights.bold },
  miniatura: { width: TAM_MINIATURA, height: TAM_MINIATURA, borderRadius: BORDER_RADIUS.md, backgroundColor: COLORS.background, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  miniaturaImg: { width: '100%', height: '100%' },
  visorFondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center' },
  visorImg: { flex: 1, width: '100%' },
  visorBarra: { flexDirection: 'row', justifyContent: 'center', gap: SPACING.md, paddingTop: SPACING.md },
  visorBtn: { backgroundColor: 'rgba(255,255,255,0.2)', paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg, borderRadius: BORDER_RADIUS.md },
  visorBtnPeligro: { backgroundColor: COLORS.error },
  visorBtnTxt: { color: '#fff', fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.md },
});

export default FortalecimientoScreen;
