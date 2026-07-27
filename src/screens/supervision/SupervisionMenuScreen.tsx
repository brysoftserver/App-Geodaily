// ============================================================
// GEODAILY — Menú Principal de Supervisión
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { COLORS, FONTS, SPACING, BORDER_RADIUS, SHADOWS } from '../../theme';
import { useAuth } from '../../store/AuthContext';
import { useAvatar } from '../../hooks/useAvatar';
import CambiarContrasenaModal from '../../components/CambiarContrasenaModal';
import AjustesMenu from '../../components/AjustesMenu';
import NotificacionBell from '../../components/NotificacionBell';

type SupervisionMenuScreenProps = {
  navigation: NativeStackNavigationProp<Record<string, any>>;
};

const MENU_ITEMS = [
  {
    id: 'dashboard',
    title: 'Dashboard',
    subtitle: 'Métricas y estadísticas generales',
    icon: '📊',
    color: COLORS.info,
    screen: 'Dashboard',
  },
  {
    id: 'listado',
    title: 'Listado de técnicos y visitas',
    subtitle: 'Técnicos, beneficiarios y formularios',
    icon: '📋',
    color: COLORS.primary,
    screen: 'SupervisionVisitasJerarquicas',
  },
  {
    id: 'calendario',
    title: 'Calendario',
    subtitle: 'Vista general del cronograma',
    icon: '📅',
    color: COLORS.secondary,
    screen: 'SupervisionCalendario',
  },
  {
    id: 'mapa',
    title: 'Mapa General',
    subtitle: 'Mapas, técnicos y mediciones',
    icon: '🗺️',
    color: COLORS.success,
    screen: 'MapaGeneral',
  },
  {
    id: 'beneficiarios',
    title: 'Base de Datos Beneficiarios',
    subtitle: '76 beneficiarios, asignación a técnicos',
    icon: '👤',
    color: COLORS.roleSupervisor,
    screen: 'BaseDatosBeneficiarios',
  },
  {
    id: 'plantaciones',
    title: 'Áreas de Plantación',
    subtitle: 'Áreas marcadas por técnico, vereda y beneficiario',
    icon: '🌱',
    color: COLORS.success,
    screen: 'SupervisionPlantacionesPorTecnico',
  },
];

const SupervisionMenuScreen: React.FC<SupervisionMenuScreenProps> = ({ navigation }) => {
  const { user, logout } = useAuth();
  const { avatarUri, cambiarAvatar, cambiando } = useAvatar(user?.id);
  const [showPasswordModal, setShowPasswordModal] = useState(false);
  const insets = useSafeAreaInsets();

  return (
    // El fondo cubre toda la pantalla (encabezado + submódulos); las
    // tarjetas de los submódulos quedan blancas encima, igual que en el
    // menú del técnico.
    <ImageBackground
      source={require('../../../Logos_imagenes/fondo_login_geo_daily.png')}
      style={styles.container}
      resizeMode="cover"
    >
      <View style={styles.overlayOscuro} pointerEvents="none" />
      <ScrollView style={styles.scroll} contentContainerStyle={[styles.content, { paddingTop: Math.max(insets.top, SPACING.lg) }]}>
        {/* Header de usuario */}
        <View style={styles.userHeader}>
          <TouchableOpacity onPress={cambiarAvatar} activeOpacity={0.7} disabled={cambiando}>
            <View style={styles.avatar}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarText}>
                  {user?.nombre?.charAt(0)?.toUpperCase() || 'S'}
                </Text>
              )}
              <View style={styles.cameraIcon}>
                {cambiando ? (
                  <ActivityIndicator size="small" color={COLORS.secondary} />
                ) : (
                  <Text style={styles.cameraIconText}>📷</Text>
                )}
              </View>
            </View>
          </TouchableOpacity>
          <View style={styles.userInfo}>
            <Text style={styles.userName}>{user?.nombre || 'Supervisor'}</Text>
            <Text style={styles.userRole}>Supervisor a Terreno</Text>
          </View>
          <NotificacionBell navigation={navigation} formularioDetailScreen="SupervisionFormularioDetail" />
          <AjustesMenu
            opciones={[
              { id: 'contrasena', label: 'Cambiar Contraseña', icon: '🔑', onPress: () => setShowPasswordModal(true) },
              { id: 'cerrar', label: 'Cerrar Sesión', icon: '🚪', onPress: logout, destructivo: true },
            ]}
          />
        </View>

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
      </ScrollView>
      <CambiarContrasenaModal visible={showPasswordModal} onClose={() => setShowPasswordModal(false)} />
    </ImageBackground>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  overlayOscuro: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.18)',
  },
  scroll: {
    flex: 1,
  },
  content: {
    flexGrow: 1,
    paddingHorizontal: SPACING.lg,
    paddingBottom: SPACING.xl,
  },
  userHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: SPACING.md,
    marginBottom: SPACING.lg,
  },
  avatar: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.secondary,
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
    color: COLORS.textOnPrimary,
  },
  userRole: {
    fontSize: FONTS.sizes.sm,
    color: COLORS.textOnPrimary + 'CC',
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

export default SupervisionMenuScreen;
