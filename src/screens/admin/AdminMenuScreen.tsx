// ============================================================
// GEODAILY — Consola de Administración
// ============================================================

import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../store/AuthContext';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';

type AdminMenuProps = {
  navigation: NativeStackNavigationProp<any>;
};

const MENU_ITEMS = [
  {
    id: 'users',
    title: 'Gestión de Usuarios',
    subtitle: 'Administrar roles, permisos y cuentas',
    icon: '👥',
    color: COLORS.primary,
    screen: 'UserManagement',
  },
  {
    id: 'config',
    title: 'Configuración del Sistema',
    subtitle: 'Auditoría, respaldos y parámetros globales',
    icon: '⚙️',
    color: COLORS.info,
    screen: 'SystemConfig',
  },
  {
    id: 'supervision',
    title: 'Panel de Supervisión',
    subtitle: 'Ver dashboard y formularios de supervisores',
    icon: '📊',
    color: COLORS.secondary,
    screen: null, // navegación externa
  },
  {
    id: 'terreno',
    title: 'Módulo de Terreno',
    subtitle: 'Acceso a herramientas de campo',
    icon: '🌱',
    color: COLORS.success,
    screen: null, // navegación externa
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

const AdminMenuScreen: React.FC<AdminMenuProps> = ({ navigation }) => {
  const { user, logout } = useAuth();

  const handlePress = (item: (typeof MENU_ITEMS)[0]) => {
    switch (item.id) {
      case 'cerrar':
        logout();
        break;
      case 'supervision':
        // Navegar al stack de supervisión (reseteando)
        navigation.getParent()?.navigate('Supervision');
        break;
      case 'terreno':
        // Navegar al stack de terreno
        navigation.getParent()?.navigate('Terreno');
        break;
      default:
        if (item.screen) {
          navigation.navigate(item.screen);
        }
        break;
    }
  };

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.scrollContent}>
      {/* Encabezado */}
      <View style={styles.header}>
        <View style={[styles.avatar, { backgroundColor: COLORS.roleAdmin }]}>
          <Text style={styles.avatarText}>
            {user?.nombre?.charAt(0)?.toUpperCase() || 'A'}
          </Text>
        </View>
        <Text style={styles.welcomeText}>Consola de Administración</Text>
        <Text style={styles.userName}>{user?.nombre || 'Administrador'}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>Administrador</Text>
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

      {/* Información del sistema */}
      <View style={styles.systemInfo}>
        <Text style={styles.systemInfoTitle}>Información del Sistema</Text>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Versión</Text>
          <Text style={styles.infoValue}>GEODAILY v1.0.0</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Usuario</Text>
          <Text style={styles.infoValue}>{user?.email || user?.id || '—'}</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.infoLabel}>Rol</Text>
          <Text style={styles.infoValue}>Administrador</Text>
        </View>
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
    alignItems: 'center',
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    backgroundColor: COLORS.surface,
    borderBottomLeftRadius: BORDER_RADIUS.xl,
    borderBottomRightRadius: BORDER_RADIUS.xl,
    ...SHADOWS.md,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  avatarText: {
    color: COLORS.textOnPrimary,
    fontSize: FONTS.sizes.title,
    fontWeight: FONTS.weights.bold,
  },
  welcomeText: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
    marginBottom: 2,
  },
  userName: {
    fontSize: FONTS.sizes.xxl,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.xs,
  },
  roleBadge: {
    backgroundColor: COLORS.roleAdmin + '20',
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.xs,
    borderRadius: BORDER_RADIUS.full,
  },
  roleText: {
    color: COLORS.roleAdmin,
    fontSize: FONTS.sizes.sm,
    fontWeight: FONTS.weights.semibold,
  },
  menuContainer: {
    marginTop: SPACING.lg,
    paddingHorizontal: SPACING.lg,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    marginBottom: SPACING.sm,
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
    marginBottom: 2,
  },
  menuSubtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  menuArrow: {
    fontSize: 22,
    color: COLORS.textLight,
    marginLeft: SPACING.sm,
  },
  systemInfo: {
    marginTop: SPACING.lg,
    marginHorizontal: SPACING.lg,
    backgroundColor: COLORS.surface,
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.lg,
    ...SHADOWS.sm,
  },
  systemInfoTitle: {
    fontSize: FONTS.sizes.md,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
    marginBottom: SPACING.sm,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 4,
  },
  infoLabel: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textSecondary,
  },
  infoValue: {
    fontSize: FONTS.sizes.md,
    color: COLORS.textPrimary,
    fontWeight: FONTS.weights.medium,
  },
});

export default AdminMenuScreen;
