// ============================================================
// GEODAILY — Botón "PDF" de la tarjeta de técnico (informe de visitas)
// ============================================================

import React, { useState } from 'react';
import { TouchableOpacity, Text, View, StyleSheet, ActivityIndicator, Alert } from 'react-native';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { generarYAbrirInformeTecnico, DatosInformeTecnico } from '../../services/informeTecnicoPdf.service';
import SeleccionVisitaPdfModal from './SeleccionVisitaPdfModal';

interface BotonPdfTecnicoProps {
  datos: Omit<DatosInformeTecnico, 'numerosVisita'>;
}

const BotonPdfTecnico: React.FC<BotonPdfTecnicoProps> = ({ datos }) => {
  const [generando, setGenerando] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);

  const handleGenerar = async (numerosVisita: number[]) => {
    setModalVisible(false);
    setGenerando(true);
    try {
      await generarYAbrirInformeTecnico({ ...datos, numerosVisita });
    } catch (error: any) {
      console.warn('[PDF Técnico] Error generando el informe:', error?.message || error);
      Alert.alert('No se pudo generar el PDF', 'Ocurrió un error generando el informe. Inténtalo de nuevo.');
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
      <SeleccionVisitaPdfModal
        visible={modalVisible}
        tecnicoNombre={datos.tecnicoNombre}
        onCancelar={() => setModalVisible(false)}
        onConfirmar={handleGenerar}
      />
    </>
  );
};

const styles = StyleSheet.create({
  boton: {
    backgroundColor: COLORS.error,
    borderRadius: BORDER_RADIUS.full,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    minWidth: 76,
    minHeight: 32,
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
    fontSize: FONTS.sizes.xs,
  },
});

export default BotonPdfTecnico;
