// ============================================================
// GEODAILY — Beneficiarios de una subactividad con acta + fotos
// ============================================================
// Ej.: Siembra de Plátano → Trazado, Ahoyado y Encalado.
//   · técnico (modo 'ejecutar') → SUS beneficiarios.
//   · superior (modo 'revisar') → los de todos los técnicos; primero los que
//     ya tienen acta o fotos. Admin / interventor dan "OK" (referencia
//     "{subactividad}:{item}" en la actividad padre, como las entregas).
// Al tocar un beneficiario se abre el MISMO panel que Preparación del
// Terreno (ActividadBeneficiarioScreen) con la clave de la subactividad
// ('siembra_platano.trazado_ahoyado_encalado'): acta de entrega y fotos del
// antes / durante / después, cada subactividad en su propia carpeta.
// ============================================================

import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Platform, RefreshControl, StyleSheet, Text, TextInput, TouchableOpacity, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { claveEvidencia, revisionEvidencia, SUBACTIVIDADES } from '../../data/actividades';
import { avisar } from '../../utils/dialogos';
import { BotonOkInterventoria, ESTILO_CARD_REVISADA, EtiquetaRevisado } from '../../components/actividades/RevisionInterventoria';
import { useRevisionInterventoria } from '../../hooks/useRevisionInterventoria';
import { BeneficiarioEvidencia, listarBeneficiariosEvidencia } from '../../services/actividadesEvidencias.service';
import { actasPorActividadServidor } from '../../services/otrosFormatos.service';
import { actasCompletadasEnTelefonoPorCedula } from '../../services/estadoActaLocal';
import { ActaSegunTelefono, presentacionActa, resumirActas, TonoActa, unirActasBeneficiario } from '../../utils/estadoActa';

const COLOR_TONO_ACTA: Record<TonoActa, string> = {
  gris: COLORS.textSecondary,
  amarillo: COLORS.warning,
  verde: COLORS.success,
};

const mensajeError = (e: any, porDefecto: string) =>
  e?.response?.data?.mensaje || (e?.message?.includes('Network') ? 'Sin conexión. Verifica tu internet.' : porDefecto);

const normalizar = (t: string) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

const totalFotos = (b: BeneficiarioEvidencia) => b.fotos.antes + b.fotos.durante + b.fotos.despues;
const tieneAlgo = (b: BeneficiarioEvidencia) => b.actas > 0 || totalFotos(b) > 0;

const EvidenciaActividadScreen: React.FC<any> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const actividadId: string = route?.params?.actividadId;
  const subId: string | undefined = route?.params?.subactividadId;
  const modo: 'ejecutar' | 'revisar' = route?.params?.modo === 'revisar' ? 'revisar' : 'ejecutar';
  const revisar = modo === 'revisar';
  const sub = (SUBACTIVIDADES[actividadId] ?? []).find((s) => s.id === subId);
  const clave = claveEvidencia(actividadId, subId);
  // El OK vive en la actividad padre (ej. 'siembra_platano'), igual que las entregas.
  const revision = useRevisionInterventoria(actividadId, revisar);
  const refOk = (item: number) => revisionEvidencia(clave, item).referencia;

  const [beneficiarios, setBeneficiarios] = useState<BeneficiarioEvidencia[]>([]);
  const [maxPorMomento, setMaxPorMomento] = useState(3);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [filtro, setFiltro] = useState('');
  /** Actas de esta subactividad por cédula (teléfono del técnico + servidor). */
  const [actasPorCedula, setActasPorCedula] = useState<Record<string, ActaSegunTelefono[]>>({});

  /** Cómo va cada acta: primero lo del teléfono (técnico), luego lo del servidor. */
  const cargarActas = useCallback(async () => {
    const telefono = revisar ? {} : await actasCompletadasEnTelefonoPorCedula(clave);
    const unir = (servidor: Record<string, any[]>) => {
      const out: Record<string, ActaSegunTelefono[]> = {};
      for (const c of new Set([...Object.keys(servidor), ...Object.keys(telefono)])) {
        out[c] = unirActasBeneficiario(servidor[c], telefono[c]);
      }
      return out;
    };
    setActasPorCedula(unir({}));
    try {
      setActasPorCedula(unir(await actasPorActividadServidor(clave)));
    } catch {
      // Sin señal: queda lo del teléfono.
    }
  }, [clave, revisar]);

  useLayoutEffect(() => {
    navigation.setOptions({ title: sub?.nombre ?? 'Subactividad' });
  }, [navigation, sub?.nombre]);

  const cargar = useCallback(async (esRefresh = false) => {
    try {
      if (esRefresh) {
        setRefrescando(true);
        if (revisar) revision.recargar();
      }
      const r = await listarBeneficiariosEvidencia(clave);
      setMaxPorMomento(r.maxPorMomento);
      // Revisión: primero los que ya tienen acta o fotos (orden alfabético dentro de cada grupo).
      const lista = revisar ? [...r.beneficiarios].sort((a, b) => Number(tieneAlgo(b)) - Number(tieneAlgo(a))) : r.beneficiarios;
      setBeneficiarios(lista);
      void cargarActas();
    } catch (e) {
      avisar('No se pudo cargar', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clave, revisar, cargarActas]);

  // Recarga al volver del panel del beneficiario (fotos o acta nuevas).
  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const filtrados = useMemo(() => {
    const q = normalizar(filtro.trim());
    if (!q) return beneficiarios;
    const qDigitos = q.replace(/\D/g, '');
    return beneficiarios.filter((b) =>
      normalizar(b.nombre).includes(q) ||
      (revisar && normalizar(b.tecnico || '').includes(q)) ||
      (qDigitos.length > 0 && String(b.cedula || '').replace(/\D/g, '').includes(qDigitos)),
    );
  }, [beneficiarios, filtro, revisar]);

  const conRegistros = useMemo(() => beneficiarios.filter(tieneAlgo).length, [beneficiarios]);

  const abrir = (b: BeneficiarioEvidencia) => {
    navigation.navigate('ActividadBeneficiario', {
      actividadId: clave,
      modo,
      beneficiario: { item: b.item, nombre: b.nombre, cedula: b.cedula, corregimiento: b.corregimiento, vereda: b.vereda },
    });
  };

  if (cargando) {
    return (
      <View style={styles.container}>
        <ActivityIndicator style={{ marginTop: SPACING.xl }} size="large" color={COLORS.primary} />
      </View>
    );
  }

  const maxTotal = maxPorMomento * 3;

  return (
    <View style={styles.container}>
      <FlatList
        data={filtrados}
        keyExtractor={(b) => String(b.item)}
        contentContainerStyle={[styles.lista, { paddingBottom: insets.bottom + SPACING.xl }]}
        refreshControl={<RefreshControl refreshing={refrescando} onRefresh={() => cargar(true)} colors={[COLORS.primary]} />}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <Text style={styles.seccion}>
              {revisar ? 'Beneficiarios' : 'Mis beneficiarios'} · {beneficiarios.length} · con registros {conRegistros}
              {revisar ? ` · revisados ${beneficiarios.filter((b) => revision.estaRevisado(refOk(b.item))).length}` : ''}
            </Text>
            <TextInput
              style={styles.busqueda}
              value={filtro}
              onChangeText={setFiltro}
              placeholder={revisar ? '🔍 Buscar por nombre, cédula o técnico' : '🔍 Buscar por nombre o cédula'}
              placeholderTextColor={COLORS.textSecondary}
              autoCorrect={false}
              autoCapitalize="none"
              clearButtonMode="while-editing"
            />
          </View>
        }
        ListEmptyComponent={<Text style={styles.vacio}>{filtro ? 'Sin resultados.' : 'No hay beneficiarios asignados.'}</Text>}
        renderItem={({ item: b }) => {
          const nFotos = totalFotos(b);
          const algo = tieneAlgo(b);
          const completo = b.actas > 0 && nFotos >= maxTotal;
          const revisado = revisar && algo && revision.estaRevisado(refOk(b.item));
          const color = completo ? COLORS.success : algo ? COLORS.warning : COLORS.textLight;
          return (
            <TouchableOpacity
              style={[styles.card, { borderLeftColor: color }, revisado && ESTILO_CARD_REVISADA]}
              activeOpacity={0.7}
              onPress={() => abrir(b)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.nombre}>{b.nombre}</Text>
                <Text style={styles.dato}>C.C. {b.cedula}</Text>
                {(b.corregimiento || b.vereda) ? (
                  <Text style={styles.dato}>{[b.corregimiento, b.vereda].filter(Boolean).join(' · ')}</Text>
                ) : null}
                {revisar && b.tecnico ? <Text style={styles.dato}>Técnico: {b.tecnico}</Text> : null}
                <Text style={[styles.estado, { color: algo ? color : COLORS.textSecondary }]}>
                  Acta: {b.actas} · Fotos {b.fotos.antes}/{maxPorMomento} · {b.fotos.durante}/{maxPorMomento} · {b.fotos.despues}/{maxPorMomento}
                </Text>
                {(() => {
                  // Cómo va el acta (técnico e interventor), sin entrar.
                  const { acta: a, total } = resumirActas(actasPorCedula[b.cedula] ?? []);
                  if (a.estado === 'sin_diligenciar') return null;
                  const p = presentacionActa(a.estado, a.faltantes, a.firmaInterventoria);
                  return (
                    <>
                      <Text style={[styles.estado, { color: COLOR_TONO_ACTA[p.tonoTxt] }]} numberOfLines={2}>
                        {p.txt}{total > 1 ? ` · ${total} actas` : ''}
                      </Text>
                      {p.interventor && (
                        <Text style={[styles.estado, { color: COLOR_TONO_ACTA[p.interventor.tono] }]}>{p.interventor.txt}</Text>
                      )}
                    </>
                  );
                })()}
                {b.observacionesPendientes > 0 && (
                  <Text style={[styles.estado, { color: COLORS.error }]}>
                    ⚠ {b.observacionesPendientes} {b.observacionesPendientes === 1 ? 'observación pendiente' : 'observaciones pendientes'}
                  </Text>
                )}
                {revisar && algo && <EtiquetaRevisado revisado={revisado} pendiente />}
              </View>
              {revisar && revision.puedeRevisar && algo && (
                <BotonOkInterventoria
                  style={{ marginLeft: SPACING.sm }}
                  revisado={revisado}
                  ocupado={revision.ocupado === refOk(b.item)}
                  onPress={() => revision.alternar(refOk(b.item))}
                />
              )}
              <Text style={styles.flecha}>›</Text>
            </TouchableOpacity>
          );
        }}
      />
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  lista: { padding: SPACING.md },
  seccion: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary, marginTop: SPACING.xs, marginBottom: SPACING.sm },
  busqueda: { borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, backgroundColor: COLORS.surface, paddingHorizontal: SPACING.md, paddingVertical: Platform.OS === 'web' ? SPACING.sm : 6, fontSize: FONTS.sizes.sm, color: COLORS.textPrimary, marginBottom: SPACING.sm },
  vacio: { textAlign: 'center', color: COLORS.textSecondary, padding: SPACING.md },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm, borderLeftWidth: 4, ...SHADOWS.sm },
  nombre: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  dato: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 1 },
  estado: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold, marginTop: 3 },
  flecha: { fontSize: 24, color: COLORS.textLight, marginLeft: SPACING.sm },
});

export default EvidenciaActividadScreen;
