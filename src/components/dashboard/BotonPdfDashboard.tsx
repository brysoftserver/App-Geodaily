// ============================================================
// GEODAILY — Botón "PDF" del Dashboard
// ============================================================

import React, { useState } from 'react';
import { TouchableOpacity, Text, View, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { generarYAbrirReporteDashboard, DatosReporteDashboard } from '../../services/dashboardPdf.service';
import SeccionesPdfModal from './SeccionesPdfModal';

interface BotonPdfDashboardProps {
  datos: Omit<DatosReporteDashboard, 'secciones'>;
}

const BotonPdfDashboard: React.FC<BotonPdfDashboardProps> = ({ datos }) => {
  const [generando, setGenerando] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  const handleGenerar = async (secciones: string[]) => {
    setModalVisible(false);
    setGenerando(true);
    try {
      await generarYAbrirReporteDashboard({ ...datos, secciones });
    } catch (error: any) {
      console.warn('[Dashboard PDF] Error generando el reporte:', error?.message || error);
      Alert.alert('No se pudo generar el PDF', 'Ocurrió un error generando el reporte. Inténtalo de nuevo.');
    } finally {
      setGenerando(false);
    }
  };

  return (
    <>
      <TouchableOpacity
        style={styles.boton}
        onPress={() => setModalVisible(true)}
        disabled={generando}
        activeOpacity={0.7}
      >
        {generando ? (
          <View style={styles.generandoFila}>
            <ActivityIndicator size="small" color={COLORS.textOnPrimary} />
            <Text style={styles.texto}>Generando…</Text>
          </View>
        ) : (
          <Text style={styles.texto}>📄 PDF</Text>
        )}
      </TouchableOpacity>
      <SeccionesPdfModal
        visible={modalVisible}
        onCancelar={() => setModalVisible(false)}
        onConfirmar={handleGenerar}
      />
    </>
  );
};

const styles = StyleSheet.create({
  boton: {
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    minWidth: 76,
    minHeight: 34,
    alignItems: 'center',
    justifyContent: 'center',
    ...SHADOWS.sm,
  },
  generandoFila: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.xs,
  },
  texto: {
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.semibold,
    fontSize: FONTS.sizes.sm,
  },
});

export default BotonPdfDashboard;
