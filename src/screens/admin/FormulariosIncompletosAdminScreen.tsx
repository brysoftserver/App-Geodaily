// ============================================================
// GEODAILY — Admin: Listado de formularios incompletos
// ============================================================
// Borradores de TODOS los técnicos, agrupados por técnico. El admin revisa
// qué tiene cada borrador y puede "forzarlo como completo" para después
// agregarle a mano lo que falte desde el detalle del formulario.
// ============================================================

import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  TouchableOpacity,
  StyleSheet,
  Alert,
  RefreshControl,
  ActivityIndicator,
  TextInput,
  Platform,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import apiClient from '../../services/api';
import { fetchFormularioDelServidor } from '../../services/formularios.service';
import { tituloVisitaTecnica } from '../../utils/visitaTecnica';
import LoadingSpinner from '../../components/LoadingSpinner';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';

type Props = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
};

interface TecnicoConBorradores {
  id: string;
  nombre: string;
  usuario: string;
  rol: string;
  total: number;
  ultimo: string;
}

interface BorradorResumen {
  id: string;
  tipo: string;
  visita_numero: number | null;
  formato_visita: string | null;
  beneficiario: { nombre: string; cedula: string; vereda: string; municipio: string };
  actividad: {
    objetivo: string;
    descripcion: string;
    seguimiento_compromisos: string;
    observaciones: string;
    recomendaciones: string;
    valoracion_cumplimiento: number | null;
    compromisos: string[];
    area_intervencion: unknown;
  } | null;
  poligonos: number;
  fotos: number;
  tiene_coordenadas: boolean;
  firma_beneficiario: boolean;
  firma_tecnico: boolean;
  updated_at: string;
}

const formatearFecha = (valor?: string) => {
  if (!valor) return '—';
  const d = new Date(valor);
  if (Number.isNaN(d.getTime())) return valor;
  return d.toLocaleString('es-CO', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
};

const tituloBorrador = (b: BorradorResumen) =>
  b.tipo === 'caracterizacion'
    ? '👥 Caracterización (Visita 1)'
    : `🔍 ${tituloVisitaTecnica(b.visita_numero ?? undefined)}`;

/** Qué tiene y qué le falta al borrador, para decidir antes de forzarlo. */
const checklist = (b: BorradorResumen): { label: string; ok: boolean }[] => {
  const items: { label: string; ok: boolean }[] = [
    { label: 'Beneficiario', ok: !!(b.beneficiario.nombre && b.beneficiario.cedula) },
  ];
  if (b.actividad) {
    items.push(
      { label: 'Objetivo', ok: !!b.actividad.objetivo.trim() },
      { label: 'Descripción', ok: !!b.actividad.descripcion.trim() && !/^Visita Técnica \d+$/.test(b.actividad.descripcion.trim()) },
      { label: 'Observaciones', ok: !!b.actividad.observaciones.trim() },
      { label: 'Recomendaciones', ok: !!b.actividad.recomendaciones.trim() },
      { label: `Polígono${b.poligonos > 1 ? `s (${b.poligonos})` : ''}`, ok: b.poligonos > 0 },
    );
  }
  items.push(
    { label: 'Coordenadas', ok: b.tiene_coordenadas },
    { label: `Fotos (${b.fotos})`, ok: b.fotos > 0 },
    { label: 'Firma beneficiario', ok: b.firma_beneficiario },
    { label: 'Firma técnico', ok: b.firma_tecnico },
  );
  return items;
};

const confirmar = (titulo: string, mensaje: string, textoOk: string): Promise<boolean> => {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    return Promise.resolve(typeof window !== 'undefined' && window.confirm(`${titulo}\n\n${mensaje}`));
  }
  return new Promise((resolve) => {
    Alert.alert(titulo, mensaje, [
      { text: 'Cancelar', style: 'cancel', onPress: () => resolve(false) },
      { text: textoOk, style: 'destructive', onPress: () => resolve(true) },
    ]);
  });
};

const avisar = (titulo: string, mensaje: string) => {
  if (Platform.OS === 'web') {
    // eslint-disable-next-line no-alert
    if (typeof window !== 'undefined') window.alert(`${titulo}\n\n${mensaje}`);
    return;
  }
  Alert.alert(titulo, mensaje);
};

const FormulariosIncompletosAdminScreen: React.FC<Props> = ({ navigation }) => {
  const insets = useSafeAreaInsets();
  const [tecnicos, setTecnicos] = useState<TecnicoConBorradores[]>([]);
  const [cargando, setCargando] = useState(true);
  const [refrescando, setRefrescando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busqueda, setBusqueda] = useState('');
  const [abierto, setAbierto] = useState<string | null>(null);
  const [borradores, setBorradores] = useState<Record<string, BorradorResumen[]>>({});
  const [cargandoTecnico, setCargandoTecnico] = useState<string | null>(null);
  const [forzando, setForzando] = useState<string | null>(null);

  const cargarTecnicos = useCallback(async () => {
    try {
      setError(null);
      const { data } = await apiClient.get('/api/borradores/admin/tecnicos', { timeout: 30000 });
      setTecnicos(Array.isArray(data?.tecnicos) ? data.tecnicos : []);
    } catch (e: any) {
      setError(e?.response?.data?.mensaje || 'No se pudieron cargar los formularios incompletos');
    } finally {
      setCargando(false);
      setRefrescando(false);
    }
  }, []);

  const cargarBorradoresTecnico = useCallback(async (usuarioId: string) => {
    setCargandoTecnico(usuarioId);
    try {
      const { data } = await apiClient.get(`/api/borradores/admin/tecnico/${encodeURIComponent(usuarioId)}`, {
        timeout: 30000,
      });
      setBorradores((prev) => ({ ...prev, [usuarioId]: Array.isArray(data?.borradores) ? data.borradores : [] }));
    } catch (e: any) {
      avisar('Error', e?.response?.data?.mensaje || 'No se pudieron cargar los borradores del técnico');
    } finally {
      setCargandoTecnico(null);
    }
  }, []);

  useEffect(() => {
    cargarTecnicos();
  }, [cargarTecnicos]);

  const onRefresh = () => {
    setRefrescando(true);
    setBorradores({});
    cargarTecnicos();
    if (abierto) cargarBorradoresTecnico(abierto);
  };

  const alternarTecnico = (id: string) => {
    if (abierto === id) {
      setAbierto(null);
      return;
    }
    setAbierto(id);
    if (!borradores[id]) cargarBorradoresTecnico(id);
  };

  const abrirFormulario = async (id: string) => {
    const formulario = await fetchFormularioDelServidor(id);
    if (formulario) {
      navigation.navigate('SupervisionFormularioDetail', { formulario, modo: 'online' });
    } else {
      avisar('Formulario completado', 'Quedó guardado. Lo encuentras en "Listado de Formularios".');
    }
  };

  const forzarCompleto = async (tecnico: TecnicoConBorradores, b: BorradorResumen) => {
    const faltantes = checklist(b).filter((i) => !i.ok).map((i) => `• ${i.label}`);
    const ok = await confirmar(
      'Forzar como completo',
      `${tituloBorrador(b)}\nBeneficiario: ${b.beneficiario.nombre || '—'}\nTécnico: ${tecnico.nombre}\n\n` +
        (faltantes.length ? `Le falta:\n${faltantes.join('\n')}\n\n` : '') +
        'El formulario quedará completo a nombre del técnico y desaparecerá de sus borradores. ' +
        'Lo que falte lo agregas después desde el detalle del formulario.',
      'Forzar completo'
    );
    if (!ok) return;

    setForzando(b.id);
    try {
      await apiClient.post(`/api/borradores/admin/${encodeURIComponent(b.id)}/forzar-completo`, {}, { timeout: 60000 });
      setBorradores((prev) => ({ ...prev, [tecnico.id]: (prev[tecnico.id] || []).filter((x) => x.id !== b.id) }));
      setTecnicos((prev) =>
        prev
          .map((t) => (t.id === tecnico.id ? { ...t, total: t.total - 1 } : t))
          .filter((t) => t.total > 0)
      );
      const abrir = await confirmar(
        '✅ Formulario completo',
        `El formulario de ${b.beneficiario.nombre} ya quedó completo. ¿Quieres abrirlo ahora para agregarle lo que falta?`,
        'Abrir formulario'
      );
      if (abrir) await abrirFormulario(b.id);
    } catch (e: any) {
      avisar('No se pudo completar', e?.response?.data?.mensaje || 'Error al forzar el formulario como completo');
    } finally {
      setForzando(null);
    }
  };

  const texto = busqueda.trim().toLowerCase();
  const tecnicosFiltrados = texto
    ? tecnicos.filter((t) => `${t.nombre} ${t.usuario}`.toLowerCase().includes(texto))
    : tecnicos;
  const totalBorradores = tecnicos.reduce((acc, t) => acc + t.total, 0);

  if (cargando) return <LoadingSpinner message="Cargando formularios incompletos..." fullScreen />;

  const renderBorrador = (tecnico: TecnicoConBorradores, b: BorradorResumen) => (
    <View key={b.id} style={styles.borradorCard}>
      <View style={styles.borradorHeader}>
        <Text style={styles.borradorTitulo} numberOfLines={1}>{tituloBorrador(b)}</Text>
        <Text style={styles.borradorFecha}>💾 {formatearFecha(b.updated_at)}</Text>
      </View>
      <Text style={styles.campo} numberOfLines={1}>
        <Text style={styles.campoLabel}>Beneficiario: </Text>
        {b.beneficiario.nombre || '—'}
        {b.beneficiario.cedula ? `  —  CC ${b.beneficiario.cedula}` : ''}
      </Text>
      {!!(b.beneficiario.vereda || b.beneficiario.municipio) && (
        <Text style={styles.campo} numberOfLines={1}>
          <Text style={styles.campoLabel}>Ubicación: </Text>
          {[b.beneficiario.vereda, b.beneficiario.municipio].filter(Boolean).join(', ')}
        </Text>
      )}
      <View style={styles.checklist}>
        {checklist(b).map((i) => (
          <View key={i.label} style={[styles.chip, i.ok ? styles.chipOk : styles.chipFalta]}>
            <Text style={[styles.chipTexto, { color: i.ok ? COLORS.success : COLORS.error }]}>
              {i.ok ? '✓' : '✗'} {i.label}
            </Text>
          </View>
        ))}
      </View>
      <TouchableOpacity
        style={[styles.botonForzar, forzando === b.id && styles.botonDeshabilitado]}
        onPress={() => forzarCompleto(tecnico, b)}
        disabled={!!forzando}
        activeOpacity={0.7}
      >
        {forzando === b.id ? (
          <ActivityIndicator size="small" color={COLORS.textOnPrimary} />
        ) : (
          <Text style={styles.botonForzarTexto}>Forzar completo</Text>
        )}
      </TouchableOpacity>
    </View>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTexto}>
          {tecnicos.length} técnico(s) · {totalBorradores} formulario(s) incompleto(s)
        </Text>
        <TextInput
          style={styles.buscador}
          placeholder="Buscar técnico..."
          placeholderTextColor={COLORS.textLight}
          value={busqueda}
          onChangeText={setBusqueda}
        />
      </View>

      {error ? (
        <View style={styles.vacio}>
          <Text style={styles.vacioTexto}>{error}</Text>
          <TouchableOpacity onPress={() => { setCargando(true); cargarTecnicos(); }}>
            <Text style={styles.reintentar}>Reintentar</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={tecnicosFiltrados}
          keyExtractor={(t) => t.id}
          contentContainerStyle={[styles.lista, { paddingBottom: insets.bottom + SPACING.xxl }]}
          refreshControl={
            <RefreshControl refreshing={refrescando} onRefresh={onRefresh} colors={[COLORS.primary]} tintColor={COLORS.primary} />
          }
          ListEmptyComponent={
            <View style={styles.vacio}>
              <Text style={styles.vacioIcono}>📝</Text>
              <Text style={styles.vacioTexto}>No hay formularios incompletos</Text>
            </View>
          }
          renderItem={({ item: t }) => {
            const expandido = abierto === t.id;
            const lista = borradores[t.id];
            return (
              <View style={styles.tecnicoCard}>
                <TouchableOpacity style={styles.tecnicoFila} onPress={() => alternarTecnico(t.id)} activeOpacity={0.7}>
                  <View style={styles.tecnicoInfo}>
                    <Text style={styles.tecnicoNombre}>{t.nombre || t.usuario}</Text>
                    <Text style={styles.tecnicoSub}>
                      {t.usuario} · último: {formatearFecha(t.ultimo)}
                    </Text>
                  </View>
                  <View style={styles.badge}>
                    <Text style={styles.badgeTexto}>{t.total}</Text>
                  </View>
                  <Text style={styles.flecha}>{expandido ? '▾' : '›'}</Text>
                </TouchableOpacity>
                {expandido && (
                  <View style={styles.tecnicoBorradores}>
                    {cargandoTecnico === t.id && !lista ? (
                      <ActivityIndicator style={{ margin: SPACING.md }} color={COLORS.primary} />
                    ) : lista && lista.length === 0 ? (
                      <Text style={styles.sinBorradores}>Sin formularios incompletos</Text>
                    ) : (
                      (lista || []).map((b) => renderBorrador(t, b))
                    )}
                  </View>
                )}
              </View>
            );
          }}
        />
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: COLORS.background },
  header: {
    padding: SPACING.md,
    backgroundColor: COLORS.surface,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  headerTexto: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginBottom: SPACING.sm },
  buscador: {
    borderWidth: 1,
    borderColor: COLORS.divider,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
  },
  lista: { padding: SPACING.md },
  tecnicoCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.sm,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.warning,
    overflow: 'hidden',
    ...SHADOWS.sm,
  },
  tecnicoFila: { flexDirection: 'row', alignItems: 'center', padding: SPACING.md },
  tecnicoInfo: { flex: 1 },
  tecnicoNombre: { fontSize: FONTS.sizes.lg, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  tecnicoSub: { fontSize: FONTS.sizes.xs, color: COLORS.textSecondary, marginTop: 2 },
  badge: {
    backgroundColor: COLORS.warning,
    borderRadius: BORDER_RADIUS.full,
    minWidth: 28,
    paddingHorizontal: SPACING.sm,
    paddingVertical: 2,
    alignItems: 'center',
    marginLeft: SPACING.sm,
  },
  badgeTexto: { color: COLORS.textOnPrimary, fontWeight: FONTS.weights.bold, fontSize: FONTS.sizes.sm },
  flecha: { fontSize: 22, color: COLORS.textLight, marginLeft: SPACING.sm, width: 18, textAlign: 'center' },
  tecnicoBorradores: {
    borderTopWidth: 1,
    borderTopColor: COLORS.divider,
    padding: SPACING.sm,
    backgroundColor: COLORS.background,
  },
  sinBorradores: { textAlign: 'center', color: COLORS.textSecondary, padding: SPACING.md },
  borradorCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.md,
    padding: SPACING.md,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.divider,
  },
  borradorHeader: { marginBottom: SPACING.xs },
  borradorTitulo: { fontSize: FONTS.sizes.md, fontWeight: FONTS.weights.semibold, color: COLORS.textPrimary },
  borradorFecha: { fontSize: FONTS.sizes.xs, color: COLORS.textLight, marginTop: 2 },
  campo: { fontSize: FONTS.sizes.sm, color: COLORS.textSecondary, marginBottom: 2 },
  campoLabel: { fontWeight: FONTS.weights.medium, color: COLORS.textPrimary },
  checklist: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginVertical: SPACING.sm },
  chip: { borderRadius: BORDER_RADIUS.full, paddingHorizontal: SPACING.sm, paddingVertical: 2 },
  chipOk: { backgroundColor: COLORS.success + '18' },
  chipFalta: { backgroundColor: COLORS.error + '18' },
  chipTexto: { fontSize: FONTS.sizes.xs, fontWeight: FONTS.weights.medium },
  botonForzar: {
    backgroundColor: COLORS.roleAdmin,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    marginTop: SPACING.xs,
  },
  botonDeshabilitado: { opacity: 0.6 },
  botonForzarTexto: { color: COLORS.textOnPrimary, fontWeight: FONTS.weights.semibold, fontSize: FONTS.sizes.md },
  vacio: { alignItems: 'center', padding: SPACING.xl },
  vacioIcono: { fontSize: 56, marginBottom: SPACING.sm },
  vacioTexto: { fontSize: FONTS.sizes.md, color: COLORS.textSecondary, textAlign: 'center' },
  reintentar: { marginTop: SPACING.md, color: COLORS.info, fontWeight: FONTS.weights.semibold },
});

export default FormulariosIncompletosAdminScreen;
