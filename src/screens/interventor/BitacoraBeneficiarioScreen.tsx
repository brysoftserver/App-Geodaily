// ============================================================
// GEODAILY — Bitácora del Beneficiario: ficha completa
// ============================================================
// Datos personales, predio, ubicación, visitas realizadas (cada una abre el
// formulario de esa visita) y actividades (análisis de suelos, preparación del
// terreno…; cada una abre su detalle). Solo lectura.
// ============================================================

import React, { useCallback, useLayoutEffect, useState } from 'react';
import {
  ActivityIndicator,
  Modal,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Sharing from 'expo-sharing';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { ACTIVIDADES_EN_HECTAREAS, buscarActividad, descomponerClaveEvidencia } from '../../data/actividades';
import { avisar } from '../../utils/dialogos';
import { abrirMapaEnGoogle } from '../../utils/abrirMapa';
import { useAuth } from '../../store/AuthContext';
import { abrirDetalleFormulario } from '../../utils/abrirDetalleFormulario';
import PdfViewer from '../../components/PdfViewer';
import { descargarPdfSuelos } from '../../services/analisisSuelos.service';
import { generarYAbrirInformeBeneficiario } from '../../services/bitacoraPdf.service';
import { formatearHectareas } from '../../services/actividadesHectareas.service';
import {
  BitacoraFicha,
  BitacoraVisita,
  Coordenada,
  etiquetaVisitaBitacora,
  obtenerFichaBitacora,
} from '../../services/bitacora.service';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';

const mensajeError = (e: any, porDefecto: string) =>
  e?.response?.data?.mensaje || (e?.message?.includes('Network') ? 'Sin conexión. Verifica tu internet.' : porDefecto);

const fecha = (iso?: string | null) =>
  iso ? new Date(iso).toLocaleDateString('es-CO', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const CALIDAD: Record<string, string> = { propietario: 'Propietario', poseedor: 'Poseedor', otro: 'Otro' };

const BitacoraBeneficiarioScreen: React.FC<any> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const item: number = route?.params?.item;
  const nombreParam: string = route?.params?.nombre ?? 'Beneficiario';

  const [ficha, setFicha] = useState<BitacoraFicha | null>(null);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [abriendoVisita, setAbriendoVisita] = useState<string | null>(null);
  const [abriendoPdf, setAbriendoPdf] = useState(false);
  const [visor, setVisor] = useState<{ uri: string; titulo: string; key: string } | null>(null);

  const [generando, setGenerando] = useState(false);

  // Botón del encabezado: PDF de este beneficiario (membrete de interventoría).
  const generarInforme = useCallback(async () => {
    if (generando || !ficha) return;
    setGenerando(true);
    try {
      await generarYAbrirInformeBeneficiario(ficha, user?.nombre || '', user?.rol);
    } finally {
      setGenerando(false);
    }
  }, [generando, ficha, user?.nombre]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: 'Bitácora',
      headerRight: ficha
        ? () => (
            <TouchableOpacity style={[styles.btnHeader, generando && { opacity: 0.6 }]} onPress={generarInforme} disabled={generando} activeOpacity={0.8}>
              {generando ? <ActivityIndicator size="small" color="#fff" /> : <Text style={styles.btnHeaderTxt} numberOfLines={2}>Generar Informe PDF</Text>}
            </TouchableOpacity>
          )
        : undefined,
    });
  }, [navigation, ficha, generando, generarInforme]);

  const cargar = useCallback(async (esRefresh = false, silencioso = false) => {
    try {
      if (esRefresh) setRefrescando(true);
      setFicha(await obtenerFichaBitacora(item));
    } catch (e) {
      if (!silencioso) avisar('No se pudo cargar', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }, [item]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  // Recarga automática silenciosa (volver a la app/pestaña, red recuperada, periódica).
  useAutoRefresh(() => cargar(false, true));

  const abrirVisita = async (v: BitacoraVisita) => {
    if (abriendoVisita) return;
    setAbriendoVisita(v.id);
    try {
      await abrirDetalleFormulario(navigation, user?.rol, v.id);
    } finally {
      setAbriendoVisita(null);
    }
  };

  const verPdfSuelos = async () => {
    if (abriendoPdf || !ficha) return;
    // En web la pestaña se abre ANTES del await para que no la bloquee el navegador.
    const ventana = Platform.OS === 'web' ? window.open('', '_blank') : null;
    setAbriendoPdf(true);
    try {
      const uri = await descargarPdfSuelos(item);
      if (Platform.OS === 'web') {
        if (ventana) ventana.location.href = uri;
        else window.location.href = uri;
        return;
      }
      setVisor({ uri, titulo: `Análisis de suelos — ${ficha.beneficiario.nombre}`, key: `suelos_${item}_${Date.now()}` });
    } catch (e) {
      ventana?.close();
      avisar('No se pudo abrir el PDF', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setAbriendoPdf(false);
    }
  };

  const abrirActividad = (actividadId: string) => {
    if (!ficha) return;
    const b = ficha.beneficiario;
    navigation.navigate('ActividadBeneficiario', {
      actividadId,
      modo: 'revisar',
      beneficiario: { item: b.item, nombre: b.nombre, cedula: b.cedula, corregimiento: b.corregimiento, vereda: b.vereda },
    });
  };

  /** Abre la coordenada en Google Maps sin ofrecer apps externas en web. */
  const abrirMapa = (c: Coordenada) => {
    abrirMapaEnGoogle(c.latitud, c.longitud).then((abierto) => {
      if (!abierto) {
        avisar('No se pudo abrir el mapa', 'La ubicación no tiene coordenadas válidas.');
      }
    });
  };

  const fila = (etiqueta: string, valor?: string | number | null) => (
    <View style={styles.fila}>
      <Text style={styles.etiqueta}>{etiqueta}</Text>
      <Text style={[styles.valor, (valor === null || valor === undefined || valor === '') && styles.sinDato]}>
        {valor === null || valor === undefined || valor === '' ? 'Sin registrar' : String(valor)}
      </Text>
    </View>
  );

  const seccion = (titulo: string, hijos: React.ReactNode) => (
    <View style={styles.seccion}>
      <Text style={styles.seccionTitulo}>{titulo}</Text>
      {hijos}
    </View>
  );

  const coordenada = (titulo: string, c: Coordenada | null, extra?: string) => (
    <View style={styles.coordBloque}>
      <Text style={styles.etiqueta}>{titulo}</Text>
      {c ? (
        <>
          <Text style={styles.valor}>{c.latitud.toFixed(6)}, {c.longitud.toFixed(6)}{extra ? `  ${extra}` : ''}</Text>
          <TouchableOpacity onPress={() => abrirMapa(c)}>
            <Text style={styles.enlace}>🗺️ Ver en el mapa</Text>
          </TouchableOpacity>
        </>
      ) : (
        <Text style={[styles.valor, styles.sinDato]}>Sin registrar</Text>
      )}
    </View>
  );

  if (cargando) {
    return (
      <View style={styles.container}>
        <ActivityIndicator style={{ marginTop: SPACING.xl }} size="large" color={COLORS.primary} />
      </View>
    );
  }
  if (!ficha) {
    return (
      <View style={styles.container}>
        <Text style={styles.vacio}>No se pudo cargar la ficha de {nombreParam}.</Text>
      </View>
    );
  }

  const { beneficiario: b, predio, ubicacion, visitas, actividades } = ficha;
  const detalleActividades = ficha.detalleActividades !== false;
  // Se listan las actividades en hectáreas ya conectadas, y cualquiera que ya tenga registros.
  const enHectareas = actividades.enHectareas.filter(
    (a) => ACTIVIDADES_EN_HECTAREAS.includes(a.id) || a.hectareas > 0 || a.actas > 0 || a.fotos.antes + a.fotos.durante + a.fotos.despues > 0
  );

  return (
    <View style={styles.container}>
      <ScrollView
        contentContainerStyle={[styles.contenido, { paddingBottom: insets.bottom + SPACING.xl }]}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => cargar(true)} colors={[COLORS.primary]} />}
      >
        <Text style={styles.nombre}>{b.nombre}</Text>

        {seccion('👤 Datos personales', (
          <>
            {fila('Cédula', b.cedula)}
            {fila('Teléfono', b.telefono)}
            {fila('Correo', b.correo)}
            {fila('Técnico asignado', b.tecnico)}
          </>
        ))}

        {seccion('🏡 Datos del predio', (
          <>
            {fila('Predio', predio.nombre)}
            {fila('Área', predio.area != null ? `${formatearHectareas(predio.area)} ha` : null)}
            {fila('Calidad', predio.calidad ? CALIDAD[predio.calidad] ?? predio.calidad : null)}
            {fila('Vereda', b.vereda)}
            {fila('Corregimiento', b.corregimiento)}
            {fila('Municipio', [b.municipio, b.departamento].filter(Boolean).join(', ') || null)}
          </>
        ))}

        {seccion('📍 Ubicación', (
          <>
            {coordenada('Coordenadas del predio', ubicacion.registrada)}
            {coordenada(
              'GPS tomado en la Visita 1',
              ubicacion.gpsVisita1,
              ubicacion.gpsVisita1?.precision != null ? `(±${ubicacion.gpsVisita1.precision} m)` : undefined
            )}
          </>
        ))}

        {seccion(`📋 Visitas realizadas (${visitas.length})`, (
          visitas.length === 0 ? (
            <Text style={styles.vacio}>Aún no se han realizado visitas a este beneficiario.</Text>
          ) : (
            <>
            {visitas.map((v) => (
              <TouchableOpacity
                key={v.id}
                style={styles.item}
                activeOpacity={v.abrible === false ? 1 : 0.7}
                onPress={() => abrirVisita(v)}
                disabled={v.abrible === false}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.itemTitulo}>{etiquetaVisitaBitacora(v)}</Text>
                  <Text style={styles.dato}>{fecha(v.fecha)}{v.tecnico ? ` · ${v.tecnico}` : ''}</Text>
                </View>
                {abriendoVisita === v.id ? <ActivityIndicator color={COLORS.primary} /> : v.abrible === false ? null : <Text style={styles.flecha}>›</Text>}
              </TouchableOpacity>
            ))}
            {visitas.some((v) => v.abrible === false) && (
              <Text style={styles.vacio}>Solo puedes abrir las visitas que realizaste tú.</Text>
            )}
            </>
          )
        ))}

        {seccion('🧰 Actividades', (
          <>
            <View style={styles.item}>
              <View style={{ flex: 1 }}>
                <Text style={styles.itemTitulo}>🧪 Análisis de Suelos Completos por Predio</Text>
                {actividades.analisisSuelos.subido ? (
                  <Text style={[styles.estado, { color: COLORS.success }]}>
                    ✓ PDF subido · {fecha(actividades.analisisSuelos.fecha)}
                  </Text>
                ) : (
                  <Text style={[styles.estado, { color: COLORS.warning }]}>Pendiente</Text>
                )}
              </View>
              {actividades.analisisSuelos.subido && detalleActividades && (
                <TouchableOpacity style={styles.btnVer} onPress={verPdfSuelos} disabled={abriendoPdf}>
                  {abriendoPdf ? <ActivityIndicator size="small" color={COLORS.primary} /> : <Text style={styles.btnVerTxt}>Ver PDF</Text>}
                </TouchableOpacity>
              )}
            </View>

            {enHectareas.map((a) => {
              const act = buscarActividad(a.id);
              const nFotos = a.fotos.antes + a.fotos.durante + a.fotos.despues;
              const iniciada = a.hectareas > 0 || a.actas > 0 || nFotos > 0;
              return (
                <TouchableOpacity
                  key={a.id}
                  style={styles.item}
                  activeOpacity={detalleActividades ? 0.7 : 1}
                  onPress={() => abrirActividad(a.id)}
                  disabled={!detalleActividades}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={styles.itemTitulo}>{act?.icon} {act?.nombre ?? a.id}</Text>
                    <Text style={[styles.estado, { color: iniciada ? COLORS.success : COLORS.warning }]}>
                      {/* Subactividad (acta + fotos): no se mide en hectáreas. */}
                      {!iniciada ? 'Pendiente' : descomponerClaveEvidencia(a.id).sub ? 'Con registros' : `${formatearHectareas(a.hectareas)} ha`}
                      {a.respaldadaPorVisita && a.hectareas === 0 ? ` · espera la Visita ${a.respaldadaPorVisita}` : ''}
                    </Text>
                    <Text style={styles.dato}>
                      Acta: {a.actas} · Fotos antes {a.fotos.antes}/3 · durante {a.fotos.durante}/3 · después {a.fotos.despues}/3
                    </Text>
                    {a.observacionesPendientes > 0 && (
                      <Text style={[styles.estado, { color: COLORS.error }]}>
                        ⚠ {a.observacionesPendientes} {a.observacionesPendientes === 1 ? 'observación pendiente' : 'observaciones pendientes'}
                      </Text>
                    )}
                  </View>
                  {detalleActividades && <Text style={styles.flecha}>›</Text>}
                </TouchableOpacity>
              );
            })}
            {!detalleActividades && (
              <Text style={styles.vacio}>El detalle de las actividades solo lo ve el técnico asignado y los roles de revisión.</Text>
            )}
          </>
        ))}
      </ScrollView>

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
  contenido: { padding: SPACING.md, gap: SPACING.md },
  nombre: { fontSize: FONTS.sizes.xl, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  seccion: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, borderLeftWidth: 4, borderLeftColor: COLORS.roleInterventor, ...SHADOWS.sm },
  seccionTitulo: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  fila: { flexDirection: 'row', paddingVertical: 3 },
  etiqueta: { width: 120, fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },
  valor: { flex: 1, fontSize: FONTS.sizes.sm, color: COLORS.textPrimary, fontWeight: FONTS.weights.medium },
  sinDato: { color: COLORS.textLight, fontWeight: FONTS.weights.regular, fontStyle: 'italic' },
  coordBloque: { marginBottom: SPACING.sm },
  enlace: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.semibold, color: COLORS.primary, marginTop: 2 },
  vacio: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, textAlign: 'center', padding: SPACING.sm },
  item: { flexDirection: 'row', alignItems: 'center', paddingVertical: SPACING.sm, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: COLORS.border },
  itemTitulo: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  dato: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 2 },
  estado: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold, marginTop: 2 },
  flecha: { fontSize: 24, color: COLORS.textLight, marginLeft: SPACING.sm },
  btnVer: { borderWidth: 1, borderColor: COLORS.primary, borderRadius: BORDER_RADIUS.md, paddingVertical: 6, paddingHorizontal: SPACING.md, marginLeft: SPACING.sm, minWidth: 78, alignItems: 'center' },
  btnHeader: { backgroundColor: COLORS.roleInterventor, borderRadius: BORDER_RADIUS.md, paddingVertical: 6, paddingHorizontal: SPACING.sm, maxWidth: 120, minWidth: 64, alignItems: 'center', justifyContent: 'center' },
  btnHeaderTxt: { color: '#fff', fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold, textAlign: 'center' },
  btnVerTxt: { color: COLORS.primary, fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.sm },
});

export default BitacoraBeneficiarioScreen;
