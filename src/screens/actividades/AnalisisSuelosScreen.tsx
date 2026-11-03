// ============================================================
// GEODAILY — Análisis de Suelos Completos por Predio
// ============================================================
// Una sola pantalla con tres vistas según quién entra:
//   · técnico (modo 'ejecutar')  → tabla de SUS beneficiarios: subir / ver /
//     quitar el PDF de laboratorio + informe PDF con IA.
//   · superior (modo 'revisar')  → 2 tortas de avance, lista de técnicos y
//     botón de PDF comparativo.
//   · superior con `tecnico`     → beneficiarios de ese técnico (solo ver) +
//     PDF de sus beneficiarios.
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
  TouchableOpacity,
  View,
} from 'react-native';
import * as DocumentPicker from 'expo-document-picker';
import * as Sharing from 'expo-sharing';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useAuth } from '../../store/AuthContext';
import { avisar, confirmar } from '../../utils/dialogos';
import { abrirDetalleFormulario } from '../../utils/abrirDetalleFormulario';
import PdfViewer from '../../components/PdfViewer';
import TortaResumen, { COLOR_FALTA, COLOR_HECHO, PALETA_TECNICOS } from '../../components/actividades/TortaResumen';
import {
  BeneficiarioSuelos,
  ResumenSuelos,
  descargarPdfSuelos,
  listarBeneficiariosSuelosDeTecnico,
  listarMisBeneficiariosSuelos,
  obtenerResumenSuelos,
  quitarPdfSuelos,
  subirPdfSuelos,
} from '../../services/analisisSuelos.service';
import { generarYAbrirInformeSuelos } from '../../services/analisisSuelosPdf.service';

const ACTIVIDAD_ID = 'analisis_suelos';

const mensajeError = (e: any, porDefecto: string) =>
  e?.response?.data?.mensaje || (e?.message?.includes('Network') ? 'Sin conexión. Verifica tu internet.' : porDefecto);

const AnalisisSuelosScreen: React.FC<any> = ({ navigation, route }) => {
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const modo: 'ejecutar' | 'revisar' = route?.params?.modo === 'revisar' ? 'revisar' : 'ejecutar';
  const tecnico: { usuario: string; nombre: string } | undefined = route?.params?.tecnico;
  const vistaTecnicos = modo === 'revisar' && !tecnico;
  const puedeEscribir = modo === 'ejecutar';
  const esAdmin = user?.rol === 'admin';

  const [beneficiarios, setBeneficiarios] = useState<BeneficiarioSuelos[]>([]);
  const [resumen, setResumen] = useState<ResumenSuelos | null>(null);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [ocupado, setOcupado] = useState<number | null>(null);
  const [abriendoVisita, setAbriendoVisita] = useState<number | null>(null);
  const [generando, setGenerando] = useState(false);
  const [visor, setVisor] = useState<{ uri: string; titulo: string; key: string } | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: tecnico ? tecnico.nombre : modo === 'revisar' ? 'Revisar Análisis de Suelos' : 'Análisis de Suelos',
    });
  }, [navigation, tecnico, modo]);

  const cargar = useCallback(async (esRefresh = false) => {
    try {
      if (esRefresh) setRefrescando(true);
      if (vistaTecnicos) setResumen(await obtenerResumenSuelos());
      else if (tecnico) setBeneficiarios(await listarBeneficiariosSuelosDeTecnico(tecnico.usuario));
      else setBeneficiarios(await listarMisBeneficiariosSuelos());
    } catch (e) {
      avisar('No se pudo cargar', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }, [vistaTecnicos, tecnico]);

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
    await generarYAbrirInformeSuelos({
      // El técnico no manda nada: el servidor usa su propia identidad.
      tecnico: modo === 'ejecutar' ? undefined : tecnico?.usuario,
      rolUsuario: user?.rol || '',
      nombreUsuario: user?.nombre || '',
    });
    setGenerando(false);
  };

  const subidos = useMemo(() => beneficiarios.filter((b) => b.tieneArchivo).length, [beneficiarios]);

  const botonInforme = (texto: string) => (
    <TouchableOpacity style={styles.btnInforme} onPress={generarInforme} disabled={generando} activeOpacity={0.8}>
      {generando ? (
        <><ActivityIndicator size="small" color="#fff" /><Text style={styles.btnInformeTxt}>  Analizando con IA…</Text></>
      ) : (
        <Text style={styles.btnInformeTxt}>📄 {texto}</Text>
      )}
    </TouchableOpacity>
  );

  // ─── Vista superior: tortas + técnicos ─────────────────────
  if (vistaTecnicos) {
    const tecnicos = resumen?.tecnicos ?? [];
    const meta = resumen?.meta ?? 300;
    const total = resumen?.total ?? 0;
    const porTecnico = tecnicos.map((t, i) => ({ etiqueta: t.nombre, valor: t.subidos, color: PALETA_TECNICOS[i % PALETA_TECNICOS.length] }));
    return (
      <View style={styles.container}>
        {cargando ? (
          <ActivityIndicator style={{ marginTop: SPACING.xl }} size="large" color={COLORS.primary} />
        ) : (
          <FlatList
            data={tecnicos}
            keyExtractor={(t) => t.usuario}
            contentContainerStyle={[styles.lista, { paddingBottom: insets.bottom + SPACING.xl }]}
            refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => cargar(true)} colors={[COLORS.primary]} />}
            ListHeaderComponent={
              <View>
                <TortaResumen titulo={`Análisis por técnico (máximo ${meta})`} datos={porTecnico} />
                <TortaResumen
                  titulo={`Realizados vs. faltantes (meta ${meta})`}
                  datos={[
                    { etiqueta: 'Realizados', valor: total, color: COLOR_HECHO },
                    { etiqueta: 'Faltan', valor: Math.max(meta - total, 0), color: COLOR_FALTA },
                  ]}
                />
                {botonInforme('PDF de análisis de técnicos')}
                <Text style={styles.seccion}>Técnicos</Text>
              </View>
            }
            ListEmptyComponent={<Text style={styles.vacio}>No hay técnicos activos.</Text>}
            renderItem={({ item: t, index }) => (
              <TouchableOpacity
                style={[styles.card, { borderLeftColor: PALETA_TECNICOS[index % PALETA_TECNICOS.length] }]}
                activeOpacity={0.7}
                onPress={() => navigation.push('ActividadDetalle', { actividadId: ACTIVIDAD_ID, modo: 'revisar', tecnico: { usuario: t.usuario, nombre: t.nombre } })}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.nombre}>{t.nombre}</Text>
                  <Text style={styles.dato}>{t.subidos} de {t.asignados} análisis subidos</Text>
                </View>
                <Text style={styles.flecha}>›</Text>
              </TouchableOpacity>
            )}
          />
        )}
      </View>
    );
  }

  // ─── Vista de beneficiarios (técnico, o superior dentro de un técnico) ──
  return (
    <View style={styles.container}>
      {cargando ? (
        <ActivityIndicator style={{ marginTop: SPACING.xl }} size="large" color={COLORS.primary} />
      ) : (
        <FlatList
          data={beneficiarios}
          keyExtractor={(b) => String(b.item)}
          contentContainerStyle={[styles.lista, { paddingBottom: insets.bottom + SPACING.xl }]}
          refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => cargar(true)} colors={[COLORS.primary]} />}
          ListHeaderComponent={
            <View>
              {botonInforme(modo === 'ejecutar' ? 'Informe con IA de mis beneficiarios' : 'PDF de análisis de sus beneficiarios')}
              <Text style={styles.seccion}>Beneficiarios · {subidos}/{beneficiarios.length} con análisis</Text>
            </View>
          }
          ListEmptyComponent={<Text style={styles.vacio}>No hay beneficiarios asignados.</Text>}
          renderItem={({ item: b }) => {
            const trabajando = ocupado === b.item;
            return (
              <TouchableOpacity
                style={[styles.card, { borderLeftColor: b.tieneArchivo ? COLOR_HECHO : COLOR_FALTA }]}
                activeOpacity={puedeEscribir && b.formularioId ? 0.7 : 1}
                onPress={() => abrirVisita1(b)}
                disabled={!puedeEscribir || !b.formularioId}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.nombre}>{b.nombre}</Text>
                  <Text style={styles.dato}>C.C. {b.cedula}</Text>
                  <Text style={styles.dato}>{b.corregimiento} · {b.vereda}</Text>
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
              </TouchableOpacity>
            );
          }}
        />
      )}

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
  vacio: { textAlign: 'center', color: COLORS.textSecondary, padding: SPACING.md },
  btnInforme: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.md, paddingVertical: SPACING.md, marginBottom: SPACING.xs },
  btnInformeTxt: { color: '#fff', fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.md },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm, borderLeftWidth: 4, ...SHADOWS.sm },
  nombre: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  dato: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 1 },
  flecha: { fontSize: 24, color: COLORS.textLight, marginLeft: SPACING.sm },
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
