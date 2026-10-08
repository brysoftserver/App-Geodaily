// ============================================================
// GEODAILY — Selector de persona para descargar el cronograma en Excel
// ============================================================
// Antes de exportar el cronograma de otra persona, deja elegir a un solo
// técnico, coordinador o interventor de la lista (roles superiores). El
// propio técnico nunca ve este modal: descarga directo su propio cronograma.

import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../theme';
import { PersonalCronograma } from '../services/admin.service';

interface CronogramaPersonalModalProps {
  visible: boolean;
  cargando: boolean;
  personal: PersonalCronograma[];
  /** Texto del rango a exportar, ej. "Mes de septiembre 2025 (01 al 30)". */
  rangoTexto: string;
  onCancelar: () => void;
  onConfirmar: (personas: PersonalCronograma[]) => void;
}

const TITULO_GRUPO: Record<PersonalCronograma['rol'], string> = {
  tecnico: 'Técnicos',
  coordinador: 'Coordinadores',
  interventor: 'Interventores',
};

const CronogramaPersonalModal: React.FC<CronogramaPersonalModalProps> = ({
  visible,
  cargando,
  personal,
  rangoTexto,
  onCancelar,
  onConfirmar,
}) => {
  const [seleccionIds, setSeleccionIds] = useState<string[]>([]);

  useEffect(() => {
    if (visible) setSeleccionIds([]);
  }, [visible]);

  const alternar = (id: string) => {
    setSeleccionIds((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  };

  const todosSeleccionados = personal.length > 0 && seleccionIds.length === personal.length;
  const alternarTodos = () => {
    setSeleccionIds(todosSeleccionados ? [] : personal.map((p) => p.id));
  };

  const confirmar = () => {
    const personas = personal.filter((p) => seleccionIds.includes(p.id));
    if (personas.length === 0) return;
    onConfirmar(personas);
  };

  const grupos: PersonalCronograma['rol'][] = ['tecnico', 'coordinador', 'interventor'];

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancelar}>
      <View style={styles.overlay}>
        <View style={styles.contenedor}>
          <Text style={styles.titulo}>Descargar Cronograma — Excel</Text>
          <Text style={styles.subtitulo}>
            Marca quiénes quieres ver en el reporte del mes.{rangoTexto ? `\n${rangoTexto}` : ''}
          </Text>

          {cargando ? (
            <ActivityIndicator size="large" color={COLORS.primary} style={{ marginVertical: SPACING.xl }} />
          ) : (
            <ScrollView style={styles.lista} showsVerticalScrollIndicator={false}>
              {personal.length > 0 && (
                <TouchableOpacity
                  style={styles.opcionTodos}
                  onPress={alternarTodos}
                  activeOpacity={0.7}
                >
                  <View style={[styles.casilla, todosSeleccionados && styles.casillaMarcada]}>
                    {todosSeleccionados && <Text style={styles.casillaCheck}>✓</Text>}
                  </View>
                  <Text style={styles.opcionTodosTexto}>
                    {todosSeleccionados ? 'Quitar selección' : 'Seleccionar todos'}
                  </Text>
                </TouchableOpacity>
              )}
              {grupos.map((rol) => {
                const personasDelGrupo = personal.filter((p) => p.rol === rol);
                if (personasDelGrupo.length === 0) return null;
                return (
                  <View key={rol} style={styles.grupo}>
                    <Text style={styles.grupoTitulo}>{TITULO_GRUPO[rol]}</Text>
                    {personasDelGrupo.map((p) => {
                      const marcada = seleccionIds.includes(p.id);
                      return (
                        <TouchableOpacity
                          key={p.id}
                          style={[styles.opcion, marcada && styles.opcionMarcada]}
                          onPress={() => alternar(p.id)}
                          activeOpacity={0.7}
                        >
                          <View style={[styles.casilla, marcada && styles.casillaMarcada]}>
                            {marcada && <Text style={styles.casillaCheck}>✓</Text>}
                          </View>
                          <Text style={[styles.opcionTexto, marcada && styles.opcionTextoMarcado]}>
                            {p.nombre}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                );
              })}
            </ScrollView>
          )}

          <View style={styles.botones}>
            <TouchableOpacity style={[styles.boton, styles.botonCancelar]} onPress={onCancelar} activeOpacity={0.7}>
              <Text style={styles.botonCancelarTexto}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.boton, styles.botonGenerar, seleccionIds.length === 0 && styles.botonDeshabilitado]}
              onPress={confirmar}
              disabled={seleccionIds.length === 0}
              activeOpacity={0.7}
            >
              <Text style={styles.botonGenerarTexto}>
                {seleccionIds.length > 1 ? `Descargar (${seleccionIds.length})` : 'Descargar'}
              </Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  contenedor: {
    backgroundColor: COLORS.surface,
    borderTopLeftRadius: BORDER_RADIUS.lg,
    borderTopRightRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    maxHeight: '85%',
    ...SHADOWS.md,
  },
  titulo: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  subtitulo: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 2,
    marginBottom: SPACING.md,
  },
  lista: {
    marginBottom: SPACING.md,
  },
  grupo: {
    marginBottom: SPACING.md,
  },
  grupoTitulo: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  opcionTodos: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.xs,
    marginBottom: SPACING.sm,
  },
  opcionTodosTexto: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.primary,
  },
  opcion: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm + 2,
    paddingHorizontal: SPACING.md,
    marginBottom: SPACING.xs,
  },
  opcionTexto: {
    flex: 1,
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  opcionMarcada: {
    backgroundColor: COLORS.primary + '14',
    borderColor: COLORS.primary,
  },
  opcionTextoMarcado: {
    color: COLORS.primary,
    fontWeight: FONTS.weights.semibold,
  },
  casilla: {
    width: 20,
    height: 20,
    borderRadius: BORDER_RADIUS.sm,
    borderWidth: 1.5,
    borderColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  casillaMarcada: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  casillaCheck: {
    color: COLORS.textOnPrimary,
    fontSize: 12,
    fontWeight: FONTS.weights.bold,
  },
  botones: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  boton: {
    flex: 1,
    borderRadius: BORDER_RADIUS.full,
    paddingVertical: SPACING.sm + 2,
    alignItems: 'center',
  },
  botonCancelar: {
    backgroundColor: COLORS.background,
  },
  botonCancelarTexto: {
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.semibold,
    fontSize: FONTS.sizes.sm,
  },
  botonGenerar: {
    backgroundColor: COLORS.primary,
  },
  botonDeshabilitado: {
    opacity: 0.5,
  },
  botonGenerarTexto: {
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.semibold,
    fontSize: FONTS.sizes.sm,
  },
});

export default CronogramaPersonalModal;
