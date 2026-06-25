// ============================================================
// GEODAILY — Pantalla de Login
// ============================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  Alert,
  Image,
  ImageBackground,
} from 'react-native';
import { useAuth } from '../../store/AuthContext';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import LoadingSpinner from '../../components/LoadingSpinner';

const LoginScreen: React.FC = () => {
  const { login, isLoading, error } = useAuth();
  const [usuario, setUsuario] = useState('');
  const [contrasena, setContrasena] = useState('');

  const handleLogin = async () => {
    if (!usuario.trim()) {
      Alert.alert('Campo requerido', 'Por favor ingresa tu usuario');
      return;
    }
    if (!contrasena.trim()) {
      Alert.alert('Campo requerido', 'Por favor ingresa tu contraseña');
      return;
    }

    await login(usuario.trim(), contrasena);
  };

  return (
    <ImageBackground
      source={require('../../../assets/images/fondo_login_geo_daily.png')}
      style={styles.container}
      resizeMode="cover"
    >
      <View style={styles.overlay}>
        <KeyboardAvoidingView
          style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        >
          <ScrollView
            contentContainerStyle={styles.scrollContent}
            keyboardShouldPersistTaps="handled"
          >
            {/* Logo y título */}
            <View style={styles.header}>
              <View style={styles.logoContainer}>
                <Image
                  source={require('../../../assets/images/logo_geo_daily.png')}
                  style={styles.logoImage}
                  resizeMode="contain"
                />
              </View>
              <Text style={styles.title}>GEODAILY</Text>
              <Text style={styles.subtitle}>Gestión de Visitas Técnicas</Text>
            </View>

        {/* Formulario */}
        <View style={styles.formContainer}>
          <Text style={styles.formTitle}>Iniciar Sesión</Text>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Usuario</Text>
            <TextInput
              style={styles.input}
              placeholder="Ingresa tu usuario"
              placeholderTextColor={COLORS.textLight}
              value={usuario}
              onChangeText={setUsuario}
              autoCapitalize="none"
              autoCorrect={false}
              editable={!isLoading}
            />
          </View>

          <View style={styles.inputGroup}>
            <Text style={styles.label}>Contraseña</Text>
            <TextInput
              style={styles.input}
              placeholder="Ingresa tu contraseña"
              placeholderTextColor={COLORS.textLight}
              value={contrasena}
              onChangeText={setContrasena}
              secureTextEntry
              editable={!isLoading}
            />
          </View>

          {error && (
            <View style={styles.errorContainer}>
              <Text style={styles.errorText}>{error}</Text>
            </View>
          )}

          <TouchableOpacity
            style={[styles.loginButton, isLoading && styles.loginButtonDisabled]}
            onPress={handleLogin}
            disabled={isLoading}
          >
            {isLoading ? (
              <LoadingSpinner size="small" message="" />
            ) : (
              <Text style={styles.loginButtonText}>Ingresar</Text>
            )}
          </TouchableOpacity>
          </View>

          {/* Usuarios de prueba — solo visible en desarrollo */}
          {__DEV__ && (
            <View style={styles.testUsers}>
              <Text style={styles.testUsersTitle}>Usuarios de prueba:</Text>
              <Text style={styles.testUser}>Técnico: tecnico1 / 123456</Text>
              <Text style={styles.testUser}>Supervisor: supervisor1 / 123456</Text>
              <Text style={styles.testUser}>Gerente: gerente1 / 123456</Text>
              <Text style={styles.testUser}>Admin: admin1 / admin123</Text>
            </View>
          )}
        </ScrollView>
        </KeyboardAvoidingView>
      </View>
    </ImageBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  flex: {
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
  },
  scrollContent: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: SPACING.lg,
  },
  header: {
    alignItems: 'center',
    marginBottom: SPACING.xl,
  },
  logoContainer: {
    width: 180,
    height: 140,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  logoImage: {
    width: '100%',
    height: '100%',
  },
  title: {
    fontSize: FONTS.sizes.title,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textOnPrimary,
    letterSpacing: 2,
  },
  subtitle: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textOnPrimary + 'AA',
    marginTop: SPACING.xs,
  },
  formContainer: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.xl,
    padding: SPACING.lg,
    ...SHADOWS.lg,
  },
  formTitle: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.lg,
    textAlign: 'center',
  },
  inputGroup: {
    marginBottom: SPACING.md,
  },
  label: {
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.medium,
    color: COLORS.textSecondary,
    marginBottom: SPACING.xs,
  },
  input: {
    backgroundColor: COLORS.background,
    borderWidth: 1,
    borderColor: COLORS.border,
    borderRadius: BORDER_RADIUS.md,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm + 2,
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
  },
  errorContainer: {
    backgroundColor: COLORS.error + '15',
    padding: SPACING.sm,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.md,
  },
  errorText: {
    color: COLORS.error,
    fontSize: FONTS.sizes.sm,
    textAlign: 'center',
  },
  loginButton: {
    backgroundColor: COLORS.primary,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm + 4,
    alignItems: 'center',
    marginTop: SPACING.sm,
    ...SHADOWS.sm,
  },
  loginButtonDisabled: {
    backgroundColor: COLORS.primaryLight,
  },
  loginButtonText: {
    color: COLORS.textOnPrimary,
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
  },
  testUsers: {
    marginTop: SPACING.lg,
    alignItems: 'center',
  },
  testUsersTitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textOnPrimary + 'CC',
    marginBottom: SPACING.xs,
  },
  testUser: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textOnPrimary + 'AA',
    fontFamily: Platform.OS === 'ios' ? 'Courier' : 'monospace',
  },
});

export default LoginScreen;
