// ============================================================
// GEODAILY — Entregas de una actividad (Entrega 1, Entrega 2…)
// ============================================================
// Si aún no hay entregas se muestra "Entrega 1" (se crea al abrirla).
// "Agregar Entrega" crea la siguiente del consecutivo. Cada entrega guarda su
// información por separado.
// ============================================================

import React, { useCallback, useLayoutEffect, useState } from 'react';
import { ActivityIndicator, FlatList, RefreshControl, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useAuth } from '../../store/AuthContext';
import { SUBACTIVIDADES } from '../../data/actividades';
import { avisar } from '../../utils/dialogos';
import {
  crearEntrega,
  EntregaLocal,
  importarEntregasDelServidor,
  listarEntregasLocales,
} from '../../services/actividadesEntregas.service';
import { leerEstadoActaLocal, EstadoActaLocal } from '../../services/estadoActaLocal';
import { estadoActasServidor } from '../../services/otrosFormatos.service';
import { idOtroFormato } from '../../services/database';
import { combinarActa, presentacionActa, TonoActa } from '../../utils/estadoActa';

/** Borde de la tarjeta según el acta: verde completada, amarillo borrador/pendientes, gris sin diligenciar. */
const COLOR_TONO: Record<TonoActa, string> = {
  gris: COLORS.textLight,
  amarillo: COLORS.warning,
  verde: COLORS.success,
};
const TEXTO_TONO: Record<TonoActa, string> = { ...COLOR_TONO, gris: COLORS.textSecondary };

/** Estado del acta de cada entrega (por id), leído del teléfono. */
const leerActas = async (lista: EntregaLocal[]): Promise<Record<string, EstadoActaLocal>> => {
  const pares = await Promise.all(
    lista.map(async (e) => [e.id, await leerEstadoActaLocal(e.datos.beneficiario?.cedula, e.datos.actaInstancia)] as const)
  );
  return Object.fromEntries(pares);
};

/** Id del acta de una entrega (null si aún no tiene beneficiario). */
const idActa = (e: EntregaLocal): string | null =>
  e.datos.beneficiario?.cedula ? idOtroFormato('acta_entrega_individual', e.datos.beneficiario.cedula, e.datos.actaInstancia) : null;

/**
 * Completa lo del teléfono con lo del servidor (una sola consulta para toda la
 * lista): actas hechas en otro dispositivo y la firma del interventor. Sin
 * señal devuelve lo del teléfono tal cual.
 */
const completarConServidor = async (
  lista: EntregaLocal[],
  locales: Record<string, EstadoActaLocal>
): Promise<Record<string, EstadoActaLocal>> => {
  const ids = lista.map(idActa).filter((x): x is string => !!x);
  if (!ids.length) return locales;
  try {
    const srv = await estadoActasServidor(ids);
    const out: Record<string, EstadoActaLocal> = { ...locales };
    for (const e of lista) {
      const id = idActa(e);
      if (!id) continue;
      out[e.id] = combinarActa(locales[e.id] ?? { estado: 'sin_diligenciar', faltantes: [], firmaInterventoria: false }, srv[id]);
    }
    return out;
  } catch {
    return locales;
  }
};

const EntregasActividadScreen: React.FC<any> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const actividadId: string = route?.params?.actividadId;
  const sub = (SUBACTIVIDADES[actividadId] ?? []).find((s) => s.id === route?.params?.subactividadId);
  const [entregas, setEntregas] = useState<EntregaLocal[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [creando, setCreando] = useState(false);
  const [actas, setActas] = useState<Record<string, EstadoActaLocal>>({});

  useLayoutEffect(() => {
    navigation.setOptions({ title: sub?.nombre ?? 'Entregas' });
  }, [navigation, sub?.nombre]);

  const cargar = useCallback(async (esRefresh = false) => {
    if (!user?.id) return;
    if (esRefresh) setRefrescando(true);
    const locales = await listarEntregasLocales(actividadId, user.id);
    setEntregas(locales);
    setCargando(false);
    let lista = locales;
    let actasTel = await leerActas(lista);
    setActas(actasTel);
    // Con red: trae las hechas en otro teléfono y vuelve a listar.
    if (await importarEntregasDelServidor(actividadId, user.id)) {
      lista = await listarEntregasLocales(actividadId, user.id);
      setEntregas(lista);
      actasTel = await leerActas(lista);
      setActas(actasTel);
    }
    setRefrescando(false);
    // Con red: estado del acta en el servidor (otro dispositivo, firma del interventor).
    setActas(await completarConServidor(lista, actasTel));
  }, [actividadId, user?.id]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const abrir = (e: EntregaLocal) => navigation.navigate('EntregaDetalle', { actividadId, entregaId: e.id });

  const agregar = async () => {
    if (!user?.id || creando) return;
    setCreando(true);
    try {
      const nueva = await crearEntrega(actividadId, user.id);
      if (!nueva) return avisar('No se pudo crear', 'Revisa el espacio del dispositivo e inténtalo de nuevo.');
      abrir(nueva);
    } finally {
      setCreando(false);
    }
  };

  const resumen = (e: EntregaLocal) =>
    [e.datos.lugar?.trim() || 'Lugar sin registrar', e.datos.beneficiario?.nombre].filter(Boolean).join(' · ');

  if (cargando) return <View style={styles.container}><ActivityIndicator style={{ marginTop: SPACING.xl }} size="large" color={COLORS.primary} /></View>;

  return (
    <View style={styles.container}>
      <FlatList
        data={entregas}
        keyExtractor={(e) => e.id}
        contentContainerStyle={[styles.lista, { paddingBottom: insets.bottom + SPACING.xl }]}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => cargar(true)} colors={[COLORS.primary]} />}
        ListEmptyComponent={
          // Sin entregas todavía: "Entrega 1" se crea al tocarla.
          <TouchableOpacity style={styles.card} activeOpacity={0.7} onPress={agregar} disabled={creando}>
            <Text style={styles.icon}>📦</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.titulo}>Entrega 1</Text>
              <Text style={styles.dato}>Sin diligenciar</Text>
            </View>
            {creando ? <ActivityIndicator color={COLORS.primary} /> : <Text style={styles.arrow}>›</Text>}
          </TouchableOpacity>
        }
        renderItem={({ item: e }) => {
          const ea = actas[e.id];
          const acta = presentacionActa(ea?.estado ?? 'sin_diligenciar', ea?.faltantes, ea?.firmaInterventoria);
          return (
          <TouchableOpacity style={[styles.card, { borderLeftColor: COLOR_TONO[acta.tono] }]} activeOpacity={0.7} onPress={() => abrir(e)}>
            <Text style={styles.icon}>📦</Text>
            <View style={{ flex: 1 }}>
              <Text style={styles.titulo}>Entrega {e.numero}</Text>
              <Text style={styles.dato} numberOfLines={1}>{resumen(e)}</Text>
              <Text style={styles.dato}>📷 {e.datos.fotos.length} foto(s)</Text>
              <Text style={[styles.estado, { color: TEXTO_TONO[acta.tonoTxt] }]} numberOfLines={2}>
                {acta.txt}
              </Text>
              {acta.interventor && (
                <Text style={[styles.estado, { color: TEXTO_TONO[acta.interventor.tono] }]}>{acta.interventor.txt}</Text>
              )}
              {/* Estado de la entrega (fotos y lugar), no del acta. */}
              <Text style={[styles.subEntrega, !e.sincronizado && { color: COLORS.warning }]}>
                {e.sincronizado ? '☁️ Entrega subida al servidor' : '📱 Entrega pendiente de subir · se subirá con señal'}
              </Text>
            </View>
            <Text style={styles.arrow}>›</Text>
          </TouchableOpacity>
          );
        }}
        ListFooterComponent={
          entregas.length > 0 ? (
            <TouchableOpacity style={[styles.btnAgregar, creando && { opacity: 0.6 }]} onPress={agregar} disabled={creando}>
              {creando ? <ActivityIndicator color="#fff" /> : <Text style={styles.btnAgregarTxt}>＋ Agregar Entrega</Text>}
            </TouchableOpacity>
          ) : null
        }
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  lista: { padding: SPACING.md },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm, borderLeftWidth: 4, borderLeftColor: COLORS.primary, ...SHADOWS.sm },
  icon: { fontSize: 26, marginRight: SPACING.md },
  titulo: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  dato: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 1 },
  estado: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold, marginTop: 3 },
  subEntrega: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 3 },
  arrow: { fontSize: 24, color: COLORS.textLight, marginLeft: SPACING.sm },
  btnAgregar: { backgroundColor: COLORS.primary, borderRadius: BORDER_RADIUS.lg, paddingVertical: SPACING.md, alignItems: 'center', marginTop: SPACING.sm },
  btnAgregarTxt: { color: '#fff', fontWeight: FONTS.weights.bold, fontSize: FONTS.sizes.md },
});

export default EntregasActividadScreen;
