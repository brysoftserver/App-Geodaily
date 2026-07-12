// ============================================================
// GEODAILY — Firma Biométrica (Huella dactilar)
// Soporta: sensor biométrico del dispositivo + scanner externo USB-C
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Alert,
  ScrollView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import * as LocalAuthentication from 'expo-local-authentication';
import { useForm } from '../../store/FormContext';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';

type ScannerTipo = 'dispositivo' | 'usb_externo';

type FirmaBiometricaScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
};

const FirmaBiometricaScreen: React.FC<FirmaBiometricaScreenProps> = ({ navigation }) => {
  const { setHuella, formularioActual } = useForm();
  const insets = useSafeAreaInsets();

  // Estado
  const [scannerTipo, setScannerTipo] = useState<ScannerTipo>('dispositivo');
  const [isBiometricAvailable, setIsBiometricAvailable] = useState(false);
  const [isScannerUSBConectado, setIsScannerUSBConectado] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(
    formularioActual?.huella_beneficiario || false
  );
  const [isLoading, setIsLoading] = useState(false);
  const [usbStatus, setUsbStatus] = useState<string>('');

  useEffect(() => {
    checkBiometrics();
    checkUSBScanner();
  }, []);

  // Detectar si el dispositivo tiene sensor biométrico
  const checkBiometrics = async () => {
    try {
      const compatible = await LocalAuthentication.hasHardwareAsync();
      const enrolled = await LocalAuthentication.isEnrolledAsync();
      setIsBiometricAvailable(compatible && enrolled);
    } catch (e) {
      console.warn('[Biometric] Error checking biometrics:', e);
      setIsBiometricAvailable(false);
    }
  };

  // Detectar scanner USB externo conectado
  // NOTA: La detección nativa requiere un módulo nativo personalizado.
  // Este es un placeholder que intenta detectar el dispositivo vía
  // conexión serial USB. Para implementación completa, crear un
  // módulo nativo (Android: UsbManager, iOS: external accessory)
  const checkUSBScanner = async () => {
    try {
      // En Android, los scanners USB-C suelen aparecer como
      // dispositivos HID o dispositivos serial (CDC ACM).
      // La detección nativa requiere:
      //   - Android: UsbManager.getDeviceList() + filtro por vendorId/productId
      //   - iOS: No soporta escáneres externos por USB-C
      //
      // Valores típicos de vendorId para scanners de huella:
      //   - DigitalPersona/U.are.U: 0x05BA
      //   - Futronic: 0x1C7A
      //   - SecuGen: 0x1CBE
      //   - Nitgen: 0x1ACB

      // Placeholder: por ahora asumimos que no hay scanner externo
      setIsScannerUSBConectado(false);

      // ---- IMPLEMENTACIÓN FUTURA ----
      // Cuando exista el módulo nativo, este flujo detectará
      // automáticamente el scanner USB-C:
      //
      // const { isConnected, deviceName } = await UsbFingerprintScanner.detectScanner();
      // setIsScannerUSBConectado(isConnected);
      // if (isConnected) {
      //   setUsbStatus(`🔌 Scanner detectado: ${deviceName}`);
      //   setScannerTipo('usb_externo');
      // }
    } catch (e) {
      console.warn('[Biometric] Error checking USB scanner:', e);
      setIsScannerUSBConectado(false);
    }
  };

  // Autenticar con sensor del dispositivo (expo-local-authentication)
  const handleDeviceBiometric = async () => {
    if (!isBiometricAvailable) {
      Alert.alert(
        'No disponible',
        'Este dispositivo no tiene sensor biométrico o no hay huellas registradas. Ve a Ajustes > Seguridad > Huella para registrar.'
      );
      return;
    }

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
      } else {
        if (result.error === 'user_cancel') return;
        Alert.alert('Error', 'No se pudo autenticar la huella. Intenta de nuevo.');
      }
    } catch (error) {
      Alert.alert('Error', 'Error al acceder al sensor biométrico');
    } finally {
      setIsLoading(false);
    }
  };

  // Autenticar con scanner externo USB-C
  // NOTA: Requiere módulo nativo personalizado
  const handleUSBScannerAuth = async () => {
    setIsLoading(true);
    setUsbStatus('⏳ Conectando con scanner USB...');

    try {
      // ---- IMPLEMENTACIÓN FUTURA ----
      // Cuando exista el módulo nativo:
      //
      // const { UsbFingerprintScanner } = require('react-native-usb-fingerprint');
      // const result = await UsbFingerprintScanner.scan({
      //   timeout: 30000,
      //   quality: 80, // calidad mínima de la huella
      // });
      //
      // if (result.success) {
      //   setIsAuthenticated(true);
      //   setUsbStatus('✅ Huella verificada por scanner USB');
      //   // result.template contiene la plantilla de la huella (opcional)
      // } else {
      //   setUsbStatus('❌ Error de autenticación');
      //   Alert.alert('Error', result.message || 'No se pudo verificar la huella');
      // }

      // Placeholder: simular escaneo USB
      await new Promise(resolve => setTimeout(resolve, 1500));
      Alert.alert(
        'Scanner USB no implementado',
        'El scanner de huella USB-C requiere un módulo nativo. Por ahora usa el sensor del dispositivo o continúa sin huella.',
        [
          { text: 'Usar sensor del dispositivo', onPress: () => setScannerTipo('dispositivo') },
          { text: 'Cancelar', style: 'cancel' },
        ]
      );
      setUsbStatus('');
    } catch (error) {
      console.error('[Biometric] Error en scanner USB:', error);
      setUsbStatus('❌ Error de comunicación con el scanner');
      Alert.alert('Error', 'Error al comunicarse con el scanner USB');
    } finally {
      setIsLoading(false);
    }
  };

  // Ejecutar escaneo según el tipo de scanner seleccionado
  const handleScan = () => {
    if (scannerTipo === 'usb_externo') {
      handleUSBScannerAuth();
    } else {
      handleDeviceBiometric();
    }
  };

  // Guardar huella en FormContext
  const handleGuardarHuella = () => {
    setHuella(true);
    Alert.alert('✅ Guardada', 'Huella del beneficiario guardada correctamente.');
  };

  // Volver con confirmación si hay cambios sin guardar
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
      <ScrollView
        style={styles.scrollContainer}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={true}
      >
        <Text style={styles.title}>Registro Biométrico</Text>
        <Text style={styles.subtitle}>Huella dactilar del beneficiario</Text>

        {/* Selector de tipo de scanner */}
        <View style={styles.scannerSelector}>
          <Text style={styles.scannerSelectorLabel}>🔌 Método de escaneo:</Text>
          <View style={styles.scannerOptions}>
            <TouchableOpacity
              style={[styles.scannerOption, scannerTipo === 'dispositivo' && styles.scannerOptionActive]}
              onPress={() => setScannerTipo('dispositivo')}
            >
              <Text style={styles.scannerOptionIcon}>📱</Text>
              <Text style={[styles.scannerOptionText, scannerTipo === 'dispositivo' && styles.scannerOptionTextActive]}>
                Sensor del dispositivo
              </Text>
              {isBiometricAvailable && (
                <Text style={styles.scannerOptionBadge}>✅</Text>
              )}
            </TouchableOpacity>

            <TouchableOpacity
              style={[
                styles.scannerOption,
                scannerTipo === 'usb_externo' && styles.scannerOptionActive,
                !isScannerUSBConectado && styles.scannerOptionDisabled,
              ]}
              onPress={() => {
                if (!isScannerUSBConectado) {
                  Alert.alert(
                    'Scanner USB no detectado',
                    'Conecta el scanner de huella por USB-C y asegúrate de que el dispositivo sea compatible. Si ya lo conectaste, reinicia la app.'
                  );
                  return;
                }
                setScannerTipo('usb_externo');
              }}
            >
              <Text style={styles.scannerOptionIcon}>🔌</Text>
              <Text style={[styles.scannerOptionText, scannerTipo === 'usb_externo' && styles.scannerOptionTextActive]}>
                Scanner USB-C externo
              </Text>
              {isScannerUSBConectado ? (
                <Text style={styles.scannerOptionBadge}>✅</Text>
              ) : (
                <Text style={styles.scannerOptionBadgeOff}>⚠️</Text>
              )}
            </TouchableOpacity>
          </View>
          {usbStatus ? (
            <Text style={styles.usbStatusText}>{usbStatus}</Text>
          ) : null}
          {!isScannerUSBConectado && scannerTipo === 'usb_externo' && (
            <Text style={styles.usbHintText}>
              💡 Conecta el scanner por USB-C. Si usas un adaptador OTG, asegúrate de que sea compatible.
            </Text>
          )}
          {scannerTipo === 'dispositivo' && !isBiometricAvailable && (
            <Text style={styles.usbHintText}>
              💡 Si tu tablet tiene un scanner USB-C, selecciona &ldquo;Scanner USB-C externo&rdquo; arriba.
            </Text>
          )}
        </View>

        {/* Estado de la huella */}
        <View style={styles.fingerprintContainer}>
          <Text style={styles.fingerprintIcon}>
            {isAuthenticated ? '✅' : isLoading ? '⏳' : '🖐️'}
          </Text>
          <Text style={styles.fingerprintText}>
            {isLoading
              ? 'Escaneando...'
              : isAuthenticated
                ? 'Huella registrada exitosamente'
                : 'Coloca el dedo del beneficiario en el escáner'}
          </Text>
        </View>

        {/* Advertencia si no hay biometría disponible */}
        {scannerTipo === 'dispositivo' && !isBiometricAvailable && !isAuthenticated && (
          <View style={styles.warningBox}>
            <Text style={styles.warningText}>
              ⚠️ Este dispositivo no tiene sensor biométrico disponible o no hay huellas registradas en el sistema.
              {'\n\n'}Puedes continuar sin la huella o intentar con un scanner USB-C externo.
            </Text>
          </View>
        )}

        {/* Botón de escaneo */}
        {!isAuthenticated && (
          <TouchableOpacity
            style={[
              styles.primaryButton,
              (isLoading) && styles.disabledButton,
            ]}
            onPress={handleScan}
            disabled={isLoading}
          >
            <Text style={styles.primaryButtonText}>
              {isLoading
                ? '⏳ Escaneando...'
                : scannerTipo === 'usb_externo'
                  ? '🔌 Escanear con scanner USB'
                  : '🖐️ Escanear Huella'}
            </Text>
          </TouchableOpacity>
        )}

        {!isAuthenticated && !isLoading && (
          <TouchableOpacity
            style={styles.skipButton}
            onPress={() => navigation.goBack()}
          >
            <Text style={styles.skipButtonText}>Omitir huella</Text>
          </TouchableOpacity>
        )}

        {/* Botones Guardar / Volver */}
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
      </ScrollView>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
    padding: SPACING.lg,
  },
  scrollContainer: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: SPACING.xxl,
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
  // ---- Selector de scanner ----
  scannerSelector: {
    marginBottom: SPACING.lg,
  },
  scannerSelectorLabel: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  scannerOptions: {
    flexDirection: 'row',
    gap: SPACING.sm,
  },
  scannerOption: {
    flex: 1,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    backgroundColor: COLORS.surface,
    borderWidth: 2,
    borderColor: COLORS.border,
    alignItems: 'center',
    position: 'relative',
  },
  scannerOptionActive: {
    borderColor: COLORS.primary,
    backgroundColor: COLORS.surfaceAlt,
  },
  scannerOptionDisabled: {
    opacity: 0.5,
  },
  scannerOptionIcon: {
    fontSize: 24,
    marginBottom: SPACING.xs,
  },
  scannerOptionText: {
    fontSize: FONTS.sizes.xs,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textSecondary,
    textAlign: 'center',
  },
  scannerOptionTextActive: {
    color: COLORS.primary,
    fontWeight: FONTS.weights.bold,
  },
  scannerOptionBadge: {
    position: 'absolute',
    top: 4,
    right: 4,
    fontSize: 12,
  },
  scannerOptionBadgeOff: {
    position: 'absolute',
    top: 4,
    right: 4,
    fontSize: 12,
  },
  usbStatusText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.info,
    marginTop: SPACING.xs,
    textAlign: 'center',
  },
  usbHintText: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
    marginTop: SPACING.xs,
    fontStyle: 'italic',
    textAlign: 'center',
  },
  // ---- Huella ----
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
  skipButton: {
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    alignItems: 'center',
    marginBottom: SPACING.lg,
  },
  skipButtonText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textLight,
    textDecorationLine: 'underline',
  },
});

export default FirmaBiometricaScreen;
