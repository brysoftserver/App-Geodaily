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
} from 'react-native';
import * as ImagePicker from 'expo-image-picker';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../store/AuthContext';
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
    title: 'Mapa Offline',
    subtitle: 'Navegar mapa con teselas QGIS',
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

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Encabezado */}
      <View style={styles.header}>
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
  );
};

const styles = StyleSheet.create({
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
});

export default TerrenoMenuScreen;
