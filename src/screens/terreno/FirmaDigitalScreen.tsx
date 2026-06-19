// ============================================================
// GEODAILY — Firma del Técnico en Terreno (pantalla individual)
// ============================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useForm } from '../../store/FormContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import SignaturePad from '../../components/SignaturePad';

type Props = {
  navigation: NativeStackNavigationProp<any>;
};

const FirmaDigitalScreen: React.FC<Props> = ({ navigation }) => {
  const { setFirmaTecnico, formularioActual } = useForm();
  const insets = useSafeAreaInsets();

  const [firma, setFirmaLocal] = useState<string | null>(
    formularioActual?.firma_tecnico || null
  );
  const [mostrarPad, setMostrarPad] = useState(!firma);

  const handleFirmaOK = (signature: string) => {
    setFirmaLocal(signature);
    setMostrarPad(false);
  };

  const handleGuardar = () => {
    setFirmaTecnico(firma!);
    Alert.alert('✅ Guardada', 'Firma del técnico guardada correctamente.', [
      { text: 'OK', onPress: () => navigation.goBack() },
    ]);
  };

  const handleVolver = () => {
    if (firma) {
      Alert.alert('Volver', 'La firma se conservará. ¿Deseas volver?', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Volver', style: 'destructive', onPress: () => navigation.goBack() },
      ]);
    } else {
      navigation.goBack();
    }
  };

  return (
    <View style={styles.container}>
      <ScrollView contentContainerStyle={[styles.content, { paddingBottom: insets.bottom + SPACING.lg }]}>
        <View style={styles.headerRow}>
          <Text style={styles.title}>🖊️ Firma del Técnico</Text>
          {firma && (
            <View style={styles.statusBadge}>
              <Text style={styles.statusText}>✓ Lista</Text>
            </View>
          )}
        </View>
        <Text style={styles.subtitle}>
          El técnico debe firmar en el recuadro y presionar "Confirmar", luego guarda.
        </Text>

        {mostrarPad && !firma ? (
          <SignaturePad
            onOK={handleFirmaOK}
            description="Firma del técnico"
          />
        ) : firma ? (
          <>
            <View style={styles.firmaGuardada}>
              <Text style={styles.firmaGuardadaText}>✓ Firma del técnico registrada</Text>
            </View>
            <TouchableOpacity style={styles.contentGuardarBtn} onPress={handleGuardar}>
              <Text style={styles.contentGuardarBtnText}>💾 Guardar firma</Text>
            </TouchableOpacity>
          </>
        ) : (
          <TouchableOpacity
            style={styles.firmarButton}
            onPress={() => setMostrarPad(true)}
          >
            <Text style={styles.firmarButtonText}>✍️ Firmar ahora</Text>
          </TouchableOpacity>
        )}

      </ScrollView>

      <View style={[styles.bottomBar, { paddingBottom: insets.bottom + SPACING.sm }]}>
        {firma && (
          <TouchableOpacity style={styles.guardarButton} onPress={handleGuardar}>
            <Text style={styles.guardarButtonText}>💾 Guardar</Text>
          </TouchableOpacity>
        )}
        <TouchableOpacity style={styles.secondaryButton} onPress={handleVolver}>
          <Text style={styles.secondaryButtonText}>Volver</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  content: {
    padding: SPACING.lg,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: SPACING.xs,
  },
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
  },
  subtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginBottom: SPACING.lg,
    lineHeight: 20,
  },
  statusBadge: {
    backgroundColor: COLORS.success + '20',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
  },
  statusText: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.success,
  },
  firmaGuardada: {
    backgroundColor: COLORS.success + '15',
    padding: SPACING.lg,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.success,
    marginBottom: SPACING.sm,
  },
  firmaGuardadaText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.success,
  },
  firmarButton: {
    backgroundColor: COLORS.info + '20',
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.info,
    borderStyle: 'dashed',
  },
  firmarButtonText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.info,
  },
  contentGuardarBtn: {
    backgroundColor: COLORS.success,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    marginBottom: SPACING.sm,
    ...SHADOWS.md,
  },
  contentGuardarBtnText: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: '#FFFFFF',
  },
  guardarButton: {
    flex: 1,
    backgroundColor: COLORS.info,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    marginRight: SPACING.sm,
    ...SHADOWS.sm,
  },
  guardarButtonText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textOnPrimary,
  },
  bottomBar: {
    flexDirection: 'row',
    justifyContent: 'flex-start',
    paddingHorizontal: SPACING.lg,
    paddingTop: SPACING.sm,
    backgroundColor: COLORS.background,
    borderTopWidth: 1,
    borderTopColor: COLORS.border,
  },
  secondaryButton: {
    paddingHorizontal: SPACING.lg,
    paddingVertical: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  secondaryButtonText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    fontWeight: FONTS.weights.semibold,
  },
});

export default FirmaDigitalScreen;
