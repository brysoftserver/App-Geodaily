// ============================================================
// GEODAILY — Selector de visita(s) para el informe PDF por técnico
// ============================================================
// Antes de generar el informe de un técnico, deja elegir qué ronda de
// visita incluir (Visita 1..12) o todas de una vez.
// ============================================================

import React, { useEffect, useState } from 'react';
import { Modal, View, Text, StyleSheet, TouchableOpacity, ScrollView } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { NUMEROS_VISITA_INFORME_TECNICO } from '../../services/informeTecnicoPdf.service';

interface SeleccionVisitaPdfModalProps {
  visible: boolean;
  tecnicoNombre: string;
  onCancelar: () => void;
  onConfirmar: (numerosVisita: number[]) => void;
}

const SeleccionVisitaPdfModal: React.FC<SeleccionVisitaPdfModalProps> = ({
  visible,
  tecnicoNombre,
  onCancelar,
  onConfirmar,
}) => {
  const [seleccion, setSeleccion] = useState<number | 'todas' | null>(null);

  useEffect(() => {
    if (visible) setSeleccion(null);
  }, [visible]);

  const confirmar = () => {
    if (seleccion === null) return;
    onConfirmar(seleccion === 'todas' ? NUMEROS_VISITA_INFORME_TECNICO : [seleccion]);
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onCancelar}>
      <View style={styles.overlay}>
        <View style={styles.contenedor}>
          <Text style={styles.titulo}>Informe de visitas — {tecnicoNombre}</Text>
          <Text style={styles.subtitulo}>¿De cuál visita quieres el informe?</Text>

          <TouchableOpacity
            style={[styles.opcionTodas, seleccion === 'todas' && styles.opcionMarcada]}
            onPress={() => setSeleccion('todas')}
            activeOpacity={0.7}
          >
            <Text style={[styles.opcionTodasTexto, seleccion === 'todas' && styles.opcionTextoMarcado]}>
              Todas las visitas (1 al 12)
            </Text>
          </TouchableOpacity>

          <ScrollView style={styles.lista} showsVerticalScrollIndicator={false}>
            <View style={styles.grid}>
              {NUMEROS_VISITA_INFORME_TECNICO.map((n) => {
                const marcada = seleccion === n;
                return (
                  <TouchableOpacity
                    key={n}
                    style={[styles.celda, marcada && styles.opcionMarcada]}
                    onPress={() => setSeleccion(n)}
                    activeOpacity={0.7}
                  >
                    <Text style={[styles.celdaTexto, marcada && styles.opcionTextoMarcado]}>Visita {n}</Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </ScrollView>

          <View style={styles.botones}>
            <TouchableOpacity style={[styles.boton, styles.botonCancelar]} onPress={onCancelar} activeOpacity={0.7}>
              <Text style={styles.botonCancelarTexto}>Cancelar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.boton, styles.botonGenerar, seleccion === null && styles.botonDeshabilitado]}
              onPress={confirmar}
              disabled={seleccion === null}
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
    marginBottom: SPACING.md,
  },
  opcionTodas: {
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm + 2,
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  opcionTodasTexto: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  lista: {
    marginBottom: SPACING.md,
  },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
  },
  celda: {
    width: '30%',
    borderWidth: 1.5,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
  },
  celdaTexto: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textPrimary,
  },
  opcionMarcada: {
    backgroundColor: COLORS.primary,
    borderColor: COLORS.primary,
  },
  opcionTextoMarcado: {
    color: COLORS.textOnPrimary,
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

export default SeleccionVisitaPdfModal;
