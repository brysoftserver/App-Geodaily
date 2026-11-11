// ============================================================
// GEODAILY — Selector para CAMBIAR el beneficiario de una visita
// ============================================================
// Caso excepcional: el técnico tomó fotos, videos o respuestas dentro del
// beneficiario equivocado y ese beneficiario ya tenía la visita registrada.
// Desde el aviso «Visita ya registrada» → «Cambiar beneficiario» se abre este
// selector para elegir el beneficiario correcto sin perder lo diligenciado.
//
// Lista los beneficiarios asignados al técnico (espejo local, funciona sin
// señal) y marca los que ya tienen esa visita. La validación final (no dejar
// completar con un beneficiario que ya la tiene) la hace la pantalla del
// formulario, con el mismo aviso de siempre.
// ============================================================

import React, { useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Modal,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { BORDER_RADIUS, COLORS, FONTS, SHADOWS, SPACING } from '../theme';
import type { BeneficiarioDB, DatosBeneficiario, Formulario } from '../types';
import { getBeneficiarios, getBeneficiariosByTecnico } from '../services/beneficiariosDB.service';
import { getFormulariosLocales } from '../services/database';
import { useAuth } from '../store/AuthContext';
import { cargarFiltroAsignacion } from '../utils/visibilidadAsignacion';
import { buscarVisitaCompletada, normalizarCedula } from '../utils/llaveVisita';

interface Props {
  visible: boolean;
  tecnicoId?: string | null;
  numeroVisita: number;
  /** Cédula del beneficiario actual (el que ya tiene la visita). */
  cedulaActual?: string | null;
  onSeleccionar: (beneficiario: DatosBeneficiario) => void;
  onCerrar: () => void;
}

interface Fila {
  benef: BeneficiarioDB;
  yaTieneVisita: boolean;
  esActual: boolean;
}

const aDatosBeneficiario = (b: BeneficiarioDB): DatosBeneficiario => ({
  nombre: b.nombre_completo || '',
  cedula: b.cedula || '',
  telefono: b.telefono || '',
  departamento: b.departamento || 'Caquetá',
  municipio: b.municipio || 'Puerto Rico',
  vereda: b.vereda || '',
  corregimiento: b.corregimiento || undefined,
  finca: b.nombre_predio || '',
});

const SelectorBeneficiarioModal: React.FC<Props> = ({
  visible,
  tecnicoId,
  numeroVisita,
  cedulaActual,
  onSeleccionar,
  onCerrar,
}) => {
  const [cargando, setCargando] = useState(false);
  const [beneficiarios, setBeneficiarios] = useState<BeneficiarioDB[]>([]);
  const [formularios, setFormularios] = useState<Formulario[]>([]);
  const [busqueda, setBusqueda] = useState('');
  const { user } = useAuth();

  useEffect(() => {
    if (!visible) return;
    let activo = true;
    setBusqueda('');
    setCargando(true);
    (async () => {
      try {
        let lista = tecnicoId ? await getBeneficiariosByTecnico(tecnicoId).catch(() => []) : [];
        // Sin asignados en el espejo local: se ofrece el padrón completo,
        // pero a un técnico nunca se le ofrecen beneficiarios desasignados o
        // de otro técnico (ver utils/visibilidadAsignacion.ts).
        if (lista.length === 0) {
          const visibleParaMi = await cargarFiltroAsignacion(user);
          lista = (await getBeneficiarios().catch(() => [])).filter((b) => visibleParaMi(b.cedula));
        }
        const forms = await getFormulariosLocales().catch(() => [] as Formulario[]);
        if (!activo) return;
        setBeneficiarios(lista.filter((b) => !!normalizarCedula(b.cedula)));
        setFormularios(forms);
      } finally {
        if (activo) setCargando(false);
      }
    })();
    return () => {
      activo = false;
    };
  }, [visible, tecnicoId, user]);

  const filas = useMemo<Fila[]>(() => {
    const cedActual = normalizarCedula(cedulaActual);
    const q = busqueda.trim().toLowerCase();
    const qCed = normalizarCedula(busqueda);
    return beneficiarios
      .filter((b) => {
        if (!q) return true;
        return (
          (b.nombre_completo || '').toLowerCase().includes(q) ||
          (!!qCed && normalizarCedula(b.cedula).includes(qCed))
        );
      })
      .map((b) => ({
        benef: b,
        yaTieneVisita: !!buscarVisitaCompletada(formularios, b.cedula, numeroVisita),
        esActual: !!cedActual && normalizarCedula(b.cedula) === cedActual,
      }));
  }, [beneficiarios, formularios, busqueda, cedulaActual, numeroVisita]);

  const renderFila = ({ item }: { item: Fila }) => (
    <TouchableOpacity
      style={[styles.fila, (item.yaTieneVisita || item.esActual) && styles.filaBloqueada]}
      onPress={() => onSeleccionar(aDatosBeneficiario(item.benef))}
      activeOpacity={0.6}
    >
      <Text style={styles.filaNombre}>{item.benef.nombre_completo || '—'}</Text>
      <Text style={styles.filaDetalle}>
        🪪 C.C. {item.benef.cedula}
        {item.benef.vereda ? `  ·  📍 ${item.benef.vereda}` : ''}
      </Text>
      {item.esActual ? (
        <Text style={styles.etiquetaBloqueo}>Beneficiario actual — ya tiene esta visita</Text>
      ) : item.yaTieneVisita ? (
        <Text style={styles.etiquetaBloqueo}>Ya tiene esta visita registrada</Text>
      ) : null}
    </TouchableOpacity>
  );

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCerrar}>
      <View style={styles.overlay}>
        <View style={styles.contenedor}>
          <View style={styles.header}>
            <Text style={styles.titulo}>Cambiar beneficiario</Text>
            <TouchableOpacity onPress={onCerrar} hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Text style={styles.cerrar}>✕</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.ayuda}>
            Elige el beneficiario al que realmente corresponden las fotos, videos y respuestas de este
            formulario. Todo lo diligenciado se conserva.
          </Text>
          <TextInput
            style={styles.buscador}
            value={busqueda}
            onChangeText={setBusqueda}
            placeholder="Buscar por nombre o cédula"
            placeholderTextColor={COLORS.textLight}
            autoCorrect={false}
          />
          {cargando ? (
            <ActivityIndicator style={{ marginVertical: SPACING.lg }} color={COLORS.primary} />
          ) : (
            <FlatList
              data={filas}
              keyExtractor={(f) => `${f.benef.item}-${f.benef.cedula}`}
              renderItem={renderFila}
              keyboardShouldPersistTaps="handled"
              style={styles.lista}
              ListEmptyComponent={
                <Text style={styles.vacio}>
                  {busqueda ? 'Ningún beneficiario coincide con la búsqueda.' : 'No hay beneficiarios en este dispositivo.'}
                </Text>
              }
            />
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'flex-end',
  },
  contenedor: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: BORDER_RADIUS.xl,
    borderTopRightRadius: BORDER_RADIUS.xl,
    maxHeight: '85%',
    paddingBottom: SPACING.md,
    ...SHADOWS.lg,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.lg,
    paddingBottom: SPACING.sm,
  },
  titulo: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  cerrar: {
    fontSize: FONTS.sizes.xl,
    color: COLORS.textLight,
    fontWeight: FONTS.weights.bold,
  },
  ayuda: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    paddingHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
  },
  buscador: {
    marginHorizontal: SPACING.lg,
    marginBottom: SPACING.sm,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
  },
  lista: {
    paddingHorizontal: SPACING.lg,
  },
  fila: {
    paddingVertical: SPACING.sm + 2,
    borderBottomWidth: 1,
    borderBottomColor: COLORS.divider,
  },
  filaBloqueada: {
    opacity: 0.6,
  },
  filaNombre: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  filaDetalle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  etiquetaBloqueo: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.error,
    marginTop: 2,
  },
  vacio: {
    textAlign: 'center',
    color: COLORS.textLight,
    marginVertical: SPACING.lg,
  },
});

export default SelectorBeneficiarioModal;
