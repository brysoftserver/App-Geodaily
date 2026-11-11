// ============================================================
// GEODAILY — Revisión de una actividad con subactividades (roles superiores)
// ============================================================
// Ej.: Revisar Siembra de Plátano → Entrega de Colinos, Trazado…, etc.
//   · sin params.sub → lista de subactividades (las que aún no tienen
//     registros se muestran como "Pendiente").
//   · params.sub     → registros de esa subactividad de TODOS los técnicos.
//     Admin e interventor marcan cada uno con "OK" → "Revisado por
//     interventoría" (referencia = "{subactividad}:{id del registro}").
// Todo vive dentro de la ruta ActividadDetalle (existe en todos los roles).
// ============================================================

import React, { useCallback, useEffect, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Image,
  Modal,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { buscarActividad, SUBACTIVIDADES, verboActividad } from '../../data/actividades';
import { avisar } from '../../utils/dialogos';
import { BotonOkInterventoria, ESTILO_CARD_REVISADA, EtiquetaRevisado } from '../../components/actividades/RevisionInterventoria';
import { useRevisionInterventoria } from '../../hooks/useRevisionInterventoria';
import { EntregaServidor, FotoEntrega, fuenteFotoEntrega, listarEntregasServidor } from '../../services/actividadesEntregas.service';

type Fuente = { uri: string; headers?: Record<string, string> };

const mensajeError = (e: any, porDefecto: string) =>
  e?.response?.data?.mensaje || (e?.message?.includes('Network') ? 'Sin conexión. Verifica tu internet.' : porDefecto);

const fechaCorta = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

const RevisarSubactividadesScreen: React.FC<any> = ({ navigation, route }) => {
  const actividadId: string = route?.params?.actividadId;
  const subId: string | undefined = route?.params?.sub;
  const actividad = buscarActividad(actividadId);
  const subs = SUBACTIVIDADES[actividadId] ?? [];
  const sub = subs.find((s) => s.id === subId);

  useLayoutEffect(() => {
    navigation.setOptions({ title: sub ? sub.nombre : actividad ? `${verboActividad('revisar')} ${actividad.nombre}` : 'Actividad' });
  }, [navigation, actividad, sub]);

  if (sub?.pantalla === 'EntregasActividad') {
    return <EntregasRevision actividadId={actividadId} subId={sub.id} />;
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {subs.map((s) => (
        <TouchableOpacity
          key={s.id}
          style={[styles.card, !s.pantalla && styles.cardPendiente]}
          activeOpacity={0.7}
          onPress={() =>
            s.pantalla
              ? navigation.push('ActividadDetalle', { ...route.params, sub: s.id })
              : avisar('Pendiente', `"${s.nombre}" aún no tiene registros para revisar.`)
          }
        >
          <Text style={styles.icon}>{s.icon}</Text>
          <View style={{ flex: 1 }}>
            <Text style={styles.title}>{s.nombre}</Text>
            {!s.pantalla && <Text style={styles.pendiente}>Pendiente</Text>}
          </View>
          <Text style={styles.arrow}>›</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
};

// ─── Entregas de todos los técnicos ─────────────────────────

const Miniatura: React.FC<{ foto: FotoEntrega; onPress: (f: Fuente) => void }> = ({ foto, onPress }) => {
  const [fuente, setFuente] = useState<Fuente | null>(null);
  useEffect(() => {
    let vivo = true;
    if (foto.archivo_id) fuenteFotoEntrega(foto.archivo_id).then((f) => vivo && setFuente(f));
    return () => { vivo = false; };
  }, [foto.archivo_id]);
  return (
    <TouchableOpacity style={styles.mini} onPress={() => fuente && onPress(fuente)} disabled={!fuente} activeOpacity={0.8}>
      {fuente ? <Image source={fuente} style={styles.miniImg} resizeMode="cover" /> : <Text style={styles.miniVacia}>{foto.archivo_id ? '…' : 'Sin subir'}</Text>}
    </TouchableOpacity>
  );
};

const EntregasRevision: React.FC<{ actividadId: string; subId: string }> = ({ actividadId, subId }) => {
  const insets = useSafeAreaInsets();
  const revision = useRevisionInterventoria(actividadId);
  const [entregas, setEntregas] = useState<EntregaServidor[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [filtro, setFiltro] = useState('');
  const [abiertas, setAbiertas] = useState<Record<string, boolean>>({});
  const [visor, setVisor] = useState<Fuente | null>(null);

  const cargar = useCallback(async (esRefresh = false) => {
    try {
      if (esRefresh) {
        setRefrescando(true);
        revision.recargar();
      }
      setEntregas(await listarEntregasServidor(actividadId));
    } catch (e) {
      avisar('No se pudo cargar', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actividadId]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const ref = (e: EntregaServidor) => `${subId}:${e.id}`;

  const filtradas = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!q) return entregas;
    return entregas.filter((e) =>
      [e.datos.beneficiario?.nombre, e.datos.beneficiario?.cedula, e.tecnico_nombre, e.datos.lugar]
        .some((t) => String(t || '').toLowerCase().includes(q))
    );
  }, [entregas, filtro]);

  const revisadas = entregas.filter((e) => revision.estaRevisado(ref(e))).length;

  if (cargando) {
    return <View style={styles.container}><ActivityIndicator style={{ marginTop: SPACING.xl }} size="large" color={COLORS.primary} /></View>;
  }

  return (
    <View style={styles.container}>
      <FlatList
        data={filtradas}
        keyExtractor={(e) => e.id}
        contentContainerStyle={[styles.lista, { paddingBottom: insets.bottom + SPACING.xl }]}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => cargar(true)} colors={[COLORS.primary]} />}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <Text style={styles.subtitulo}>{entregas.length} entregas · revisadas {revisadas}</Text>
            <TextInput
              style={styles.buscador}
              value={filtro}
              onChangeText={setFiltro}
              placeholder="Buscar por beneficiario, cédula, técnico o lugar"
              placeholderTextColor={COLORS.textLight}
            />
          </View>
        }
        ListEmptyComponent={<Text style={styles.vacio}>{filtro ? 'Sin resultados.' : 'Aún no hay entregas subidas por los técnicos.'}</Text>}
        renderItem={({ item: e }) => {
          const revisado = revision.estaRevisado(ref(e));
          const b = e.datos.beneficiario;
          const fotos = e.datos.fotos ?? [];
          const abierta = !!abiertas[e.id];
          return (
            <View style={[styles.card, styles.cardEntrega, revisado && ESTILO_CARD_REVISADA]}>
              <View style={styles.filaEntrega}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.etiqueta}>Entrega {e.numero}{e.tecnico_nombre ? ` · ${e.tecnico_nombre}` : ''}</Text>
                  <Text style={styles.nombre}>{b?.nombre || 'Beneficiario sin registrar'}</Text>
                  {b?.cedula ? <Text style={styles.dato}>C.C. {b.cedula}</Text> : null}
                  <Text style={styles.dato}>{e.datos.lugar?.trim() || 'Lugar sin registrar'}</Text>
                  <Text style={styles.dato}>{fechaCorta(e.created_at)}</Text>
                  <EtiquetaRevisado revisado={revisado} pendiente />
                </View>
                <View style={styles.acciones}>
                  <TouchableOpacity
                    style={[styles.btnSec, fotos.length === 0 && { opacity: 0.5 }]}
                    onPress={() => setAbiertas((a) => ({ ...a, [e.id]: !abierta }))}
                    disabled={fotos.length === 0}
                  >
                    <Text style={styles.btnSecTxt}>{fotos.length === 0 ? 'Sin fotos' : abierta ? 'Ocultar' : `Ver (${fotos.length})`}</Text>
                  </TouchableOpacity>
                </View>
                {revision.puedeRevisar && (
                  <BotonOkInterventoria
                    style={{ marginLeft: SPACING.sm }}
                    revisado={revisado}
                    ocupado={revision.ocupado === ref(e)}
                    onPress={() => revision.alternar(ref(e))}
                  />
                )}
              </View>
              {abierta && (
                <View style={styles.grilla}>
                  {fotos.map((f) => <Miniatura key={f.id} foto={f} onPress={setVisor} />)}
                </View>
              )}
            </View>
          );
        }}
      />

      <Modal visible={visor !== null} animationType="fade" transparent onRequestClose={() => setVisor(null)}>
        {visor && (
          <View style={styles.visorFondo}>
            <Image source={visor} style={styles.visorImg} resizeMode="contain" />
            <View style={[styles.visorBarra, { paddingBottom: insets.bottom + SPACING.md }]}>
              <TouchableOpacity style={styles.visorBtn} onPress={() => setVisor(null)}>
                <Text style={styles.visorBtnTxt}>Cerrar</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Modal>
    </View>
  );
};

const TAM_MINI = 88;

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  content: { padding: SPACING.md, gap: SPACING.sm },
  lista: { padding: SPACING.md },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, borderLeftWidth: 4, borderLeftColor: COLORS.primary, ...SHADOWS.sm },
  cardEntrega: { flexDirection: 'column', alignItems: 'stretch', marginBottom: SPACING.sm },
  cardPendiente: { opacity: 0.6 },
  filaEntrega: { flexDirection: 'row', alignItems: 'center' },
  icon: { fontSize: 28, marginRight: SPACING.md },
  title: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  pendiente: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold, color: COLORS.warning, marginTop: 2 },
  arrow: { fontSize: 24, color: COLORS.textLight, marginLeft: SPACING.sm },
  subtitulo: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginBottom: SPACING.sm },
  buscador: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, marginBottom: SPACING.md, color: COLORS.textPrimary },
  vacio: { textAlign: 'center', color: COLORS.textSecondary, padding: SPACING.md },
  etiqueta: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold, color: COLORS.primary, marginBottom: 2 },
  nombre: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  dato: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 1 },
  acciones: { marginLeft: SPACING.sm, minWidth: 80 },
  btnSec: { borderRadius: BORDER_RADIUS.md, paddingVertical: 6, paddingHorizontal: SPACING.sm, alignItems: 'center', borderWidth: 1, borderColor: COLORS.primary, backgroundColor: COLORS.surface },
  btnSecTxt: { color: COLORS.primary, fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.sm },
  grilla: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm, marginTop: SPACING.sm },
  mini: { width: TAM_MINI, height: TAM_MINI, borderRadius: BORDER_RADIUS.md, backgroundColor: COLORS.background, overflow: 'hidden', alignItems: 'center', justifyContent: 'center' },
  miniImg: { width: '100%', height: '100%' },
  miniVacia: { fontSize: FONTS.sizes.xs, color: COLORS.textLight },
  visorFondo: { flex: 1, backgroundColor: 'rgba(0,0,0,0.95)', justifyContent: 'center' },
  visorImg: { flex: 1, width: '100%' },
  visorBarra: { flexDirection: 'row', justifyContent: 'center', paddingTop: SPACING.md },
  visorBtn: { backgroundColor: 'rgba(255,255,255,0.2)', paddingVertical: SPACING.sm, paddingHorizontal: SPACING.lg, borderRadius: BORDER_RADIUS.md },
  visorBtnTxt: { color: '#fff', fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.md },
});

export default RevisarSubactividadesScreen;
