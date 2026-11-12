// ============================================================
// GEODAILY — Actividad medida en hectáreas (meta 750 ha)
// ============================================================
// Las hectáreas de cada beneficiario salen de su Visita Técnica ya completada
// (2,5 ha fijas por beneficiario; ver backend/src/routes/actividadesHectareas.js).
// Misma navegación que el análisis de suelos:
//   · técnico (modo 'ejecutar')  → 2 tortas del proyecto + SUS beneficiarios.
//   · superior (modo 'revisar')  → torta de realizadas vs. faltantes, buscador y
//     SOLO los beneficiarios con la Visita 2 completada (sin técnicos): primero
//     los que ya tienen el análisis de suelos, debajo los demás. Admin / interventor dan "OK".
// Al tocar un beneficiario se abre su panel de la actividad (acta de entrega y
// evidencia fotográfica antes / durante / después): ActividadBeneficiarioScreen.
// ============================================================

import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  TextInput,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { buscarActividad, verboActividad } from '../../data/actividades';
import { avisar } from '../../utils/dialogos';
import TortaResumen, { COLOR_FALTA, COLOR_HECHO, PALETA_TECNICOS } from '../../components/actividades/TortaResumen';
import { BotonOkInterventoria, ESTILO_CARD_REVISADA, EtiquetaRevisado } from '../../components/actividades/RevisionInterventoria';
import { useRevisionInterventoria } from '../../hooks/useRevisionInterventoria';
import {
  BeneficiarioHectareas,
  ResumenHectareas,
  formatearHectareas,
  listarMisBeneficiariosHectareas,
  listarTodosBeneficiariosHectareas,
  obtenerResumenHectareas,
} from '../../services/actividadesHectareas.service';
import { actasPorActividadServidor } from '../../services/otrosFormatos.service';
import { actasCompletadasEnTelefonoPorCedula } from '../../services/estadoActaLocal';
import { ActaSegunTelefono, presentacionActa, resumirActas, TonoActa, unirActasBeneficiario } from '../../utils/estadoActa';
import { useAutoRefresh } from '../../hooks/useAutoRefresh';

const COLOR_TONO_ACTA: Record<TonoActa, string> = {
  gris: COLORS.textSecondary,
  amarillo: COLORS.warning,
  verde: COLORS.success,
};

const mensajeError = (e: any, porDefecto: string) =>
  e?.response?.data?.mensaje || (e?.message?.includes('Network') ? 'Sin conexión. Verifica tu internet.' : porDefecto);

const HectareasActividadScreen: React.FC<any> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const actividadId: string = route?.params?.actividadId;
  const actividad = buscarActividad(actividadId);
  const modo: 'ejecutar' | 'revisar' = route?.params?.modo === 'revisar' ? 'revisar' : 'ejecutar';
  const revisar = modo === 'revisar';
  const nombreActividad = actividad?.nombre ?? 'Actividad';
  // OK de la interventoría por beneficiario (referencia = item).
  const revision = useRevisionInterventoria(actividadId);
  const [filtro, setFiltro] = useState('');

  const [resumen, setResumen] = useState<ResumenHectareas | null>(null);
  const [beneficiarios, setBeneficiarios] = useState<BeneficiarioHectareas[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  /** Actas de esta actividad por cédula (teléfono del técnico + servidor). */
  const [actasPorCedula, setActasPorCedula] = useState<Record<string, ActaSegunTelefono[]>>({});

  /** Estado de las actas: primero lo del teléfono (técnico), luego lo del servidor. */
  const cargarActas = useCallback(async () => {
    const telefono = revisar ? {} : await actasCompletadasEnTelefonoPorCedula(actividadId);
    const unir = (servidor: Record<string, any[]>) => {
      const out: Record<string, ActaSegunTelefono[]> = {};
      for (const c of new Set([...Object.keys(servidor), ...Object.keys(telefono)])) {
        out[c] = unirActasBeneficiario(servidor[c], telefono[c]);
      }
      return out;
    };
    setActasPorCedula(unir({}));
    try {
      setActasPorCedula(unir(await actasPorActividadServidor(actividadId)));
    } catch {
      // Sin señal (o servidor sin la consulta): queda lo del teléfono.
    }
  }, [actividadId, revisar]);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: `${verboActividad(modo)} ${nombreActividad}`,
    });
  }, [navigation, modo, nombreActividad]);

  const cargar = useCallback(async (esRefresh = false, silencioso = false) => {
    try {
      if (esRefresh) setRefrescando(true);
      const [r, lista] = await Promise.all([
        obtenerResumenHectareas(actividadId),
        revisar ? listarTodosBeneficiariosHectareas(actividadId) : listarMisBeneficiariosHectareas(actividadId),
      ]);
      setResumen(r);
      setBeneficiarios(lista);
      if (esRefresh) revision.recargar();
      void cargarActas();
    } catch (e) {
      if (!silencioso) avisar('No se pudo cargar', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [actividadId, revisar, cargarActas]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));
  // Recarga automática silenciosa (volver a la app/pestaña, red recuperada, periódica).
  useAutoRefresh(() => cargar(false, true));

  // Abre el panel del beneficiario en esta actividad (no navega a ninguna visita).
  const abrirBeneficiario = (b: BeneficiarioHectareas) => {
    navigation.navigate('ActividadBeneficiario', {
      actividadId,
      modo,
      beneficiario: { item: b.item, nombre: b.nombre, cedula: b.cedula, corregimiento: b.corregimiento, vereda: b.vereda },
    });
  };

  const totalTecnico = useMemo(() => beneficiarios.reduce((s, b) => s + b.hectareas, 0), [beneficiarios]);

  // Búsqueda rápida por nombre o cédula (sin tildes ni mayúsculas), igual que en Análisis de Suelos.
  const normalizar = (t: string) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  const filtrados = useMemo(() => {
    const q = normalizar(filtro.trim());
    if (!q) return beneficiarios;
    const qDigitos = q.replace(/\D/g, '');
    return beneficiarios.filter((b) =>
      normalizar(b.nombre).includes(q) ||
      (qDigitos.length > 0 && String(b.cedula || '').replace(/\D/g, '').includes(qDigitos)),
    );
  }, [beneficiarios, filtro]);
  const conSuelo = useMemo(() => beneficiarios.filter((b) => b.tieneSuelo).length, [beneficiarios]);

  /** La torta por técnico solo en la vista del técnico; la revisión ve únicamente totales. */
  const tortas = () => {
    const meta = resumen?.meta ?? 750;
    const total = resumen?.total ?? 0;
    const porTecnico = (resumen?.tecnicos ?? []).map((t, i) => ({
      etiqueta: t.nombre,
      valor: t.hectareas,
      color: PALETA_TECNICOS[i % PALETA_TECNICOS.length],
    }));
    return (
      <View>
        {!revisar && (
          <TortaResumen
            titulo={`Hectáreas por técnico (máximo ${meta})`}
            datos={porTecnico}
            formatear={(v) => `${formatearHectareas(v)} ha`}
          />
        )}
        <TortaResumen
          titulo={`Realizadas vs. faltantes (meta ${meta} ha)`}
          datos={[
            { etiqueta: 'Realizadas', valor: total, color: COLOR_HECHO },
            { etiqueta: 'Faltan', valor: Math.max(meta - total, 0), color: COLOR_FALTA },
          ]}
          formatear={(v) => `${formatearHectareas(v)} ha`}
        />
      </View>
    );
  };

  if (cargando) {
    return (
      <View style={styles.container}>
        <ActivityIndicator style={{ marginTop: SPACING.xl }} size="large" color={COLORS.primary} />
      </View>
    );
  }

  const refresco = <RefreshControl refreshing={refrescando} onRefresh={() => cargar(true)} colors={[COLORS.primary]} />;
  const relleno = { paddingBottom: insets.bottom + SPACING.xl };

  // ─── Beneficiarios (técnico: los suyos · revisión: todos, suelos primero) ──
  const lista = revisar ? filtrados : beneficiarios;
  return (
    <View style={styles.container}>
      <FlatList
        data={lista}
        keyExtractor={(b) => String(b.item)}
        contentContainerStyle={[styles.lista, relleno]}
        refreshControl={refresco}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          revisar ? (
            <View>
              {tortas()}
              <View style={styles.filaSeccion}>
                <Text style={[styles.seccion, { flexShrink: 1 }]}>
                  Beneficiarios con Visita 2 · {beneficiarios.length} · revisados{' '}
                  {beneficiarios.filter((b) => revision.estaRevisado(b.item)).length}
                </Text>
                <TextInput
                  style={styles.busqueda}
                  value={filtro}
                  onChangeText={setFiltro}
                  placeholder="🔍 Buscar por nombre o cédula"
                  placeholderTextColor={COLORS.textSecondary}
                  autoCorrect={false}
                  autoCapitalize="none"
                  clearButtonMode="while-editing"
                />
              </View>
            </View>
          ) : (
            <View>
              {tortas()}
              <Text style={styles.seccion}>Mis beneficiarios · {formatearHectareas(totalTecnico)} ha</Text>
            </View>
          )
        }
        ListEmptyComponent={<Text style={styles.vacio}>{filtro ? 'Sin resultados.' : revisar ? 'Aún no hay beneficiarios con la Visita 2 completada.' : 'No hay beneficiarios asignados.'}</Text>}
        renderItem={({ item: b, index }) => {
          const completada = !!b.formularioId;
          const revisado = completada && revision.estaRevisado(b.item);
          // Revisión: título al iniciar cada grupo (con análisis de suelos / sin él).
          const titulo =
            revisar && (index === 0 || !!lista[index - 1].tieneSuelo !== !!b.tieneSuelo)
              ? b.tieneSuelo
                ? `🧪 Con análisis de suelos (${conSuelo})`
                : `Sin análisis de suelos (${beneficiarios.length - conSuelo})`
              : null;
          return (
            <>
            {titulo && <Text style={[styles.grupo, !b.tieneSuelo && { color: COLORS.textSecondary }]}>{titulo}</Text>}
            <TouchableOpacity
              style={[styles.card, { borderLeftColor: completada ? COLOR_HECHO : COLOR_FALTA }, revisado && ESTILO_CARD_REVISADA]}
              activeOpacity={0.7}
              onPress={() => abrirBeneficiario(b)}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.nombre}>{b.nombre}</Text>
                <Text style={styles.dato}>C.C. {b.cedula}</Text>
                <Text style={styles.dato}>{b.corregimiento} · {b.vereda}</Text>
                <Text style={[styles.estadoVisita, { color: completada ? COLOR_HECHO : COLOR_FALTA }]}>
                  {completada ? '✓ Visita Técnica 2 completada' : 'Visita Técnica 2 pendiente'}
                </Text>
                {(() => {
                  // Cómo va el acta (técnico e interventor), sin entrar.
                  const { acta: a, total } = resumirActas(actasPorCedula[b.cedula] ?? []);
                  const p = presentacionActa(a.estado, a.faltantes, a.firmaInterventoria);
                  return (
                    <>
                      <Text style={[styles.estadoVisita, { color: COLOR_TONO_ACTA[p.tonoTxt] }]} numberOfLines={2}>
                        {p.txt}{total > 1 ? ` · ${total} actas` : ''}
                      </Text>
                      {p.interventor && (
                        <Text style={[styles.estadoVisita, { color: COLOR_TONO_ACTA[p.interventor.tono] }]}>{p.interventor.txt}</Text>
                      )}
                    </>
                  );
                })()}
                {completada && <EtiquetaRevisado revisado={revisado} pendiente={modo === 'revisar'} />}
              </View>
              <Text style={[styles.hectareas, !completada && { color: COLORS.textLight }]}>
                {formatearHectareas(b.hectareas)} ha
              </Text>
              {modo === 'revisar' && revision.puedeRevisar && completada && (
                <BotonOkInterventoria
                  style={{ marginLeft: SPACING.sm }}
                  revisado={revisado}
                  ocupado={revision.ocupado === String(b.item)}
                  onPress={() => revision.alternar(b.item)}
                />
              )}
              <Text style={styles.flecha}>›</Text>
            </TouchableOpacity>
            </>
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
  vacio: { textAlign: 'center', color: COLORS.textSecondary, padding: SPACING.md },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm, borderLeftWidth: 4, ...SHADOWS.sm },
  nombre: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  dato: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 1 },
  hectareas: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold, color: COLORS.primary, marginLeft: SPACING.sm },
  flecha: { fontSize: 24, color: COLORS.textLight, marginLeft: SPACING.sm },
  filaSeccion: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: SPACING.sm },
  busqueda: { flexGrow: 1, flexBasis: 220, marginLeft: 'auto', maxWidth: 420, borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, backgroundColor: COLORS.surface, paddingHorizontal: SPACING.md, paddingVertical: Platform.OS === 'web' ? SPACING.sm : 6, fontSize: FONTS.sizes.sm, color: COLORS.textPrimary, marginTop: SPACING.xs, marginBottom: SPACING.sm },
  grupo: { fontSize: FONTS.sizes.sm, fontWeight: FONTS.weights.bold, color: COLORS.primary, marginTop: SPACING.sm, marginBottom: SPACING.xs },
  estadoVisita: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold, marginTop: 3 },
});

export default HectareasActividadScreen;
