// ============================================================
// GEODAILY — Firma Biométrica (Huella dactilar)
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as LocalAuthentication from 'expo-local-authentication';
import { useForm } from '../../store/FormContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';

type FirmaBiometricaScreenProps = {
  navigation: NativeStackNavigationProp<any>;
};

const FirmaBiometricaScreen: React.FC<FirmaBiometricaScreenProps> = ({ navigation }) => {
  const { setHuella, formularioActual } = useForm();
  const insets = useSafeAreaInsets();
  const [isBiometricAvailable, setIsBiometricAvailable] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(
    formularioActual?.huella_beneficiario || false
  );
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    checkBiometrics();
  }, []);

  const checkBiometrics = async () => {
    const compatible = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    setIsBiometricAvailable(compatible && enrolled);
  };

  const handleBiometricAuth = async () => {
    setIsLoading(true);
    try {
      const result = await LocalAuthentication.authenticateAsync({
        promptMessage: 'Coloca el dedo del beneficiario en el escáner',
        fallbackLabel: 'Usar código de acceso',
        cancelLabel: 'Cancelar',
        disableDeviceFallback: false,
      });

      if (result.success) {
        setIsAuthenticated(true);
        // NO guardar aún en FormContext — esperar a que el usuario presione "Guardar"
      } else {
        Alert.alert('Error', 'No se pudo autenticar la huella. Intenta de nuevo.');
      }
    } catch (error) {
      Alert.alert('Error', 'Error al acceder al sensor biométrico');
    } finally {
      setIsLoading(false);
    }
  };

  const handleGuardarHuella = () => {
    setHuella(true);
    Alert.alert('✅ Guardada', 'Huella del beneficiario guardada correctamente.');
  };

  const handleVolver = () => {
    const yaGuardada = formularioActual?.huella_beneficiario === true;
    if (isAuthenticated && !yaGuardada) {
      Alert.alert('Volver', 'La huella no se ha guardado. ¿Deseas descartarla?', [
        { text: 'Cancelar', style: 'cancel' },
        { text: 'Descartar', style: 'destructive', onPress: () => navigation.goBack() },
      ]);
    } else {
      navigation.goBack();
    }
  };

  return (
    <View style={[styles.container, { paddingBottom: insets.bottom + SPACING.lg }]}>
      <Text style={styles.title}>Registro Biométrico</Text>
      <Text style={styles.subtitle}>Huella dactilar del beneficiario</Text>

      <View style={styles.fingerprintContainer}>
        <Text style={styles.fingerprintIcon}>
          {isAuthenticated ? '✅' : '🖐️'}
        </Text>
        <Text style={styles.fingerprintText}>
          {isAuthenticated
            ? 'Huella registrada exitosamente'
            : 'Coloca el dedo del beneficiario en el escáner'}
        </Text>
      </View>

      {!isBiometricAvailable && (
        <View style={styles.warningBox}>
          <Text style={styles.warningText}>
            ⚠️ Este dispositivo no tiene sensor biométrico disponible o no hay huellas registradas.
            {'\n\n'}Puedes continuar sin la huella o registrarla más tarde en la configuración del dispositivo.
          </Text>
        </View>
      )}

      {!isAuthenticated && (
        <TouchableOpacity
          style={[styles.primaryButton, !isBiometricAvailable && styles.disabledButton]}
          onPress={handleBiometricAuth}
          disabled={isLoading}
        >
          <Text style={styles.primaryButtonText}>
            {isLoading ? 'Escaneando...' : 'Escanear Huella'}
          </Text>
        </TouchableOpacity>
      )}

      {isAuthenticated && (
        <>
          <TouchableOpacity
            style={styles.guardarButton}
            onPress={handleGuardarHuella}
          >
            <Text style={styles.guardarButtonText}>💾 Guardar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.secondaryButton}
            onPress={handleVolver}
          >
            <Text style={styles.secondaryButtonText}>Volver</Text>
          </TouchableOpacity>
        </>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: SPACING.lg,
  },
  title: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.xs,
  },
  subtitle: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  fingerprintContainer: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
    padding: SPACING.xl,
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.xl,
    ...SHADOWS.md,
  },
  fingerprintIcon: {
    fontSize: 64,
    marginBottom: SPACING.md,
  },
  fingerprintText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  warningBox: {
    backgroundColor: COLORS.warning + '15',
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.md,
    borderLeftWidth: 3,
    borderLeftColor: COLORS.warning,
  },
  warningText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.warning,
    lineHeight: 20,
  },
  primaryButton: {
    backgroundColor: COLORS.primary,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    marginBottom: SPACING.sm,
    ...SHADOWS.sm,
  },
  disabledButton: {
    opacity: 0.5,
  },
  primaryButtonText: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textOnPrimary,
  },
  guardarButton: {
    backgroundColor: COLORS.info,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    marginBottom: SPACING.sm,
    ...SHADOWS.sm,
  },
  guardarButtonText: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textOnPrimary,
  },
  secondaryButton: {
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: COLORS.border,
  },
  secondaryButtonText: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
});

export default FirmaBiometricaScreen;
