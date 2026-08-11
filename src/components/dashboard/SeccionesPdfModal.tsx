// ============================================================
// GEODAILY — Selector de secciones para el PDF del Dashboard
// ============================================================
// Antes de generar el reporte, deja elegir qué secciones incluir:
// las generales (métricas, técnico, corregimiento, actividades) y
// las de la Encuesta Social AgroAmbiental, sección por sección.
// ============================================================

import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import {
  SECCIONES_GENERAL_PDF,
  SECCIONES_ENCUESTA_PDF,
  TODAS_LAS_SECCIONES_PDF,
  DefinicionSeccionPdf,
} from '../../services/dashboardPdf.service';

interface SeccionesPdfModalProps {
  visible: boolean;
  onCancelar: () => void;
  onConfirmar: (secciones: string[]) => void;
}

const SeccionesPdfModal: React.FC<SeccionesPdfModalProps> = ({ visible, onCancelar, onConfirmar }) => {
  const [seleccion, setSeleccion] = useState<Set<string>>(new Set(TODAS_LAS_SECCIONES_PDF));

  useEffect(() => {
    if (visible) setSeleccion(new Set(TODAS_LAS_SECCIONES_PDF));
  }, [visible]);

  const alternar = (id: string) => {
    setSeleccion((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const todasMarcadas = seleccion.size === TODAS_LAS_SECCIONES_PDF.length;
  const alternarTodas = () => setSeleccion(todasMarcadas ? new Set() : new Set(TODAS_LAS_SECCIONES_PDF));

  const renderFila = (s: DefinicionSeccionPdf) => {
    const marcada = seleccion.has(s.id);
    return (
      <TouchableOpacity key={s.id} style={styles.fila} onPress={() => alternar(s.id)} activeOpacity={0.7}>
        <View style={[styles.casilla, marcada && styles.casillaMarcada]}>
          {marcada && <Text style={styles.check}>✓</Text>}
        </View>
        <Text style={styles.filaIcono}>{s.icono}</Text>
        <Text style={styles.filaTexto}>{s.titulo}</Text>
      </TouchableOpacity>
    );
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancelar}>
      <View style={styles.overlay}>
        <View style={styles.contenedor}>
          <Text style={styles.titulo}>¿Qué secciones incluyo en el PDF?</Text>
          <Text style={styles.subtitulo}>Marca las secciones que quieres exportar. Puedes elegirlas todas.</Text>

          <TouchableOpacity style={styles.seleccionarTodas} onPress={alternarTodas} activeOpacity={0.7}>
            <Text style={styles.seleccionarTodasTexto}>
              {todasMarcadas ? 'Deseleccionar todas' : 'Seleccionar todas'}
            </Text>
          </TouchableOpacity>

          <ScrollView style={styles.lista} showsVerticalScrollIndicator={false}>
            <Text style={styles.grupoTitulo}>General</Text>
            {SECCIONES_GENERAL_PDF.map(renderFila)}

            <Text style={styles.grupoTitulo}>Encuesta Social AgroAmbiental (Formulario 1)</Text>
            {SECCIONES_ENCUESTA_PDF.map(renderFila)}
          </ScrollView>

          <View style={styles.botones}>
            <TouchableOpacity style={[styles.boton, styles.botonCancelar]} onPress={onCancelar} activeOpacity={0.7}>
              <Text style={styles.botonCancelarTexto}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.boton, styles.botonGenerar, seleccion.size === 0 && styles.botonDeshabilitado]}
              onPress={() => seleccion.size > 0 && onConfirmar(Array.from(seleccion))}
              disabled={seleccion.size === 0}
              activeOpacity={0.7}
            >
              <Text style={styles.botonGenerarTexto}>Generar PDF</Text>
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
    marginBottom: SPACING.sm,
  },
  seleccionarTodas: {
    alignSelf: 'flex-start',
    marginBottom: SPACING.sm,
  },
  seleccionarTodasTexto: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.primary,
  },
  lista: {
    marginBottom: SPACING.md,
  },
  grupoTitulo: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textLight,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
    marginTop: SPACING.md,
    marginBottom: SPACING.xs,
  },
  fila: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: SPACING.xs + 2,
  },
  casilla: {
    width: 20,
    height: 20,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: COLORS.border,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: SPACING.sm,
  },
  casillaMarcada: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  check: {
    color: COLORS.textOnPrimary,
    fontSize: 12,
    fontWeight: FONTS.weights.bold,
  },
  filaIcono: {
    fontSize: 15,
    marginRight: SPACING.xs,
  },
  filaTexto: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textPrimary,
    flexShrink: 1,
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

export default SeccionesPdfModal;
