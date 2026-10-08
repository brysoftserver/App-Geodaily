// ============================================================
// GEODAILY — Realizar Seguimiento (Coordinación / Interventoría)
// ============================================================
// Pantalla completa del formulario de seguimiento: aporta el
// KeyboardAvoidingView + ScrollView y delega TODO el formulario (campos,
// Cuadro de Evidencias, Ubicación, guardado y autoguardado offline) al
// componente compartido SeguimientoCoordinacionSection — el mismo que se
// incrusta al final del detalle de un formulario en modo "campo", para no
// duplicar la lógica en dos lugares.
// ============================================================

import React from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet } from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS, SPACING } from '../../theme';
import SeguimientoCoordinacionSection from '../../components/SeguimientoCoordinacionSection';

type SeguimientoFormScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
  route?: { params?: { seguimientoId?: string } };
};

const SeguimientoFormScreen: React.FC<SeguimientoFormScreenProps> = ({ navigation, route }) => (
  <KeyboardAvoidingView style={styles.container} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView style={styles.scroll} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
      <SeguimientoCoordinacionSection
        seguimientoId={route?.params?.seguimientoId}
        onGuardado={() => navigation.goBack()}
      />
    </ScrollView>
  </KeyboardAvoidingView>
);

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scroll: {
    flex: 1,
  },
  content: {
    padding: SPACING.lg,
    paddingBottom: SPACING.xxl,
  },
});

export default SeguimientoFormScreen;
