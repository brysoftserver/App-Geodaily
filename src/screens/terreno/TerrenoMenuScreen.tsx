// ============================================================
// GEODAILY — Menú Principal Técnico de Campo
// ============================================================

import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  Alert,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useAuth } from '../../store/AuthContext';
import { useOfflineSync } from '../../hooks/useOfflineSync';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';

type TerrenoMenuProps = {
  navigation: NativeStackNavigationProp<any>;
};

const MENU_ITEMS = [
  {
    id: 'formulario',
    title: 'Diligenciar Formulario',
    subtitle: 'Capturar visita técnica o plantación',
    icon: '📋',
    color: COLORS.primary,
    screen: 'SeleccionarTipoFormulario',
  },
  {
    id: 'mapa',
    title: 'Mapa y Ubicación',
    subtitle: 'Mapa interactivo con GPS y mediciones',
    icon: '🗺️',
    color: COLORS.success,
    screen: 'TerrenoMapa',
  },
  {
    id: 'listado',
    title: 'Listado de Formularios',
    subtitle: 'Historial y PDFs generados',
    icon: '📄',
    color: COLORS.info,
    screen: 'TerrenoFormularioList',
  },
  {
    id: 'calendario',
    title: 'Calendario',
    subtitle: 'Visitas realizadas y pendientes',
    icon: '📅',
    color: COLORS.secondary,
    screen: 'TerrenoCalendario',
  },
  {
    id: 'ruta',
    title: 'Mi Ruta',
    subtitle: 'Tracking GPS en tiempo real',
    icon: '🛣️',
    color: COLORS.success,
    screen: 'TerrenoMiRuta',
  },
  {
    id: 'capacitacion',
    title: 'Capacitaciones',
    subtitle: 'Guias y material de formación',
    icon: '📚',
    color: COLORS.info,
    screen: 'TerrenoCapacitacion',
  },
  {
    id: 'cerrar',
    title: 'Cerrar Sesión',
    subtitle: 'Salir de la aplicación',
    icon: '🚪',
    color: COLORS.error,
    screen: null,
  },
];

const TerrenoMenuScreen: React.FC<TerrenoMenuProps> = ({ navigation }) => {
  const { user, logout } = useAuth();
  const insets = useSafeAreaInsets();
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  // Cargar avatar guardado
  useEffect(() => {
    const loadAvatar = async () => {
      try {
        const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
        const savedAvatar = await AsyncStorage.getItem('@geodaily/avatar_uri');
        if (savedAvatar) setAvatarUri(savedAvatar);
      } catch {}
    };
    loadAvatar();
  }, []);

  const handleAvatarPress = async () => {
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        Alert.alert(
          'Permiso requerido',
          'Necesitamos acceso a tu galería para cambiar la foto de perfil.'
        );
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.7,
      });

      if (!result.canceled && result.assets[0]) {
        const uri = result.assets[0].uri;
        setAvatarUri(uri);
        // Persistir la URI
        try {
          const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
          await AsyncStorage.setItem('@geodaily/avatar_uri', uri);
        } catch {}
      }
    } catch (error) {
      console.warn('Error al seleccionar imagen:', error);
    }
  };

  const handlePress = (item: (typeof MENU_ITEMS)[0]) => {
    if (item.id === 'cerrar') {
      logout();
    } else {
      navigation.navigate(item.screen as string);
    }
  };

  // Obtener cédula del usuario
  const cedula = (user as any)?.cedula || '';

  const { syncNow, status, pendingCount, lastSync } = useOfflineSync();
  const isSyncing = status === 'syncing';

  return (
    <SafeAreaView style={styles.safeContainer} edges={['top']}>
    <ScrollView
      style={styles.container}
      contentContainerStyle={[styles.scrollContent, { paddingBottom: insets.bottom + SPACING.xl }]}
      showsVerticalScrollIndicator={false}
    >
      {/* Encabezado */}
      <View style={[styles.header, { paddingTop: Math.max(insets.top, SPACING.xxl) }]}>
        <TouchableOpacity onPress={handleAvatarPress} activeOpacity={0.7}>
          <View style={styles.avatar}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>
                {user?.nombre?.charAt(0)?.toUpperCase() || 'U'}
              </Text>
            )}
            <View style={styles.cameraIcon}>
              <Text style={styles.cameraIconText}>📷</Text>
            </View>
          </View>
        </TouchableOpacity>
        <Text style={styles.welcomeText}>Bienvenido,</Text>
        <Text style={styles.userName}>{user?.nombre || 'Usuario'}</Text>
        {cedula ? (
          <Text style={styles.userCedula}>C.C. {cedula}</Text>
        ) : null}
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>Técnico de Campo</Text>
        </View>
      </View>

      {/* Estado de sincronización */}
      <View style={styles.syncCard}>
        <View style={styles.syncHeader}>
          <Text style={styles.syncTitle}>
            {isSyncing ? '🔄 Sincronizando...' : '📤 Sincronización'}
          </Text>
          {pendingCount > 0 && (
            <View style={styles.pendingSyncBadge}>
              <Text style={styles.pendingSyncText}>{pendingCount}</Text>
            </View>
          )}
        </View>
        <Text style={styles.syncSubtitle}>
          {pendingCount === 0
            ? '✅ No hay formularios pendientes'
            : `⏳ ${pendingCount} formulario(s) por sincronizar`}
        </Text>
        {lastSync && (
          <Text style={styles.syncLast}>
            Última sincronización: {new Date(lastSync).toLocaleString('es-CO')}
          </Text>
        )}
        {status === 'error' && (
          <Text style={styles.syncError}>Error al sincronizar. Reintentando...</Text>
        )}
        <TouchableOpacity
          style={[styles.syncButton, isSyncing && styles.syncButtonDisabled]}
          onPress={syncNow}
          disabled={isSyncing}
          activeOpacity={0.7}
        >
          {isSyncing ? (
            <ActivityIndicator color={COLORS.textOnPrimary} size="small" />
          ) : (
            <Text style={styles.syncButtonText}>
              {pendingCount > 0 ? 'Sincronizar ahora' : 'Verificar'}
            </Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Menú */}
      <View style={styles.menuContainer}>
        {MENU_ITEMS.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={[styles.menuItem, { borderLeftColor: item.color }]}
            onPress={() => handlePress(item)}
            activeOpacity={0.7}
          >
            <Text style={styles.menuIcon}>{item.icon}</Text>
            <View style={styles.menuContent}>
              <Text style={styles.menuTitle}>{item.title}</Text>
              <Text style={styles.menuSubtitle}>{item.subtitle}</Text>
            </View>
            <Text style={styles.menuArrow}>›</Text>
          </TouchableOpacity>
        ))}
      </View>
    </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  safeContainer: {
    flex: 1,
    backgroundColor: COLORS.primary,
  },
  container: {
    flex: 1,
    backgroundColor: COLORS.background,
  },
  scrollContent: {
    paddingBottom: SPACING.xl,
  },
  header: {
    backgroundColor: COLORS.primary,
    padding: SPACING.lg,
    paddingTop: SPACING.xxl,
    alignItems: 'center',
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: COLORS.secondary,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.sm,
    ...SHADOWS.md,
  },
  avatarImage: {
    width: 64,
    height: 64,
    borderRadius: 32,
  },
  cameraIcon: {
    position: 'absolute',
    bottom: -2,
    right: -4,
    backgroundColor: COLORS.surface,
    borderRadius: 12,
    width: 24,
    height: 24,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  cameraIconText: {
    fontSize: 12,
  },
  userCedula: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textOnPrimary + 'BB',
    fontWeight: FONTS.weights.medium,
    marginTop: 2,
  },
  avatarText: {
    fontSize: FONTS.sizes.title,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textOnSecondary,
  },
  welcomeText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textOnPrimary + 'CC',
  },
  userName: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textOnPrimary,
  },
  roleBadge: {
    backgroundColor: COLORS.primaryLight,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
    marginTop: SPACING.sm,
  },
  roleText: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textOnPrimary,
    fontWeight: FONTS.weights.medium,
  },
  menuContainer: {
    padding: SPACING.md,
    gap: SPACING.sm,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    borderLeftWidth: 4,
    ...SHADOWS.sm,
  },
  menuIcon: {
    fontSize: 28,
    marginRight: SPACING.md,
  },
  menuContent: {
    flex: 1,
  },
  menuTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  menuSubtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 2,
  },
  menuArrow: {
    fontSize: 24,
    color: COLORS.textLight,
    marginLeft: SPACING.sm,
  },

  // --- Sincronización ---
  syncCard: {
    backgroundColor: COLORS.surface,
    marginHorizontal: SPACING.md,
    marginTop: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.md,
    borderLeftWidth: 4,
    borderLeftColor: COLORS.info,
    ...SHADOWS.sm,
  },
  syncHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  syncTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  pendingSyncBadge: {
    backgroundColor: COLORS.warning,
    borderRadius: BORDER_RADIUS.full,
    width: 26,
    height: 26,
    justifyContent: 'center',
    alignItems: 'center',
  },
  pendingSyncText: {
    color: COLORS.textOnPrimary,
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.bold,
  },
  syncSubtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
    marginTop: 4,
  },
  syncLast: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.textLight,
    marginTop: 4,
  },
  syncError: {
    fontSize: FONTS.sizes.xs,
    color: COLORS.error,
    marginTop: 4,
  },
  syncButton: {
    backgroundColor: COLORS.info,
    borderRadius: BORDER_RADIUS.md,
    paddingVertical: SPACING.sm,
    alignItems: 'center',
    marginTop: SPACING.sm,
  },
  syncButtonDisabled: {
    opacity: 0.6,
  },
  syncButtonText: {
    color: COLORS.textOnPrimary,
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
  },
});

export default TerrenoMenuScreen;
