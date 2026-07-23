// ============================================================
// GEODAILY — Consola de Administración
// ============================================================

import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Image,
  ImageBackground,
  ActivityIndicator,
} from 'react-native';
import { NativeStackNavigationProp } from '@react-navigation/native-stack';
import { useAuth } from '../../store/AuthContext';
import { useAvatar } from '../../hooks/useAvatar';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import CambiarContrasenaModal from '../../components/CambiarContrasenaModal';

type AdminMenuProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
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
    id: 'mapa',
    title: 'Mapa General del Proyecto',
    subtitle: 'Mapas, técnicos y mediciones en terreno',
    icon: '🗺️',
    color: COLORS.success,
    screen: 'MapaGeneral',
  },
  {
    id: 'dashboard',
    title: 'Dashboard General',
    subtitle: 'Métricas globales de todas las visitas',
    icon: '📊',
    color: COLORS.primary,
    screen: 'AdminDashboard',
  },
  {
    id: 'visitas',
    title: 'Listado de técnicos y visitas',
    subtitle: 'Visitas jerárquicas por técnico y beneficiario',
    icon: '👷',
    color: COLORS.roleTecnico,
    screen: 'AdminVisitasJerarquicas',
  },
  {
    id: 'calendario',
    title: 'Calendario General',
    subtitle: 'Visitas realizadas y programadas de todo el equipo',
    icon: '📅',
    color: COLORS.secondary,
    screen: 'AdminCalendario',
  },
  {
    id: 'formularios',
    title: 'Listado de Formularios',
    subtitle: 'Todos los formularios, con filtros por tipo y estado',
    icon: '📋',
    color: COLORS.info,
    screen: 'AdminFormularioList',
  },
  {
    id: 'beneficiarios',
    title: 'Base de Datos Beneficiarios',
    subtitle: '300 beneficiarios, asignación a técnicos',
    icon: '👤',
    color: COLORS.roleAdmin,
    screen: 'BaseDatosBeneficiarios',
  },
  {
    id: 'contrasena',
    title: 'Cambiar Contraseña',
    subtitle: 'Actualizar tu contraseña de acceso',
    icon: '🔑',
    color: COLORS.roleAdmin,
    screen: null,
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
  const { avatarUri, cambiarAvatar, cambiando } = useAvatar(user?.id);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  const handlePress = (item: (typeof MENU_ITEMS)[0]) => {
    switch (item.id) {
      case 'contrasena':
        setShowPasswordModal(true);
        break;
      case 'cerrar':
        logout();
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
      <ImageBackground source={require('../../../Logos_imagenes/fondo_login_geo_daily.png')} style={styles.header}>
        <TouchableOpacity onPress={cambiarAvatar} activeOpacity={0.7} disabled={cambiando}>
          <View style={styles.avatar}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>
                {user?.nombre?.charAt(0)?.toUpperCase() || 'A'}
              </Text>
            )}
            <View style={styles.cameraIcon}>
              {cambiando ? (
                <ActivityIndicator size="small" color={COLORS.roleAdmin} />
              ) : (
                <Text style={styles.cameraIconText}>📷</Text>
              )}
            </View>
          </View>
        </TouchableOpacity>
        <Text style={styles.welcomeText}>Consola de Administración</Text>
        <Text style={styles.userName}>{user?.nombre || 'Administrador'}</Text>
        <View style={styles.roleBadge}>
          <Text style={styles.roleText}>Administrador</Text>
        </View>
      </ImageBackground>

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
      <CambiarContrasenaModal visible={showPasswordModal} onClose={() => setShowPasswordModal(false)} />
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.surface,
  },
  scrollContent: {
    flexGrow: 1,
    paddingBottom: SPACING.xl,
  },
  header: {
    alignItems: 'center',
    paddingVertical: SPACING.xl,
    paddingHorizontal: SPACING.lg,
    borderBottomLeftRadius: BORDER_RADIUS.xl,
    borderBottomRightRadius: BORDER_RADIUS.xl,
    overflow: 'hidden',
    ...SHADOWS.md,
  },
  avatar: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: COLORS.roleAdmin,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.sm,
  },
  avatarImage: {
    width: 72,
    height: 72,
    borderRadius: 36,
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
