// ============================================================
// GEODAILY — Actividad medida en hectáreas (meta 750 ha)
// ============================================================
// Las hectáreas de cada beneficiario salen de su Visita Técnica ya completada
// (2,5 ha fijas por beneficiario; ver backend/src/routes/actividadesHectareas.js).
// Misma navegación que el análisis de suelos:
//   · técnico (modo 'ejecutar')  → 2 tortas del proyecto + SUS beneficiarios.
//   · superior (modo 'revisar')  → 2 tortas + lista de técnicos; al elegir uno,
//     sus beneficiarios.
// Al tocar un beneficiario con la visita completada se abre el Detalle de ese
// formulario (el consolidado de la actividad).
// ============================================================

import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { buscarActividad, verboActividad } from '../../data/actividades';
import { avisar } from '../../utils/dialogos';
import { useAuth } from '../../store/AuthContext';
import { abrirDetalleFormulario } from '../../utils/abrirDetalleFormulario';
import TortaResumen, { COLOR_FALTA, COLOR_HECHO, PALETA_TECNICOS } from '../../components/actividades/TortaResumen';
import {
  BeneficiarioHectareas,
  ResumenHectareas,
  formatearHectareas,
  listarBeneficiariosHectareasDeTecnico,
  listarMisBeneficiariosHectareas,
  obtenerResumenHectareas,
} from '../../services/actividadesHectareas.service';

const mensajeError = (e: any, porDefecto: string) =>
  e?.response?.data?.mensaje || (e?.message?.includes('Network') ? 'Sin conexión. Verifica tu internet.' : porDefecto);

const HectareasActividadScreen: React.FC<any> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const actividadId: string = route?.params?.actividadId;
  const actividad = buscarActividad(actividadId);
  const modo: 'ejecutar' | 'revisar' = route?.params?.modo === 'revisar' ? 'revisar' : 'ejecutar';
  const tecnico: { usuario: string; nombre: string } | undefined = route?.params?.tecnico;
  const vistaTecnicos = modo === 'revisar' && !tecnico;
  const nombreActividad = actividad?.nombre ?? 'Actividad';

  const [resumen, setResumen] = useState<ResumenHectareas | null>(null);
  const [beneficiarios, setBeneficiarios] = useState<BeneficiarioHectareas[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);

  // Beneficiario cuyo formulario se está abriendo
  const [abriendo, setAbriendo] = useState<number | null>(null);

  useLayoutEffect(() => {
    navigation.setOptions({
      title: tecnico ? tecnico.nombre : `${verboActividad(modo)} ${nombreActividad}`,
    });
  }, [navigation, tecnico, modo, nombreActividad]);

  const cargar = useCallback(async (esRefresh = false) => {
    try {
      if (esRefresh) setRefrescando(true);
      // Las tortas se ven en la lista de técnicos y en la del técnico (no dentro de un técnico).
      if (!tecnico) setResumen(await obtenerResumenHectareas(actividadId));
      if (tecnico) setBeneficiarios(await listarBeneficiariosHectareasDeTecnico(actividadId, tecnico.usuario));
      else if (modo === 'ejecutar') setBeneficiarios(await listarMisBeneficiariosHectareas(actividadId));
    } catch (e) {
      avisar('No se pudo cargar', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }, [actividadId, tecnico, modo]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  // Abre el Detalle del Formulario de la visita que respalda las hectáreas.
  const abrirFormulario = async (b: BeneficiarioHectareas) => {
    if (!b.formularioId || abriendo !== null) return;
    setAbriendo(b.item);
    try {
      await abrirDetalleFormulario(navigation, user?.rol, b.formularioId);
    } finally {
      setAbriendo(null);
    }
  };

  const totalTecnico = useMemo(() => beneficiarios.reduce((s, b) => s + b.hectareas, 0), [beneficiarios]);

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
        <TortaResumen
          titulo={`Hectáreas por técnico (máximo ${meta})`}
          datos={porTecnico}
          formatear={(v) => `${formatearHectareas(v)} ha`}
        />
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

  // ─── Superior: tortas + lista de técnicos ─────────────────
  if (vistaTecnicos) {
    const tecnicos = resumen?.tecnicos ?? [];
    return (
      <View style={styles.container}>
        <FlatList
          data={tecnicos}
          keyExtractor={(t) => t.usuario}
          contentContainerStyle={[styles.lista, relleno]}
          refreshControl={refresco}
          ListHeaderComponent={<View>{tortas()}<Text style={styles.seccion}>Técnicos</Text></View>}
          ListEmptyComponent={<Text style={styles.vacio}>No hay técnicos activos.</Text>}
          renderItem={({ item: t, index }) => (
            <TouchableOpacity
              style={[styles.card, { borderLeftColor: PALETA_TECNICOS[index % PALETA_TECNICOS.length] }]}
              activeOpacity={0.7}
              onPress={() => navigation.push('ActividadDetalle', { actividadId, modo: 'revisar', tecnico: { usuario: t.usuario, nombre: t.nombre } })}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.nombre}>{t.nombre}</Text>
                <Text style={styles.dato}>{t.asignados} beneficiarios</Text>
              </View>
              <Text style={styles.hectareas}>{formatearHectareas(t.hectareas)} ha</Text>
              <Text style={styles.flecha}>›</Text>
            </TouchableOpacity>
          )}
        />
      </View>
    );
  }

  // ─── Beneficiarios (técnico, o superior dentro de un técnico) ──
  return (
    <View style={styles.container}>
      <FlatList
        data={beneficiarios}
        keyExtractor={(b) => String(b.item)}
        contentContainerStyle={[styles.lista, relleno]}
        refreshControl={refresco}
        ListHeaderComponent={
          <View>
            {!tecnico && tortas()}
            <Text style={styles.seccion}>
              {tecnico ? 'Beneficiarios' : 'Mis beneficiarios'} · {formatearHectareas(totalTecnico)} ha
            </Text>
          </View>
        }
        ListEmptyComponent={<Text style={styles.vacio}>No hay beneficiarios asignados.</Text>}
        renderItem={({ item: b }) => {
          const completada = !!b.formularioId;
          return (
            <TouchableOpacity
              style={[styles.card, { borderLeftColor: completada ? COLOR_HECHO : COLOR_FALTA }]}
              activeOpacity={completada ? 0.7 : 1}
              onPress={() => abrirFormulario(b)}
              disabled={!completada}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.nombre}>{b.nombre}</Text>
                <Text style={styles.dato}>C.C. {b.cedula}</Text>
                <Text style={styles.dato}>{b.corregimiento} · {b.vereda}</Text>
                <Text style={[styles.estadoVisita, { color: completada ? COLOR_HECHO : COLOR_FALTA }]}>
                  {completada ? '✓ Visita Técnica 2 completada' : 'Visita Técnica 2 pendiente'}
                </Text>
              </View>
              <Text style={[styles.hectareas, !completada && { color: COLORS.textLight }]}>
                {formatearHectareas(b.hectareas)} ha
              </Text>
              {abriendo === b.item ? (
                <ActivityIndicator style={styles.flecha} color={COLORS.primary} />
              ) : (
                completada && <Text style={styles.flecha}>›</Text>
              )}
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
  vacio: { textAlign: 'center', color: COLORS.textSecondary, padding: SPACING.md },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm, borderLeftWidth: 4, ...SHADOWS.sm },
  nombre: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  dato: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 1 },
  hectareas: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold, color: COLORS.primary, marginLeft: SPACING.sm },
  flecha: { fontSize: 24, color: COLORS.textLight, marginLeft: SPACING.sm },
  estadoVisita: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.semibold, marginTop: 3 },
});

export default HectareasActividadScreen;
