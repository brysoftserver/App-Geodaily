// ============================================================
// GEODAILY — Botón "PDF" del Dashboard
// ============================================================

import React, { useState } from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { generarYAbrirReporteDashboard, DatosReporteDashboard } from '../../services/dashboardPdf.service';

interface BotonPdfDashboardProps {
  datos: DatosReporteDashboard;
}

const BotonPdfDashboard: React.FC<BotonPdfDashboardProps> = ({ datos }) => {
  const [generando, setGenerando] = useState(false);

  const handlePress = async () => {
    if (generando) return;
    setGenerando(true);
    try {
      await generarYAbrirReporteDashboard(datos);
    } catch (error: any) {
      console.warn('[Dashboard PDF] Error generando el reporte:', error?.message || error);
      Alert.alert('No se pudo generar el PDF', 'Ocurrió un error generando el reporte. Inténtalo de nuevo.');
    } finally {
      setGenerando(false);
    }
  };

  return (
    <TouchableOpacity style={styles.boton} onPress={handlePress} disabled={generando} activeOpacity={0.7}>
      {generando ? (
        <ActivityIndicator size="small" color={COLORS.textOnPrimary} />
      ) : (
        <Text style={styles.texto}>📄 PDF</Text>
      )}
    </TouchableOpacity>
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
  texto: {
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.semibold,
    fontSize: FONTS.sizes.sm,
  },
});

export default BotonPdfDashboard;
