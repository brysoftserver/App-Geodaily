// ============================================================
// GEODAILY — Asistencia Técnica Durante el Establecimiento del Cultivo
// ============================================================
// La actividad son las visitas que hace cada técnico (Visita 1 =
// caracterización, Visita 2…12 = visitas técnicas). Sin meta.
//   · técnico (modo 'ejecutar')  → todas SUS visitas.
//   · superior (modo 'revisar')  → lista de técnicos; al elegir uno, todas
//     sus visitas.
// Tocar una visita abre su Detalle del Formulario (solo lectura).
// ============================================================

import React, { useCallback, useLayoutEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
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
import { PALETA_TECNICOS } from '../../components/actividades/TortaResumen';
import { BotonOkInterventoria, ESTILO_CARD_REVISADA, EtiquetaRevisado } from '../../components/actividades/RevisionInterventoria';
import { useRevisionInterventoria } from '../../hooks/useRevisionInterventoria';
import {
  TecnicoAsistencia,
  VisitaAsistencia,
  etiquetaVisita,
  listarMisVisitas,
  listarVisitasDeTecnico,
  obtenerResumenAsistencia,
} from '../../services/asistenciaTecnica.service';

const ACTIVIDAD_ID = 'asistencia_tecnica';

const mensajeError = (e: any, porDefecto: string) =>
  e?.response?.data?.mensaje || (e?.message?.includes('Network') ? 'Sin conexión. Verifica tu internet.' : porDefecto);

/** Color de la insignia según el número de visita (la 1 es la caracterización). */
const colorVisita = (numero: number | null) => PALETA_TECNICOS[((numero ?? 1) - 1 + PALETA_TECNICOS.length) % PALETA_TECNICOS.length];

const formatearFecha = (iso: string) =>
  new Date(iso).toLocaleDateString('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

const AsistenciaTecnicaScreen: React.FC<any> = ({ navigation, route }) => {
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const modo: 'ejecutar' | 'revisar' = route?.params?.modo === 'revisar' ? 'revisar' : 'ejecutar';
  const tecnico: { usuario: string; nombre: string } | undefined = route?.params?.tecnico;
  const vistaTecnicos = modo === 'revisar' && !tecnico;
  const nombreActividad = buscarActividad(ACTIVIDAD_ID)?.nombre ?? 'Asistencia Técnica';
  // OK de la interventoría por visita (referencia = id del formulario).
  const revision = useRevisionInterventoria(ACTIVIDAD_ID, !vistaTecnicos);

  const [tecnicos, setTecnicos] = useState<TecnicoAsistencia[]>([]);
  const [totalVisitas, setTotalVisitas] = useState(0);
  const [visitas, setVisitas] = useState<VisitaAsistencia[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [abriendo, setAbriendo] = useState<string | null>(null);
  const [filtro, setFiltro] = useState('');

  useLayoutEffect(() => {
    navigation.setOptions({ title: tecnico ? tecnico.nombre : `${verboActividad(modo)} Asistencia Técnica` });
  }, [navigation, tecnico, modo]);

  const cargar = useCallback(async (esRefresh = false) => {
    try {
      if (esRefresh) setRefrescando(true);
      if (vistaTecnicos) {
        const r = await obtenerResumenAsistencia();
        setTecnicos(r.tecnicos);
        setTotalVisitas(r.total);
      } else {
        setVisitas(tecnico ? await listarVisitasDeTecnico(tecnico.usuario) : await listarMisVisitas());
      }
    } catch (e) {
      avisar('No se pudo cargar', mensajeError(e, 'Inténtalo de nuevo.'));
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }, [vistaTecnicos, tecnico]);

  useFocusEffect(useCallback(() => { cargar(); }, [cargar]));

  const abrirVisita = async (v: VisitaAsistencia) => {
    if (abriendo !== null) return;
    setAbriendo(v.id);
    try {
      await abrirDetalleFormulario(navigation, user?.rol, v.id);
    } finally {
      setAbriendo(null);
    }
  };

  /** Cuántas visitas hay de cada número (Visita 1: 35 · Visita 2: 28…). */
  const porNumero = useMemo(() => {
    const cuenta = new Map<string, number>();
    for (const v of visitas) cuenta.set(etiquetaVisita(v), (cuenta.get(etiquetaVisita(v)) ?? 0) + 1);
    return Array.from(cuenta.entries());
  }, [visitas]);

  const visitasFiltradas = useMemo(() => {
    const q = filtro.trim().toLowerCase();
    if (!q) return visitas;
    return visitas.filter((v) => v.nombre.toLowerCase().includes(q) || v.cedula.includes(q));
  }, [visitas, filtro]);

  if (cargando) {
    return (
      <View style={styles.container}>
        <ActivityIndicator style={{ marginTop: SPACING.xl }} size="large" color={COLORS.primary} />
      </View>
    );
  }

  const refresco = <RefreshControl refreshing={refrescando} onRefresh={() => cargar(true)} colors={[COLORS.primary]} />;
  const relleno = { paddingBottom: insets.bottom + SPACING.xl };

  // ─── Superior: lista de técnicos ───────────────────────────
  if (vistaTecnicos) {
    return (
      <View style={styles.container}>
        <FlatList
          data={tecnicos}
          keyExtractor={(t) => t.usuario}
          contentContainerStyle={[styles.lista, relleno]}
          refreshControl={refresco}
          ListHeaderComponent={
            <View>
              <Text style={styles.titulo}>{nombreActividad}</Text>
              <Text style={styles.subtitulo}>{totalVisitas} visitas registradas por {tecnicos.length} técnicos</Text>
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
                <Text style={styles.dato}>{t.beneficiarios} beneficiarios atendidos</Text>
              </View>
              <Text style={styles.cantidad}>{t.visitas} visitas</Text>
              <Text style={styles.flecha}>›</Text>
            </TouchableOpacity>
          )}
        />
      </View>
    );
  }

  // ─── Visitas (técnico, o superior dentro de un técnico) ────
  return (
    <View style={styles.container}>
      <FlatList
        data={visitasFiltradas}
        keyExtractor={(v) => v.id}
        contentContainerStyle={[styles.lista, relleno]}
        refreshControl={refresco}
        keyboardShouldPersistTaps="handled"
        ListHeaderComponent={
          <View>
            <Text style={styles.subtitulo}>
              {visitas.length} visitas
              {porNumero.length > 0 ? ` · ${porNumero.map(([e, n]) => `${e}: ${n}`).join(' · ')}` : ''}
            </Text>
            <TextInput
              style={styles.buscador}
              value={filtro}
              onChangeText={setFiltro}
              placeholder="Buscar por nombre o cédula"
              placeholderTextColor={COLORS.textLight}
            />
          </View>
        }
        ListEmptyComponent={<Text style={styles.vacio}>{filtro ? 'Sin resultados.' : 'Aún no hay visitas registradas.'}</Text>}
        renderItem={({ item: v }) => {
          const revisado = revision.estaRevisado(v.id);
          return (
          <TouchableOpacity
            style={[styles.card, { borderLeftColor: colorVisita(v.numero) }, revisado && ESTILO_CARD_REVISADA]}
            activeOpacity={0.7}
            onPress={() => abrirVisita(v)}
          >
            <View style={{ flex: 1 }}>
              <View style={[styles.insignia, { backgroundColor: colorVisita(v.numero) }]}>
                <Text style={styles.insigniaTxt}>{etiquetaVisita(v)}</Text>
              </View>
              <Text style={styles.nombre}>{v.nombre}</Text>
              <Text style={styles.dato}>C.C. {v.cedula}</Text>
              <Text style={styles.dato}>{[v.corregimiento, v.vereda].filter(Boolean).join(' · ')}</Text>
              <EtiquetaRevisado revisado={revisado} pendiente={modo === 'revisar'} />
            </View>
            <Text style={styles.fecha}>{formatearFecha(v.fecha)}</Text>
            {modo === 'revisar' && revision.puedeRevisar && (
              <BotonOkInterventoria
                style={{ marginLeft: SPACING.sm }}
                revisado={revisado}
                ocupado={revision.ocupado === v.id}
                onPress={() => revision.alternar(v.id)}
              />
            )}
            {abriendo === v.id ? <ActivityIndicator style={styles.flecha} color={COLORS.primary} /> : <Text style={styles.flecha}>›</Text>}
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
  titulo: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.bold, color: COLORS.textPrimary },
  subtitulo: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 2, marginBottom: SPACING.sm },
  buscador: { backgroundColor: COLORS.surface, borderWidth: 1, borderColor: COLORS.border, borderRadius: BORDER_RADIUS.md, paddingHorizontal: SPACING.md, paddingVertical: SPACING.sm, marginBottom: SPACING.md, color: COLORS.textPrimary },
  vacio: { textAlign: 'center', color: COLORS.textSecondary, padding: SPACING.md },
  card: { flexDirection: 'row', alignItems: 'center', backgroundColor: COLORS.surface, borderRadius: BORDER_RADIUS.lg, padding: SPACING.md, marginBottom: SPACING.sm, borderLeftWidth: 4, ...SHADOWS.sm },
  nombre: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  dato: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginTop: 1 },
  cantidad: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.bold, color: COLORS.primary, marginLeft: SPACING.sm },
  fecha: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginLeft: SPACING.sm },
  flecha: { fontSize: 24, color: COLORS.textLight, marginLeft: SPACING.sm },
  insignia: { alignSelf: 'flex-start', borderRadius: BORDER_RADIUS.sm, paddingHorizontal: SPACING.sm, paddingVertical: 2, marginBottom: 4 },
  insigniaTxt: { color: '#fff', fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.bold },
});

export default AsistenciaTecnicaScreen;
