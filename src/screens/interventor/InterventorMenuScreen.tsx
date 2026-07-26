// ============================================================
// GEODAILY — Menú Principal de Interventor
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
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useAuth } from '../../store/AuthContext';
import { useAvatar } from '../../hooks/useAvatar';
import CambiarContrasenaModal from '../../components/CambiarContrasenaModal';
import AjustesMenu from '../../components/AjustesMenu';
import NotificacionBell from '../../components/NotificacionBell';

type InterventorMenuScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
};

const MENU_ITEMS = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    subtitle: 'Métricas y estadísticas generales',
    icon: '📊',
    color: COLORS.info,
    screen: 'InterventorDashboard',
  },
  {
    id: 'listado',
    title: 'Listado de técnicos y visitas',
    subtitle: 'Técnicos, beneficiarios y formularios',
    icon: '📋',
    color: COLORS.roleInterventor,
    screen: 'InterventorVisitasJerarquicas',
  },
  {
    id: 'calendario',
    title: 'Calendario',
    subtitle: 'Vista general del cronograma',
    icon: '📅',
    color: COLORS.secondary,
    screen: 'InterventorCalendario',
  },
  {
    id: 'mapa',
    title: 'Mapa General',
    subtitle: 'Mapas, técnicos y mediciones',
    icon: '🗺️',
    color: COLORS.success,
    screen: 'InterventorMapaGeneral',
  },
  {
    id: 'beneficiarios',
    title: 'Base de Datos Beneficiarios',
    subtitle: '300 beneficiarios, asignación a técnicos',
    icon: '👤',
    color: COLORS.roleInterventor,
    screen: 'BaseDatosBeneficiarios',
  },
  {
    id: 'plantaciones',
    title: 'Áreas de Plantación',
    subtitle: 'Áreas marcadas por técnico, vereda y beneficiario',
    icon: '🌱',
    color: COLORS.success,
    screen: 'InterventorPlantacionesPorTecnico',
  },
];

const InterventorMenuScreen: React.FC<InterventorMenuScreenProps> = ({ navigation }) => {
  const { user, logout } = useAuth();
  const { avatarUri, cambiarAvatar, cambiando } = useAvatar(user?.id);
  const [showPasswordModal, setShowPasswordModal] = useState(false);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      {/* Header de usuario */}
      <ImageBackground source={require('../../../Logos_imagenes/fondo_login_geo_daily.png')} style={styles.userHeader}>
        <TouchableOpacity onPress={cambiarAvatar} activeOpacity={0.7} disabled={cambiando}>
          <View style={styles.avatar}>
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <Text style={styles.avatarText}>
                {user?.nombre?.charAt(0)?.toUpperCase() || 'I'}
              </Text>
            )}
            <View style={styles.cameraIcon}>
              {cambiando ? (
                <ActivityIndicator size="small" color={COLORS.roleInterventor} />
              ) : (
                <Text style={styles.cameraIconText}>📷</Text>
              )}
            </View>
          </View>
        </TouchableOpacity>
        <View style={styles.userInfo}>
          <Text style={styles.userName}>{user?.nombre || 'Interventor'}</Text>
          <Text style={styles.userRole}>Interventor de Terreno</Text>
        </View>
        <NotificacionBell navigation={navigation} formularioDetailScreen="InterventorFormularioDetail" />
        <AjustesMenu
          opciones={[
            { id: 'contrasena', label: 'Cambiar Contraseña', icon: '🔑', onPress: () => setShowPasswordModal(true) },
            { id: 'cerrar', label: 'Cerrar Sesión', icon: '🚪', onPress: logout, destructivo: true },
          ]}
        />
      </ImageBackground>

      {/* Menú */}
      <View style={styles.menuGrid}>
        {MENU_ITEMS.map((item) => (
          <TouchableOpacity
            key={item.id}
            style={styles.menuCard}
            onPress={() => navigation.navigate(item.screen)}
          >
            <View style={[styles.menuIconContainer, { backgroundColor: item.color + '15' }]}>
              <Text style={styles.menuIcon}>{item.icon}</Text>
            </View>
            <Text style={styles.menuTitle}>{item.title}</Text>
            <Text style={styles.menuSubtitle}>{item.subtitle}</Text>
          </TouchableOpacity>
        ))}
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
  content: {
    flexGrow: 1,
    padding: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    borderRadius: BORDER_RADIUS.md,
    marginBottom: SPACING.lg,
    overflow: 'hidden',
    ...SHADOWS.sm,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.roleInterventor,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: SPACING.md,
  },
  avatarImage: {
    width: 48,
    height: 48,
    borderRadius: 24,
  },
  cameraIcon: {
    position: 'absolute',
    bottom: -2,
    right: SPACING.md - 6,
    backgroundColor: COLORS.surface,
    borderRadius: 10,
    width: 18,
    height: 18,
    justifyContent: 'center',
    alignItems: 'center',
    ...SHADOWS.sm,
  },
  cameraIconText: {
    fontSize: 9,
  },
  avatarText: {
    fontSize: FONTS.sizes.xl,
    fontWeight: FONTS.weights.bold,
    color: '#fff',
  },
  userInfo: {
    flex: 1,
  },
  userName: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.semibold,
    color: COLORS.textPrimary,
  },
  userRole: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
  menuGrid: {
    gap: SPACING.md,
  },
  menuCard: {
    backgroundColor: COLORS.surface,
    borderRadius: BORDER_RADIUS.lg,
    padding: SPACING.lg,
    ...SHADOWS.md,
  },
  menuIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.md,
  },
  menuIcon: {
    fontSize: 28,
  },
  menuTitle: {
    fontSize: FONTS.sizes.lg,
    fontWeight: FONTS.weights.bold,
    color: COLORS.textPrimary,
    marginBottom: 4,
  },
  menuSubtitle: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textSecondary,
  },
});

export default InterventorMenuScreen;
