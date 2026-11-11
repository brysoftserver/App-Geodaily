// ============================================================
// GEODAILY — Detalle de una entrega (ej. Entrega 1 de Colinos de Plátano o de Plántulas Forestales)
// ============================================================
//   1. Lugar de Entrega (texto libre)
//   2. Acta de Entrega y Recepción — se elige el beneficiario y se diligencia
//      el Acta de Entrega y Recibo con su propia instancia (no se mezcla con
//      otras entregas ni actividades).
//   3. Fotos — cámara o almacenamiento (sin marca de agua).
// Cada cambio se guarda en el dispositivo y queda pendiente de subir.
// ============================================================

import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Image,
  Modal,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useAuth } from '../../store/AuthContext';
import { avisar, confirmar } from '../../utils/dialogos';
import { persistirEvidencia, eliminarArchivoLocal } from '../../services/mediaStorage.service';
import { getBeneficiariosByTecnico } from '../../services/beneficiariosDB.service';
import { cargarDatosOtroFormato } from '../../store/OtrosFormatosDraftStore';
import { getOtrosFormatosLocales, idOtroFormato } from '../../services/database';
import { BeneficiarioDB } from '../../types';
import { tituloActaEntregas } from '../../data/actividades';
import {
  BeneficiarioEntrega,
  EntregaLocal,
  FotoEntrega,
  fuenteFotoEntrega,
  guardarEntregaLocal,
  MAX_FOTOS_ENTREGA,
  obtenerEntregaLocal,
  sincronizarEntregasActividad,
} from '../../services/actividadesEntregas.service';

type EstadoActa = 'sin_diligenciar' | 'borrador' | 'completada';

const sinTildes = (t: string) => t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const Miniatura: React.FC<{ foto: FotoEntrega; onPress: () => void; onQuitar: () => void }> = ({ foto, onPress, onQuitar }) => {
  const [fuente, setFuente] = useState<{ uri: string; headers?: Record<string, string> } | null>(null);
  useEffect(() => {
    let vivo = true;
    if (foto.uri && !foto.perdido) setFuente({ uri: foto.uri });
    else if (foto.archivo_id) fuenteFotoEntrega(foto.archivo_id).then((f) => vivo && setFuente(f));
    return () => { vivo = false; };
  }, [foto.uri, foto.archivo_id, foto.perdido]);
  return (
    <View>
      <TouchableOpacity style={styles.mini} onPress={onPress} disabled={!fuente} activeOpacity={0.8}>
        {fuente ? <Image source={fuente} style={styles.miniImg} resizeMode="cover" /> : <Text style={styles.miniVacia}>{foto.perdido ? 'Sin archivo' : '…'}</Text>}
      </TouchableOpacity>
      <TouchableOpacity style={styles.miniQuitar} onPress={onQuitar} hitSlop={8}>
        <Text style={styles.miniQuitarTxt}>✕</Text>
      </TouchableOpacity>
    </View>
  );
};

const EntregaDetalleScreen: React.FC<any> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const actividadId: string = route?.params?.actividadId;
  const entregaId: string = route?.params?.entregaId;

  const [entrega, setEntrega] = useState<EntregaLocal | null>(null);
  const [cargando, setCargando] = useState(true);
  const [estadoActa, setEstadoActa] = useState<EstadoActa>('sin_diligenciar');
  const [selector, setSelector] = useState(false);
  const [beneficiarios, setBeneficiarios] = useState<BeneficiarioDB[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const [visor, setVisor] = useState<{ uri: string; headers?: Record<string, string> } | null>(null);
  const ref = useRef<EntregaLocal | null>(null);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  ref.current = entrega;

  const numero = entrega?.numero;
  useLayoutEffect(() => {
    navigation.setOptions({ title: numero ? `Entrega ${numero}` : 'Entrega' });
  }, [navigation, numero]);

  /** Estado del acta de esta entrega: completada (registrada) > borrador > sin diligenciar. */
  const revisarActa = useCallback(async (e: EntregaLocal) => {
    const b = e.datos.beneficiario;
    if (!b?.cedula) return setEstadoActa('sin_diligenciar');
    try {
      const id = idOtroFormato('acta_entrega_individual', b.cedula, e.datos.actaInstancia);
      if ((await getOtrosFormatosLocales(b.cedula)).some((f) => f.id === id)) return setEstadoActa('completada');
      const borrador = await cargarDatosOtroFormato('acta_entrega_individual', `${b.cedula}__${e.datos.actaInstancia}`);
      setEstadoActa(borrador ? 'borrador' : 'sin_diligenciar');
    } catch {
      setEstadoActa('sin_diligenciar');
    }
  }, []);

  // Se recarga al volver del acta.
  useFocusEffect(
    useCallback(() => {
      (async () => {
        const e = await obtenerEntregaLocal(entregaId);
        setEntrega(e);
        setCargando(false);
        if (e) await revisarActa(e);
      })();
    }, [entregaId, revisarActa])
  );

  const guardar = useCallback(async () => {
    if (temporizador.current) {
      clearTimeout(temporizador.current);
      temporizador.current = null;
    }
    if (ref.current) await guardarEntregaLocal(ref.current);
  }, []);

  // Al salir: guarda lo pendiente y, si hay red, intenta subir ya.
  useEffect(() => {
    return () => {
      void guardar().then(() => sincronizarEntregasActividad(15000));
    };
  }, [guardar]);

  const cambiar = useCallback((fn: (e: EntregaLocal) => EntregaLocal, inmediato = false) => {
    setEntrega((prev) => {
      if (!prev) return prev;
      const sig = { ...fn(prev), sincronizado: false };
      ref.current = sig;
      return sig;
    });
    if (temporizador.current) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => { void guardar(); }, inmediato ? 0 : 600);
  }, [guardar]);

  // ─── Beneficiario y acta ──────────────────────────────────
  const abrirSelector = async () => {
    setBusqueda('');
    setSelector(true);
    setBeneficiarios(await getBeneficiariosByTecnico(user?.id || ''));
  };

  const elegir = (b: BeneficiarioDB) => {
    const benef: BeneficiarioEntrega = {
      item: b.item,
      nombre: b.nombre_completo,
      cedula: b.cedula,
      vereda: b.vereda || '',
      corregimiento: b.corregimiento || '',
      departamento: b.departamento || '',
      municipio: b.municipio || '',
      telefono: b.telefono || '',
      predio: b.nombre_predio && b.nombre_predio !== '---' ? b.nombre_predio : '',
    };
    cambiar((e) => ({ ...e, datos: { ...e.datos, beneficiario: benef } }), true);
    setSelector(false);
  };

  const abrirActa = async () => {
    const e = ref.current;
    if (!e) return;
    const b = e.datos.beneficiario;
    if (!b) return abrirSelector();
    // Desde que se abre el acta el beneficiario queda fijo (el acta se guarda bajo su cédula).
    if (!e.datos.actaIniciada) {
      const sig = { ...e, sincronizado: false, datos: { ...e.datos, actaIniciada: true } };
      ref.current = sig;
      setEntrega(sig);
      await guardarEntregaLocal(sig);
    }
    navigation.navigate('ActaEntregaIndividual', {
      actividadId,
      instancia: e.datos.actaInstancia,
      beneficiario: {
        nombre: b.nombre,
        cedula: b.cedula,
        telefono: b.telefono || '',
        departamento: b.departamento || '',
        municipio: b.municipio || '',
        vereda: b.vereda || '',
        corregimiento: b.corregimiento || '',
        finca: b.predio || '',
      },
    });
  };

  // ─── Fotos (sin marca de agua) ────────────────────────────
  const agregarFoto = () => {
    const registrar = async (uri: string) => {
      const id = `foto-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const persistente = await persistirEvidencia(uri, `entrega-${id}`);
      cambiar((e) => ({ ...e, datos: { ...e.datos, fotos: [...e.datos.fotos, { id, uri: persistente }] } }), true);
    };
    const desdeCamara = async () => {
      const permiso = await ImagePicker.requestCameraPermissionsAsync();
      if (!permiso.granted) return avisar('Permiso requerido', 'Se necesita acceso a la cámara para tomar la foto.');
      const r = await ImagePicker.launchCameraAsync({ quality: 0.6 });
      if (!r.canceled && r.assets?.[0]?.uri) await registrar(r.assets[0].uri);
    };
    const desdeAlmacenamiento = async () => {
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 0.6 });
      if (!r.canceled && r.assets?.[0]?.uri) await registrar(r.assets[0].uri);
    };
    if (Platform.OS === 'web') return void desdeAlmacenamiento();
    Alert.alert('Agregar foto', 'Elige de dónde obtener la foto.', [
      { text: 'Cancelar', style: 'cancel' },
      { text: '📷 Cámara', onPress: () => { void desdeCamara(); } },
      { text: '🖼️ Almacenamiento', onPress: () => { void desdeAlmacenamiento(); } },
    ]);
  };

  const quitarFoto = async (f: FotoEntrega) => {
    if (!(await confirmar('Quitar foto', '¿Quitar esta foto de la entrega?', 'Quitar', true))) return;
    cambiar((e) => ({ ...e, datos: { ...e.datos, fotos: e.datos.fotos.filter((x) => x.id !== f.id) } }), true);
    if (f.uri && !f.archivo_id) void eliminarArchivoLocal(f.uri);
  };

  const verFoto = async (f: FotoEntrega) => {
    if (f.uri && !f.perdido) setVisor({ uri: f.uri });
    else if (f.archivo_id) setVisor(await fuenteFotoEntrega(f.archivo_id));
  };

  // ─── Render ───────────────────────────────────────────────
  if (cargando) return <View style={styles.centro}><ActivityIndicator size="large" color={COLORS.primary} /></View>;
  if (!entrega) return <View style={styles.centro}><Text style={styles.dato}>No se encontró esta entrega en el dispositivo.</Text></View>;

  const d = entrega.datos;
  const textoActa: Record<EstadoActa, { txt: string; color: string; boton: string }> = {
    sin_diligenciar: { txt: 'Sin diligenciar', color: COLORS.textSecondary, boton: '📝 Diligenciar acta' },
    borrador: { txt: '⏳ Borrador en este dispositivo', color: COLORS.warning, boton: '📝 Continuar acta' },
    completada: { txt: '✓ Acta completada', color: COLORS.success, boton: '✏️ Ver / editar acta' },
  };
  const filtrados = beneficiarios.filter((b) => sinTildes(`${b.nombre_completo} ${b.cedula} ${b.vereda}`).includes(sinTildes(busqueda.trim())));

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SPACING.xl }]} keyboardShouldPersistTaps="handled">
        {/* 1. Lugar */}
        <View style={styles.seccion}>
          <Text style={styles.seccionTitulo}>Lugar de Entrega</Text>
          <TextInput
            style={styles.input}
            value={d.lugar}
            onChangeText={(t) => cambiar((e) => ({ ...e, datos: { ...e.datos, lugar: t } }))}
            placeholder="Nombre del lugar de la entrega"
            placeholderTextColor={COLORS.textLight}
          />
        </View>

        {/* 2. Acta */}
        <View style={styles.seccion}>
          <Text style={styles.seccionTitulo}>{tituloActaEntregas(actividadId)}</Text>
          <Text style={styles.etiqueta}>Beneficiario</Text>
          {d.beneficiario ? (
            <View style={styles.benef}>
              <View style={{ flex: 1 }}>
                <Text style={styles.benefNombre}>{d.beneficiario.nombre}</Text>
                <Text style={styles.dato}>C.C. {d.beneficiario.cedula}{d.beneficiario.vereda ? ` · ${d.beneficiario.vereda}` : ''}</Text>
              </View>
              {!d.actaIniciada && (
                <TouchableOpacity onPress={abrirSelector}>
                  <Text style={styles.enlace}>Cambiar</Text>
                </TouchableOpacity>
              )}
            </View>
          ) : (
            <TouchableOpacity style={styles.btnSec} onPress={abrirSelector}>
              <Text style={styles.btnSecTxt}>👤 Elegir beneficiario</Text>
            </TouchableOpacity>
          )}
          {d.beneficiario && <Text style={[styles.estado, { color: textoActa[estadoActa].color }]}>{textoActa[estadoActa].txt}</Text>}
          <TouchableOpacity style={[styles.btnPrimario, !d.beneficiario && styles.deshabilitado]} onPress={abrirActa}>
            <Text style={styles.btnPrimarioTxt}>{d.beneficiario ? textoActa[estadoActa].boton : 'Elige el beneficiario para diligenciar el acta'}</Text>
          </TouchableOpacity>
        </View>

        {/* 3. Fotos */}
        <View style={styles.seccion}>
          <View style={styles.cabecera}>
            <Text style={styles.seccionTitulo}>Fotos</Text>
            <Text style={styles.dato}>{d.fotos.length}/{MAX_FOTOS_ENTREGA}</Text>
          </View>
          <View style={styles.fotos}>
            {d.fotos.map((f) => <Miniatura key={f.id} foto={f} onPress={() => verFoto(f)} onQuitar={() => quitarFoto(f)} />)}
            {d.fotos.length < MAX_FOTOS_ENTREGA && (
              <TouchableOpacity style={styles.fotoAgregar} onPress={agregarFoto}>
                <Text style={styles.fotoAgregarTxt}>📷{'\n'}Foto</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>

        <Text style={styles.aviso}>
          {entrega.sincronizado ? '☁️ Guardada en el servidor.' : '📴 Guardada en el dispositivo. Se sube sola cuando haya señal.'}
        </Text>
      </ScrollView>

      {/* Selector de beneficiario */}
      <Modal visible={selector} animationType="slide" onRequestClose={() => setSelector(false)}>
        <View style={[styles.container, { paddingTop: insets.top + SPACING.sm }]}>
          <View style={styles.selectorCabecera}>
            <Text style={styles.seccionTitulo}>Elegir beneficiario</Text>
            <TouchableOpacity onPress={() => setSelector(false)}><Text style={styles.enlace}>Cerrar</Text></TouchableOpacity>
          </View>
          <TextInput
            style={[styles.input, { marginHorizontal: SPACING.md }]}
            value={busqueda}
            onChangeText={setBusqueda}
            placeholder="Buscar por nombre, cédula o vereda"
            placeholderTextColor={COLORS.textLight}
          />
          <FlatList
            data={filtrados}
            keyExtractor={(b) => String(b.item)}
            contentContainerStyle={{ padding: SPACING.md, paddingBottom: insets.bottom + SPACING.xl }}
            ListEmptyComponent={
              <Text style={styles.vacio}>
                {beneficiarios.length ? 'Ningún beneficiario coincide.' : 'No hay beneficiarios asignados en este dispositivo. Sincroniza tus beneficiarios con señal.'}
              </Text>
            }
            renderItem={({ item: b }) => (
              <TouchableOpacity style={styles.benefFila} onPress={() => elegir(b)}>
                <Text style={styles.benefNombre}>{b.nombre_completo}</Text>
                <Text style={styles.dato}>C.C. {b.cedula} · {b.vereda}</Text>
              </TouchableOpacity>
            )}
          />
        </View>
      </Modal>

      <Modal visible={visor !== null} transparent animationType="fade" onRequestClose={() => setVisor(null)}>
        <View style={styles.visorFondo}>
          {visor && <Image source={visor} style={styles.visorImg} resizeMode="contain" />}
          <TouchableOpacity style={[styles.visorCerrar, { marginBottom: insets.bottom + SPACING.md }]} onPress={() => setVisor(null)}>
            <Text style={styles.visorCerrarTxt}>Cerrar</Text>
          </TouchableOpacity>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  centro: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: COLORS.background, padding: SPACING.lg },
  content: { padding: SPACING.md, gap: SPACING.md },
  seccion: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, borderLeftWidth: 4, borderLeftColor: COLORS.primary, ...SHADOWS.sm },
  seccionTitulo: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  cabecera: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  etiqueta: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.semibold, color: COLORS.textSecondary, marginBottom: 4 },
  input: { borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, paddingHorizontal: SPACING.sm, paddingVertical: SPACING.sm, color: COLORS.textPrimary, backgroundColor: COLORS.surface, fontSize: FONTS.sizes.sm },
  dato: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary },
  estado: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold, marginTop: SPACING.sm },
  benef: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.background, borderRadius: BORDER_RADIUS.md, padding: SPACING.sm },
  benefNombre: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  benefFila: { backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.md, padding: SPACING.md, marginBottom: SPACING.sm, ...SHADOWS.sm },
  enlace: { color: COLORS.primary, fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.sm, marginLeft: SPACING.sm },
  btnPrimario: { backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.md, paddingVertical: SPACING.sm + 2, alignItems: 'center', marginTop: SPACING.sm },
  btnPrimarioTxt: { color: '#fff', fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.sm },
  deshabilitado: { opacity: 0.5 },
  btnSec: { borderWidth: 1.5, borderColor: COLORS.primary, borderRadius: BORDER_RADIUS.md, paddingVertical: SPACING.sm, alignItems: 'center' },
  btnSecTxt: { color: COLORS.primary, fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.sm },
  fotos: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  mini: { width: 80, height: 80, borderRadius: BORDER_RADIUS.md, overflow: 'hidden', backgroundColor: COLORS.background, alignItems: 'center', justifyContent: 'center' },
  miniImg: { width: '100%', height: '100%' },
  miniVacia: { fontSize: FONTS.sizes.xs, color: COLORS.textLight, textAlign: 'center' },
  miniQuitar: { position: 'absolute', top: -6, right: -6, width: 22, height: 22, borderRadius: 11, backgroundColor: COLORS.error, alignItems: 'center', justifyContent: 'center' },
  miniQuitarTxt: { color: '#fff', fontSize: 12, fontWeight: FONTS.weights.bold },
  fotoAgregar: { width: 80, height: 80, borderRadius: BORDER_RADIUS.md, borderWidth: 1.5, borderStyle: 'dashed', borderColor: COLORS.primary, alignItems: 'center', justifyContent: 'center' },
  fotoAgregarTxt: { fontSize: FONTS.sizes.xs, color: COLORS.primary, textAlign: 'center', fontWeight: FONTS.weights.semibold },
  aviso: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, textAlign: 'center' },
  vacio: { textAlign: 'center', color: COLORS.textSecondary, padding: SPACING.lg },
  selectorCabecera: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: SPACING.md, marginBottom: SPACING.sm },
  visorFondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center' },
  visorImg: { flex: 1, width: '100%' },
  visorCerrar: { alignSelf: 'center', backgroundColor: 'rgba(255,255,255,0.2)', paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg, borderRadius: BORDER_RADIUS.md },
  visorCerrarTxt: { color: '#fff', fontWeight: FONTS.weights.semibold },
});

export default EntregaDetalleScreen;
